# url-file-db

Maps web URLs to filesystem paths with proper encoding and normalization, supporting treating paths as both files and directories through an index file convention.

## Installation

```bash
npm install url-file-db
```

## Quick Start

```javascript
const { url_file_db } = require('url-file-db')

// Create a database watching a directory
const db = await url_file_db.create('./data', (canonical_path) => {
  console.log('File changed:', canonical_path)
})

// Convert URL to canonical path
const path = url_file_db.url_path_to_canonical_path('/hello/world.png?foo=bar')
// -> '/hello/world.png'

// Read and write files
await db.write(path, Buffer.from('Hello, World!'))
const content = await db.read(path)

// Delete files
await db.delete(path)
```

## Features

- **URL to filesystem mapping** - Converts URL paths to filesystem paths with proper encoding
- **Index file convention** - URLs like `/a` and `/a/index` map to the same resource
- **Automatic file-to-directory conversion** - Writing `/a/b` after `/a` converts `/a` to a directory
- **Special character handling** - Encodes unsafe characters using percent-encoding
- **Windows reserved names** - Handles reserved names like `CON`, `PRN`, `AUX`, etc.
- **Case collision handling** - Detects case-insensitive filesystems and encodes conflicts
- **Path normalization** - Handles `/../`, `//`, query strings, fragments
- **Unicode normalization** - Applies NFC normalization for consistent handling
- **File watching** - Monitors directory for external changes via chokidar
- **Concurrency management** - Promise chains ensure sequential operations per path

## API

### `url_file_db.create(base_dir, callback?)`

Creates a database instance watching the specified directory.

- `base_dir` - Directory to store files
- `callback` - Optional function called when files change externally (not from `db.write`)

Returns a promise that resolves to a `db` object with `read`, `write`, and `delete` methods.

### `url_file_db.url_path_to_canonical_path(url_path)`

Converts a URL path to a canonical path. Removes query strings, fragments, normalizes `/index`, and decodes percent-encoding.

```javascript
url_file_db.url_path_to_canonical_path('/a/b/c')           // -> '/a/b/c'
url_file_db.url_path_to_canonical_path('/a/b?query=1')     // -> '/a/b'
url_file_db.url_path_to_canonical_path('/a/b#section')     // -> '/a/b'
url_file_db.url_path_to_canonical_path('/a/hello%20world') // -> '/a/hello world'
url_file_db.url_path_to_canonical_path('/a/b/index')       // -> '/a/b'
```

### `db.read(canonical_path)`

Reads a file by its canonical path. Returns a promise that resolves to the file contents (Buffer) or `null` if not found.

### `db.write(canonical_path, content)`

Writes content to a file by its canonical path. Creates directories as needed.

### `db.delete(canonical_path)`

Deletes a file by its canonical path. Returns `true` if deleted, `false` if not found.

### `url_file_db.encode_file_path_component(component)`

Encodes a path component for safe filesystem storage. Handles special characters, Windows reserved names, and trailing dots/spaces.

### `url_file_db.detect_case_sensitivity(dir)`

Detects whether a directory is on a case-sensitive filesystem. Returns a promise that resolves to `true` (case-sensitive) or `false` (case-insensitive).

## Index File Convention

The special path component `index` is treated as equivalent to its parent:

```javascript
// These URLs all normalize to the same canonical path '/a'
url_file_db.url_path_to_canonical_path('/a')           // -> '/a'
url_file_db.url_path_to_canonical_path('/a/index')     // -> '/a'
url_file_db.url_path_to_canonical_path('/a/index/foo') // -> '/a'

// Read and write are equivalent
await db.write(url_file_db.url_path_to_canonical_path('/a'), 'content')
await db.read(url_file_db.url_path_to_canonical_path('/a/index')) // Same result
```

## Automatic File-to-Directory Conversion

When you write to a nested path under an existing file, the file is automatically converted to a directory with an `index` file:

```javascript
// Write /a as a file
await db.write(url_file_db.url_path_to_canonical_path('/a'), 'original content')
// Filesystem: ./data/a

// Write /a/b - automatically converts /a to a directory
await db.write(url_file_db.url_path_to_canonical_path('/a/b'), 'nested content')
// Filesystem: ./data/a/index (contains "original content")
//             ./data/a/b     (contains "nested content")

// Reading /a still returns the original content
await db.read(url_file_db.url_path_to_canonical_path('/a')) // -> 'original content'
```

## Example

```javascript
const { url_file_db } = require('url-file-db')

const db = await url_file_db.create('./data', (canonical_path) => {
  console.log('Changed:', canonical_path)
})

// Query strings are stripped
const path1 = url_file_db.url_path_to_canonical_path('/api/user?id=123')
// -> '/api/user'

// /index paths are normalized
const path2 = url_file_db.url_path_to_canonical_path('/docs/index')
// -> '/docs'

// Special characters are encoded when written to disk
const path3 = url_file_db.url_path_to_canonical_path('/test/file with spaces.txt')
await db.write(path3, 'content')
// Creates ./data/test/file%20with%20spaces.txt

// Windows reserved names are encoded
const path4 = url_file_db.url_path_to_canonical_path('/test/CON')
await db.write(path4, 'content')
// Creates ./data/test/CO%4E (not CON)

// Case conflicts are handled on case-insensitive filesystems
await db.write(url_file_db.url_path_to_canonical_path('/test/File.txt'), 'uppercase')
await db.write(url_file_db.url_path_to_canonical_path('/test/file.txt'), 'lowercase')
// On Mac/Windows: ./data/test/File.txt and ./data/test/fil%65.txt

// File-to-directory conversion
await db.write(url_file_db.url_path_to_canonical_path('/a'), 'a content')
await db.write(url_file_db.url_path_to_canonical_path('/a/b'), 'b content')
await db.write(url_file_db.url_path_to_canonical_path('/a/b/c'), 'c content')
// Filesystem: ./data/a/index     (contains "a content")
//             ./data/a/b/index   (contains "b content")
//             ./data/a/b/c       (contains "c content")
```

## Testing

```bash
npm test
```
