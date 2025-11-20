var {
  decode_path,
  get_canonical_path,
  decode_component,
  encode_file_path_component,
  encode_canonical_path_component,
  encode_to_avoid_icase_collision,
  encode_char
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
  // decode_path - New Universal Parser
  // ===================
  console.log('--- decode_path (new universal parser) ---\n')

  await runTest(
    'parse URL path with encoding',
    () => decode_path('/hello%20world/test'),
    ['hello world', 'test']
  )

  await runTest(
    'parse file path',
    () => decode_path('/hello/world'),
    ['hello', 'world']
  )

  await runTest(
    'parse canonical path',
    () => decode_path('/hello%2Fworld/test'),
    ['hello/world', 'test']
  )

  // Note: Query string and fragment handling was removed per user request.

  await runTest(
    'parse path with index normalization',
    () => decode_path('/docs/index/foo'),
    ['docs']
  )

  await runTest(
    'parse path without leading slash',
    () => decode_path('hello/world'),
    ['hello', 'world']
  )

  await runTest(
    'parse path with dots',
    () => decode_path('/a/./b/../c'),
    ['a', 'c']
  )

  await runTest(
    'parse root path',
    () => decode_path('/'),
    []
  )

  await runTest(
    'parse empty path',
    () => decode_path(''),
    []
  )

  // ===================
  // encode_canonical_path_component
  // ===================
  console.log('\n--- encode_canonical_path_component ---\n')

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

  // Note: decode_canonical_path_component functionality is now part of decode_component
  // which includes normalization


  // ===================
  // decode_path / get_canonical_path
  // ===================
  console.log('\n--- decode_path / get_canonical_path ---\n')

  // decode_path already tested above, these are additional tests
  await runTest(
    'get_canonical_path from /a/b/c',
    () => get_canonical_path('/a/b/c'),
    '/a/b/c'
  )

  await runTest(
    'get_canonical_path from /',
    () => get_canonical_path('/'),
    '/'
  )

  await runTest(
    'get_canonical_path keeps spaces readable',
    () => get_canonical_path('/hello world/test'),
    '/hello world/test'
  )


  // ===================
  // encode_file_path_component / decode_component
  // ===================
  console.log('\n--- encode_file_path_component / decode_component ---\n')

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
    () => decode_component('hello%20world'),
    'hello world'
  )


  // ===================
  // Additional get_canonical_path tests
  // ===================
  console.log('\n--- Additional get_canonical_path tests ---\n')

  await runTest(
    'simple path',
    () => get_canonical_path('/a/b/c'),
    '/a/b/c'
  )

  await runTest(
    'path with encoded component gets decoded',
    () => get_canonical_path('/a/hello%20world/c'),
    '/a/hello world/c'
  )

  await runTest(
    'path without leading slash (allowed now)',
    () => get_canonical_path('a/b/c'),
    '/a/b/c'
  )

  await runTest(
    'path with index',
    () => get_canonical_path('/a/b/index'),
    '/a/b'
  )

  await runTest(
    'path with index at root',
    () => get_canonical_path('/index'),
    '/'
  )

  await runTest(
    'path with index and stuff after',
    () => get_canonical_path('/a/index/b/c'),
    '/a'
  )


  // Note: url_path_to_canonical_path was removed.
  // Query string and fragment handling was removed per user request.
  // All path handling is now done through decode_path and get_canonical_path.


  // ===================
  // encode_to_avoid_icase_collision
  // ===================
  console.log('\n--- encode_to_avoid_icase_collision ---\n')

  await runTest(
    'no collision',
    () => {
      var existing = new Set(['hello'])
      return encode_to_avoid_icase_collision('world', existing)
    },
    'world'
  )

  await runTest(
    'with collision',
    () => {
      var existing = new Set(['hello'])
      return encode_to_avoid_icase_collision('hello', existing)
    },
    'hell%6F'
  )

  await runTest(
    'collision with %XX sequence to skip',
    () => {
      // Start with 'ab' already encoded last char, need to collide twice
      // to force skipping over the %XX and encoding the previous char
      var existing = new Set(['a%42', 'a%34%32'])  // 'aB' and 'a42' in lowercase
      return encode_to_avoid_icase_collision('a%42', existing)
    },
    '%61%42'
  )

  await runTest(
    'collision skips non-letter characters',
    () => {
      // 'a1' collides with existing 'a1'
      // Should encode the 'a', not the '1', since '1' has no case variants
      var existing = new Set(['a1'])
      return encode_to_avoid_icase_collision('a1', existing)
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
