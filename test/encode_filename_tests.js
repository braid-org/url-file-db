var { url_file_db } = require('../index.js')

;(async () => {
  var db = await url_file_db.create('/tmp/test-db-' + Date.now(), () => {})
  var encode_filename = db.encode_filename

  console.log('Testing encode_filename...\n')

  var tests = [
    // Basic safe filenames
    ['hello.txt', 'hello.txt'],
    ['myfile', 'myfile'],

    // Windows reserved names
    ['con', 'co%6E'],
    ['prn', 'pr%6E'],
    ['aux', 'au%78'],
    ['nul', 'nu%6C'],
    ['com1', 'com%31'],
    ['lpt9', 'lpt%39'],

    // Windows reserved names with extensions
    ['con.txt', 'co%6E.txt'],
    ['prn.log', 'pr%6E.log'],
    ['aux.blah', 'au%78.blah'],

    // Windows reserved names with unsafe characters in extension
    ['con.txt:stream', 'co%6E.txt%3Astream'],
    ['prn.file*name', 'pr%6E.file%2Aname'],
    ['aux.file<>name', 'au%78.file%3C%3Ename'],

    // Windows reserved names with trailing dots
    ['con.', 'co%6E%2E'],
    ['prn.blah.', 'pr%6E.blah%2E'],
    ['aux.txt.', 'au%78.txt%2E'],

    // Unsafe characters
    ['file<name', 'file%3Cname'],
    ['file>name', 'file%3Ename'],
    ['file:name', 'file%3Aname'],
    ['file"name', 'file%22name'],
    ['file|name', 'file%7Cname'],
    ['file?name', 'file%3Fname'],
    ['file*name', 'file%2Aname'],
    ['file/name', 'file%2Fname'],
    ['file\\name', 'file%5Cname'],

    // Trailing dots and spaces
    ['file.', 'file%2E'],
    ['file ', 'file%20'],
    ['file.txt.', 'file.txt%2E'],

    // Null byte
    ['file\x00name', 'file%00name'],

    // Percent signs (need to be encoded to avoid decoding issues)
    ['file%name', 'file%25name'],
    ['100%', '100%25'],
    ['50% off', '50%25%20off'],
    ['%', '%25'],
  ]

  var passed = 0
  var failed = 0

  for (var [input, expected] of tests) {
    var result = encode_filename(input)
    var status = result === expected ? '✓' : '✗'

    if (result === expected) {
      passed++
      console.log(`${status} "${input}" -> "${result}"`)
    } else {
      failed++
      console.log(`${status} "${input}" -> "${result}" (expected "${expected}")`)
    }
  }

  console.log(`\n${passed} passed, ${failed} failed`)

  if (failed === 0) {
    console.log('\nAll encode_filename tests passed!')
    process.exit(0)
  } else {
    console.log('\nSome encode_filename tests failed!')
    process.exit(1)
  }
})()
