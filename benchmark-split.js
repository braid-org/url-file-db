// Benchmark: split with filter vs match

const iterations = 1000000

// Test cases
const test_cases = [
  '/',
  '/a',
  '/a/b',
  '/a/b/c',
  '/a/b/c/d/e/f/g/h/i/j'
]

function approach1(key) {
  return key.slice(1).split('/').filter(Boolean)
}

function approach2(key) {
  return key.match(/[^/]+/g) || []
}

console.log('Warming up...\n')
// Warmup
for (let i = 0; i < 10000; i++) {
  for (let test of test_cases) {
    approach1(test)
    approach2(test)
  }
}

console.log('Testing correctness:')
for (let test of test_cases) {
  const result1 = approach1(test)
  const result2 = approach2(test)
  const match = JSON.stringify(result1) === JSON.stringify(result2)
  console.log(`  ${test.padEnd(20)} → ${JSON.stringify(result1).padEnd(30)} ${match ? '✓' : '✗'}`)
}

console.log('\nBenchmarking...\n')

// Benchmark approach 1: slice + split + filter
for (let test of test_cases) {
  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) {
    approach1(test)
  }
  const end = process.hrtime.bigint()
  const ms = Number(end - start) / 1000000
  console.log(`Approach 1 (slice+split+filter) for ${test.padEnd(20)}: ${ms.toFixed(2)}ms`)
}

console.log()

// Benchmark approach 2: match
for (let test of test_cases) {
  const start = process.hrtime.bigint()
  for (let i = 0; i < iterations; i++) {
    approach2(test)
  }
  const end = process.hrtime.bigint()
  const ms = Number(end - start) / 1000000
  console.log(`Approach 2 (match)            for ${test.padEnd(20)}: ${ms.toFixed(2)}ms`)
}

console.log('\n--- Summary ---')
console.log('Approach 1: key.slice(1).split(\'/\').filter(Boolean)')
console.log('Approach 2: key.match(/[^/]+/g) || []')
