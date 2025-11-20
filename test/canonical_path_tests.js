var {
  encode_canonical_path_component,
  decode_canonical_path_component,
  decode_canonical_path,
  encode_canonical_path,
  decode_file_path_component,
  file_path_to_canonical_path,
  url_path_to_canonical_path,
  encode_file_path_component,
  ensure_unique_case_insensitive_path_component
} = require('../canonical_path.js')

var passed = 0
var failed = 0

async function runTest(testName, testFunction, expectedResult) {
  try {
    var result = await testFunction()
    if (JSON.stringify(result) === JSON.stringify(expectedResult)) {
      passed++
      console.log(`✓ ${testName}`)
    } else {
      failed++
      console.log(`✗ ${testName}`)
      console.log(`  Got: ${JSON.stringify(result)}`)
      console.log(`  Expected: ${JSON.stringify(expectedResult)}`)
    }
  } catch (error) {
    failed++
    console.log(`✗ ${testName}`)
    console.log(`  Error: ${error.message || error}`)
  }
}

;(async () => {
  console.log('Testing canonical_path.js...\n')

  // ===================
  // encode_canonical_path_component / decode_canonical_path_component
  // ===================
  console.log('--- encode/decode_canonical_path_component ---\n')

  await runTest(
    'encode % in component',
    () => encode_canonical_path_component('hello%world'),
    'hello%25world'
  )

  await runTest(
    'encode / in component',
    () => encode_canonical_path_component('hello/world'),
    'hello%2Fworld'
  )

  await runTest(
    'decode %25 to %',
    () => decode_canonical_path_component('hello%25world'),
    'hello%world'
  )

  await runTest(
    'decode %2F to /',
    () => decode_canonical_path_component('hello%2Fworld'),
    'hello/world'
  )


  // ===================
  // decode_canonical_path / encode_canonical_path
  // ===================
  console.log('\n--- decode/encode_canonical_path ---\n')

  await runTest(
    'decode /a/b/c',
    () => decode_canonical_path('/a/b/c'),
    ['a', 'b', 'c']
  )

  await runTest(
    'decode /',
    () => decode_canonical_path('/'),
    []
  )

  await runTest(
    'encode [a, b, c]',
    () => encode_canonical_path(['a', 'b', 'c']),
    '/a/b/c'
  )


  // ===================
  // encode_file_path_component / decode_file_path_component
  // ===================
  console.log('\n--- encode/decode_file_path_component ---\n')

  // Basic safe filenames
  await runTest(
    'encode safe filename',
    () => encode_file_path_component('hello.txt'),
    'hello.txt'
  )

  // Windows reserved names
  await runTest(
    'encode con',
    () => encode_file_path_component('con'),
    'co%6E'
  )

  await runTest(
    'encode prn',
    () => encode_file_path_component('prn'),
    'pr%6E'
  )

  await runTest(
    'encode aux',
    () => encode_file_path_component('aux'),
    'au%78'
  )

  // Unsafe characters
  await runTest(
    'encode <',
    () => encode_file_path_component('file<name'),
    'file%3Cname'
  )

  await runTest(
    'encode >',
    () => encode_file_path_component('file>name'),
    'file%3Ename'
  )

  await runTest(
    'encode :',
    () => encode_file_path_component('file:name'),
    'file%3Aname'
  )

  await runTest(
    'encode /',
    () => encode_file_path_component('file/name'),
    'file%2Fname'
  )

  await runTest(
    'encode %',
    () => encode_file_path_component('file%name'),
    'file%25name'
  )

  // Trailing dots and spaces
  await runTest(
    'encode trailing dot',
    () => encode_file_path_component('file.'),
    'file%2E'
  )

  await runTest(
    'encode trailing space',
    () => encode_file_path_component('file '),
    'file%20'
  )

  // Decode
  await runTest(
    'decode file_path_component',
    () => decode_file_path_component('hello%20world'),
    'hello world'
  )


  // ===================
  // file_path_to_canonical_path
  // ===================
  console.log('\n--- file_path_to_canonical_path ---\n')

  await runTest(
    'simple path',
    () => file_path_to_canonical_path('/a/b/c'),
    '/a/b/c'
  )

  await runTest(
    'path with encoded component',
    () => file_path_to_canonical_path('/a/hello%20world/c'),
    '/a/hello world/c'
  )

  await runTest(
    'file path without leading slash throws',
    () => {
      try {
        file_path_to_canonical_path('a/b/c')
        return 'no error'
      } catch (e) {
        return e.message
      }
    },
    'file path must begin with /'
  )

  await runTest(
    'file path with index',
    () => file_path_to_canonical_path('/a/b/index'),
    '/a/b'
  )

  await runTest(
    'file path with index at root',
    () => file_path_to_canonical_path('/index'),
    '/'
  )

  await runTest(
    'file path with index and stuff after',
    () => file_path_to_canonical_path('/a/index/b/c'),
    '/a'
  )


  // ===================
  // url_path_to_canonical_path
  // ===================
  console.log('\n--- url_path_to_canonical_path ---\n')

  await runTest(
    'simple url path',
    () => url_path_to_canonical_path('/a/b/c'),
    '/a/b/c'
  )

  await runTest(
    'url with query string',
    () => url_path_to_canonical_path('/a/b?query=1'),
    '/a/b'
  )

  await runTest(
    'url with fragment',
    () => url_path_to_canonical_path('/a/b#section'),
    '/a/b'
  )

  await runTest(
    'url with encoded space',
    () => url_path_to_canonical_path('/a/hello%20world'),
    '/a/hello world'
  )

  await runTest(
    'url with index',
    () => url_path_to_canonical_path('/a/b/index'),
    '/a/b'
  )

  await runTest(
    'url path without leading slash throws',
    () => {
      try {
        url_path_to_canonical_path('a/b/c')
        return 'no error'
      } catch (e) {
        return e.message
      }
    },
    'url path must begin with /'
  )

  await runTest(
    'url with index at root',
    () => url_path_to_canonical_path('/index'),
    '/'
  )


  // ===================
  // ensure_unique_case_insensitive_path_component
  // ===================
  console.log('\n--- ensure_unique_case_insensitive_path_component ---\n')

  await runTest(
    'no collision',
    () => {
      var existing = new Set(['hello'])
      return ensure_unique_case_insensitive_path_component('world', existing)
    },
    'world'
  )

  await runTest(
    'with collision',
    () => {
      var existing = new Set(['hello'])
      return ensure_unique_case_insensitive_path_component('hello', existing)
    },
    'hell%6F'
  )

  await runTest(
    'collision with %XX sequence to skip',
    () => {
      // Start with 'ab' already encoded last char, need to collide twice
      // to force skipping over the %XX and encoding the previous char
      var existing = new Set(['a%42', 'a%34%32'])  // 'aB' and 'a42' in lowercase
      return ensure_unique_case_insensitive_path_component('a%42', existing)
    },
    '%61%42'
  )

  await runTest(
    'collision skips non-letter characters',
    () => {
      // 'a1' collides with existing 'a1'
      // Should encode the 'a', not the '1', since '1' has no case variants
      var existing = new Set(['a1'])
      return ensure_unique_case_insensitive_path_component('a1', existing)
    },
    '%611'
  )


  // ===================
  // Summary
  // ===================
  console.log(`\n${passed} passed, ${failed} failed`)

  if (failed === 0) {
    console.log('\nAll canonical_path tests passed!')
    process.exit(0)
  } else {
    console.log('\nSome canonical_path tests failed!')
    process.exit(1)
  }
})()
