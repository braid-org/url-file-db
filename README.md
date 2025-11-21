# url-file-db

Maps web URLs to filesystem paths with proper encoding and normalization, supporting treating paths as both files and directories through an index file convention.

## Installation

```bash
npm install url-file-db
```

## Quick Start

```javascript
const { url_file_db } = require('url-file-db')

// Create a database with separate metadata storage
const db = await url_file_db.create(
  './data',           // Base directory for files
  './data-meta',      // Directory for metadata (required)
  (canonical_path) => {  // Optional: callback for external changes
    console.log('File changed:', canonical_path)
  }
)

// Convert URL to canonical path
const path = url_file_db.get_canonical_path('/hello/world.png?foo=bar')
// -> '/hello/world.png'

// Read and write files
await db.write(path, Buffer.from('Hello, World!'))
const content = await db.read(path)

// Check if file has been seen before
const hasFile = db.has(path)  // true

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
- **Metadata persistence** - Tracks file history and custom metadata across restarts
- **Read-only support** - Mark files as read-only while still allowing programmatic writes
- **Event filtering** - Optional callback to filter which file events to process
- **Concurrency management** - Uses fiber-based serialization for safe concurrent operations

## API

### `url_file_db.create(base_dir, meta_dir, callback?, filter_cb?)`

Creates a database instance watching the specified directory.

- `base_dir` - Directory to store files (required)
- `meta_dir` - Directory to store metadata (required)
- `callback` - Optional function called when files change externally or are new
- `filter_cb` - Optional function `(fullpath, event) => boolean` to filter which events to process

Returns a promise that resolves to a `db` object with methods for file operations and metadata management.

### Path Conversion Functions

#### `url_file_db.get_canonical_path(path)`
#### `url_file_db.url_path_to_canonical_path(url_path)` (alias)

Converts a URL path to a canonical path. Removes query strings, fragments, normalizes `/index`, and decodes percent-encoding.

```javascript
url_file_db.url_path_to_canonical_path('/a/b/c')           // -> '/a/b/c'
url_file_db.url_path_to_canonical_path('/a/b?query=1')     // -> '/a/b'
url_file_db.url_path_to_canonical_path('/a/b#section')     // -> '/a/b'
url_file_db.url_path_to_canonical_path('/a/hello%20world') // -> '/a/hello world'
url_file_db.url_path_to_canonical_path('/a/b/index')       // -> '/a/b'
```

### Database Methods

#### `db.read(canonical_path)`

Reads a file by its canonical path. Returns a promise that resolves to the file contents (Buffer) or `null` if not found.

#### `db.write(canonical_path, content)`

Writes content to a file by its canonical path. Creates directories as needed. Updates metadata to track the file has been seen.

#### `db.delete(canonical_path)`

Deletes a file by its canonical path. Returns `true` if deleted, `false` if not found. Also removes associated metadata.

### Metadata Methods

#### `db.has(canonical_path)`

Returns `true` if the file has been seen before (exists in metadata), `false` otherwise.

#### `db.list()`

Returns an array of all canonical paths that have been seen.

#### `db.get_meta(canonical_path)`

Returns the metadata object for a path, or `undefined` if not found.

#### `db.set_meta(canonical_path, meta_data)`

Sets the complete metadata object for a path.

#### `db.update_meta(canonical_path, updates)`

Updates specific fields in the metadata, merging with existing data.

#### `db.delete_meta(canonical_path)`

Deletes the metadata for a path.

### Read-Only Methods

#### `db.is_read_only(canonical_path)`

Returns `true` if the file is marked as read-only, `false` otherwise.

#### `db.set_read_only(canonical_path, read_only)`

Sets or clears the read-only flag for a file. Note: Files marked as read-only can still be written via `db.write()`.

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

// Create database with metadata storage and optional event filtering
const db = await url_file_db.create(
  './data',
  './data-meta',
  (canonical_path) => {
    console.log('File changed or new:', canonical_path)
  },
  (fullpath, event) => {
    // Optional: filter out certain files/directories
    if (fullpath.includes('node_modules')) return false
    if (fullpath.includes('.git')) return false
    return true
  }
)

// Query strings are stripped
const path1 = url_file_db.get_canonical_path('/api/user?id=123')
// -> '/api/user'

// /index paths are normalized
const path2 = url_file_db.get_canonical_path('/docs/index')
// -> '/docs'

// Track files with metadata
await db.write(path1, 'user data')
console.log(db.has(path1))  // true
console.log(db.list())       // ['/api/user']

// Add custom metadata
await db.update_meta(path1, {
  contentType: 'application/json',
  lastModified: Date.now()
})
console.log(db.get_meta(path1))

// Mark files as read-only (still writable via db.write)
await db.set_read_only(path2, true)
console.log(db.is_read_only(path2))  // true

// Special characters are encoded when written to disk
const path3 = url_file_db.get_canonical_path('/test/file with spaces.txt')
await db.write(path3, 'content')
// Creates ./data/test/file%20with%20spaces.txt

// Windows reserved names are encoded
const path4 = url_file_db.get_canonical_path('/test/CON')
await db.write(path4, 'content')
// Creates ./data/test/CO%4E (not CON)

// Case conflicts are handled on case-insensitive filesystems
await db.write(url_file_db.get_canonical_path('/test/File.txt'), 'uppercase')
await db.write(url_file_db.get_canonical_path('/test/file.txt'), 'lowercase')
// On Mac/Windows: ./data/test/File.txt and ./data/test/fil%65.txt

// File-to-directory conversion
await db.write(url_file_db.get_canonical_path('/a'), 'a content')
await db.write(url_file_db.get_canonical_path('/a/b'), 'b content')
await db.write(url_file_db.get_canonical_path('/a/b/c'), 'c content')
// Filesystem: ./data/a/index     (contains "a content")
//             ./data/a/b/index   (contains "b content")
//             ./data/a/b/c       (contains "c content")
```

## Testing

```bash
npm test
```
