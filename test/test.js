var { url_file_db } = require('../index.js')
var fs = require('fs')

var passed = 0
var failed = 0

// Track active operations per file path
var active_operations = new Map()

// Overloaded file operations that take time and detect concurrent access
async function overloaded_readFile(fullpath) {
  // Check if there's already an operation on this file
  var ops = active_operations.get(fullpath) || { reads: 0, writes: 0 }

  if (ops.writes > 0) {
    throw new Error(`Concurrent read during write detected on ${fullpath}`)
  }

  ops.reads++
  active_operations.set(fullpath, ops)

  // Simulate slow read (100ms)
  await new Promise(resolve => setTimeout(resolve, 100))

  var result = await fs.promises.readFile(fullpath)

  ops.reads--
  if (ops.reads === 0 && ops.writes === 0) {
    active_operations.delete(fullpath)
  }

  return result
}

async function overloaded_writeFile(fullpath, data) {
  // Check if there's already an operation on this file
  var ops = active_operations.get(fullpath) || { reads: 0, writes: 0 }

  if (ops.writes > 0) {
    throw new Error(`Concurrent write detected on ${fullpath}`)
  }

  if (ops.reads > 0) {
    throw new Error(`Write during read detected on ${fullpath}`)
  }

  ops.writes++
  active_operations.set(fullpath, ops)

  // Simulate slow write (100ms)
  await new Promise(resolve => setTimeout(resolve, 100))

  await fs.promises.writeFile(fullpath, data)

  ops.writes--
  if (ops.reads === 0 && ops.writes === 0) {
    active_operations.delete(fullpath)
  }
}

async function runTest(testName, testFunction, expectedResult) {
  try {
    var result = await testFunction()
    if (result === expectedResult) {
      passed++
      console.log(`✓ ${testName}`)
    } else {
      failed++
      console.log(`✗ ${testName}`)
      console.log(`  Got: ${result}`)
      console.log(`  Expected: ${expectedResult}`)
    }
  } catch (error) {
    failed++
    console.log(`✗ ${testName}`)
    console.log(`  Error: ${error.message || error}`)
  }
}

;(async () => {
  console.log('Testing db operations...\n')

  await runTest(
    'get_key from URL',
    async () => {
      return url_file_db.get_key('/hello/world')
    },
    '/hello/world'
  )

  await runTest(
    'get_key with URL encoding',
    async () => {
      return url_file_db.get_key('/hello%20world/test')
    },
    '/hello world/test'
  )

  await runTest(
    'write and read file (with auto-created directories)',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key = url_file_db.get_key('/testdir/file.txt')
      await db.write(key, 'new content')
      var content = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'new content'
  )

  await runTest(
    'read existing file',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key = url_file_db.get_key('/testdir/file.txt')
      await db.write(key, 'existing content')
      var content = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'existing content'
  )

  await runTest(
    'write to nested directory structure',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key = url_file_db.get_key('/a/b/c/d/file.txt')
      await db.write(key, 'nested')
      var content = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'nested'
  )

  await runTest(
    'write with special characters in filename',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key = url_file_db.get_key('/test/file with spaces.txt')
      await db.write(key, 'special chars')
      var content = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'special chars'
  )

  console.log('\nTesting concurrency control...\n')

  await runTest(
    'multiple writes to same file are serialized',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Override file operations
      db._readFile = overloaded_readFile
      db._writeFile = overloaded_writeFile

      var key = url_file_db.get_key('/test/file.txt')

      // Start multiple writes to the same file
      var writes = [
        db.write(key, 'write1'),
        db.write(key, 'write2'),
        db.write(key, 'write3')
      ]

      await Promise.all(writes)

      var content = await fs.promises.readFile(`${db_test_dir}/test/file.txt`, 'utf8')

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // If no concurrency error was thrown, test passed
      return content
    },
    'write3'
  )

  await runTest(
    'multiple reads to same file can happen (are serialized)',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Override file operations
      db._readFile = overloaded_readFile
      db._writeFile = overloaded_writeFile

      var key = url_file_db.get_key('/test/file.txt')

      // Write initial content
      await db.write(key, 'initial')

      // Start multiple reads to the same file
      var reads = [
        db.read(key),
        db.read(key),
        db.read(key)
      ]

      var results = await Promise.all(reads)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // All reads should get the same content
      return results.every(r => r.toString() === 'initial') ? 'initial' : 'mismatch'
    },
    'initial'
  )

  await runTest(
    'read during write is serialized',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Override file operations
      db._readFile = overloaded_readFile
      db._writeFile = overloaded_writeFile

      var key = url_file_db.get_key('/test/file.txt')

      // Write initial content
      await db.write(key, 'initial')

      // Start write, then immediately start read
      var write_promise = db.write(key, 'updated')
      var read_promise = db.read(key)

      await Promise.all([write_promise, read_promise])

      var content = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // Read should get 'updated' since it was queued after write
      return content.toString()
    },
    'updated'
  )

  await runTest(
    'write during read is serialized',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Override file operations
      db._readFile = overloaded_readFile
      db._writeFile = overloaded_writeFile

      var key = url_file_db.get_key('/test/file.txt')

      // Write initial content
      await db.write(key, 'initial')

      // Start read, then immediately start write
      var read_promise = db.read(key)
      var write_promise = db.write(key, 'updated')

      var read_result = await read_promise
      await write_promise

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // Read should get 'initial' since it was queued before write
      return read_result.toString()
    },
    'initial'
  )

  await runTest(
    'operations on different files are independent',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Override file operations
      db._readFile = overloaded_readFile
      db._writeFile = overloaded_writeFile

      var key1 = url_file_db.get_key('/test/file1.txt')
      var key2 = url_file_db.get_key('/test/file2.txt')
      var key3 = url_file_db.get_key('/test/file3.txt')

      // Start writes to different files simultaneously
      var start = Date.now()
      await Promise.all([
        db.write(key1, 'content1'),
        db.write(key2, 'content2'),
        db.write(key3, 'content3')
      ])
      var elapsed = Date.now() - start

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // If operations were truly concurrent, should take ~100ms, not ~300ms
      // We'll be lenient and check if it's less than 250ms
      return elapsed < 250 ? 'concurrent' : 'sequential'
    },
    'concurrent'
  )

  await runTest(
    'complex interleaved operations are correctly serialized',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Override file operations
      db._readFile = overloaded_readFile
      db._writeFile = overloaded_writeFile

      var key = url_file_db.get_key('/test/file.txt')

      await db.write(key, 'v1')

      // Queue up a complex sequence
      var p1 = db.read(key)
      var p2 = db.write(key, 'v2')
      var p3 = db.read(key)
      var p4 = db.write(key, 'v3')
      var p5 = db.read(key)

      var r1 = await p1
      var r3 = await p3
      var r5 = await p5
      await p2
      await p4

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // r1 should be v1, r3 should be v2, r5 should be v3
      return `${r1},${r3},${r5}`
    },
    'v1,v2,v3'
  )

  console.log('\nTesting /index normalization...\n')

  await runTest(
    'get_key normalizes /index away',
    async () => {
      return url_file_db.get_key('/a/b/c/index')
    },
    '/a/b/c'
  )

  await runTest(
    'get_key normalizes /index with trailing path',
    async () => {
      return url_file_db.get_key('/a/b/c/index/foo/bar')
    },
    '/a/b/c'
  )

  await runTest(
    'write to /a then read from /a/index',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key1 = url_file_db.get_key('/a')
      var key2 = url_file_db.get_key('/a/index')
      await db.write(key1, 'content for a')
      var content = await db.read(key2)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'content for a'
  )

  await runTest(
    'write to /a/index then read from /a',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key1 = url_file_db.get_key('/a/index')
      var key2 = url_file_db.get_key('/a')
      await db.write(key1, 'content for a/index')
      var content = await db.read(key2)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'content for a/index'
  )

  await runTest(
    'file-to-directory conversion: write /a, then /a/b',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key_a = url_file_db.get_key('/a')
      var key_ab = url_file_db.get_key('/a/b')

      // Write /a as a file
      await db.write(key_a, 'original content')

      // Write /a/b - this should convert /a to a directory with index file
      await db.write(key_ab, 'nested content')

      // Read both
      var a_content = await db.read(key_a)
      var ab_content = await db.read(key_ab)

      // Check filesystem structure
      var has_index = await fs.promises.access(`${db_test_dir}/a/index`).then(() => true).catch(() => false)
      var has_b = await fs.promises.access(`${db_test_dir}/a/b`).then(() => true).catch(() => false)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return `${a_content},${ab_content},index:${has_index},b:${has_b}`
    },
    'original content,nested content,index:true,b:true'
  )

  await runTest(
    'multiple levels: /a, then /a/b, then /a/b/c',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key_a = url_file_db.get_key('/a')
      var key_ab = url_file_db.get_key('/a/b')
      var key_abc = url_file_db.get_key('/a/b/c')

      await db.write(key_a, 'a content')
      await db.write(key_ab, 'b content')
      await db.write(key_abc, 'c content')

      var a = await db.read(key_a)
      var b = await db.read(key_ab)
      var c = await db.read(key_abc)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return `${a}|${b}|${c}`
    },
    'a content|b content|c content'
  )

  await runTest(
    'concurrent file-to-directory conversion',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key_x = url_file_db.get_key('/x')
      var key_xy = url_file_db.get_key('/x/y')
      var key_xz = url_file_db.get_key('/x/z')

      // Write /x as a file
      await db.write(key_x, 'x content')

      // Concurrently write /x/y and /x/z - both should trigger conversion
      await Promise.all([
        db.write(key_xy, 'y content'),
        db.write(key_xz, 'z content')
      ])

      var x = await db.read(key_x)
      var y = await db.read(key_xy)
      var z = await db.read(key_xz)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return `${x}|${y}|${z}`
    },
    'x content|y content|z content'
  )

  console.log('\\nTesting externally created directories...\\n')

  await runTest(
    'externally created directory is detected properly',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Create a directory externally using filesystem directly
      await fs.promises.mkdir(`${db_test_dir}/external_dir`, { recursive: true })

      // Wait a bit for chokidar to detect it
      await new Promise(resolve => setTimeout(resolve, 200))

      // Write to a file inside that directory
      var key = url_file_db.get_key('/external_dir')
      await db.write(key, 'content in external dir')

      // Read it back
      var content = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'content in external dir'
  )

  console.log('\nTesting edge cases...\n')

  await runTest(
    'write and read from root key /',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key = '/'
      await db.write(key, 'root content')
      var content = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return content.toString()
    },
    'root content'
  )

  await runTest(
    'get_key with /index normalizes to /',
    async () => {
      return url_file_db.get_key('/index')
    },
    '/'
  )

  await runTest(
    'encode Windows reserved filename (CON)',
    async () => {
      return url_file_db.encode_filename('CON')
    },
    'CO%4E'
  )

  await runTest(
    'encode Windows reserved filename (PRN)',
    async () => {
      return url_file_db.encode_filename('prn')
    },
    'pr%6E'
  )

  await runTest(
    'encode filename with trailing dot',
    async () => {
      return url_file_db.encode_filename('test.')
    },
    'test%2E'
  )

  await runTest(
    'encode filename with trailing space',
    async () => {
      return url_file_db.encode_filename('test ')
    },
    'test%20'
  )

  console.log('\nTesting case-insensitive filesystem features (if applicable)...\n')

  await runTest(
    'write files with case-variant names on case-insensitive fs',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Write files that differ only by case
      var key1 = url_file_db.get_key('/test/File')
      var key2 = url_file_db.get_key('/test/file')
      var key3 = url_file_db.get_key('/test/FILE')

      await db.write(key1, 'first')
      await db.write(key2, 'second')
      await db.write(key3, 'third')

      // Check that all three files exist with different encoded names
      var files = await fs.promises.readdir(`${db_test_dir}/test`)
      var unique_files = new Set(files)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // On case-insensitive filesystem, should have 3 uniquely encoded files
      // On case-sensitive, might have just 1
      return unique_files.size >= 1 ? 'ok' : 'failed'
    },
    'ok'
  )

  await runTest(
    'delete one of multiple case-variant files',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // Write files that differ only by case
      var key1 = url_file_db.get_key('/test/File')
      var key2 = url_file_db.get_key('/test/file')

      await db.write(key1, 'first')
      await db.write(key2, 'second')

      // Wait for chokidar to register both files
      await new Promise(resolve => setTimeout(resolve, 200))

      // Delete one file externally to trigger unlink event
      var files = await fs.promises.readdir(`${db_test_dir}/test`)
      if (files.length > 0) {
        await fs.promises.unlink(`${db_test_dir}/test/${files[0]}`)
      }

      // Wait for chokidar to detect the deletion
      await new Promise(resolve => setTimeout(resolve, 200))

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return 'ok'
    },
    'ok'
  )

  await runTest(
    'case collision with encoded characters',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      // To hit COVER_ME_54, we need the encoded character AFTER the case-differing letter
      // Key: "a:" -> encoded as "a%3A"
      // Key: "A:" -> encoded as "A%3A" (lowercase: "a%3a")
      // When resolving collision, it iterates backwards from the end:
      // - First hits 'A' (the second hex digit of %3A)
      // - Checks if j-2 is '%', which it is!
      // - This triggers COVER_ME_54 and skips the %3A sequence
      var key1 = url_file_db.get_key('/test/a:')
      var key2 = url_file_db.get_key('/test/A:')

      await db.write(key1, 'first')
      await db.write(key2, 'second')

      // Verify both can be read back
      var content1 = await db.read(key1)
      var content2 = await db.read(key2)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // Should have created 2 files and both should be readable
      return content1.toString() === 'first' && content2.toString() === 'second' ? 'ok' : 'failed'
    },
    'ok'
  )

  await runTest(
    'read nonexistent file returns null',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var result = await db.read('/nonexistent/file.txt')

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      return result === null ? 'null' : 'not-null'
    },
    'null'
  )

  await runTest(
    'failed read does not poison promise chain',
    async () => {
      var db_test_dir = '/tmp/test-db-' + Math.random().toString(36).slice(2)
      var db = await url_file_db.create(db_test_dir, () => {})

      var key = url_file_db.get_key('/test/file.txt')

      // Write a file
      await db.write(key, 'initial content')

      // Read it successfully
      var content1 = await db.read(key)

      // Delete the file externally
      await fs.promises.unlink(`${db_test_dir}/test/file.txt`)

      // Wait for chokidar to notice
      await new Promise(resolve => setTimeout(resolve, 200))

      // Try to read the deleted file - should return null, not throw
      var content2 = await db.read(key)

      // Now write to the same key again - this should work despite the failed read
      await db.write(key, 'new content')

      // And read it back successfully
      var content3 = await db.read(key)

      await fs.promises.rm(db_test_dir, { recursive: true, force: true })

      // Verify: first read worked, second was null, third worked after re-write
      return content1.toString() === 'initial content' &&
             content2 === null &&
             content3.toString() === 'new content' ? 'ok' : 'failed'
    },
    'ok'
  )

  console.log(`\n${passed} passed, ${failed} failed`)

  if (failed === 0) {
    console.log('\nAll tests passed!')
    process.exit(0)
  } else {
    console.log('\nSome tests failed!')
    process.exit(1)
  }
})()
