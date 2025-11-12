# url-file-db

Maps web URLs to filesystem paths with proper encoding and normalization, supporting treating paths as both files and directories through an index file convention.

## Features

- **URL to filesystem mapping**: Converts URL paths like `/hello/world.png` to filesystem paths
- **Index file convention**: URLs like `/a` and `/a/index` map to the same resource, allowing paths to be both files and directories
- **Automatic file-to-directory conversion**: Writing `/a/b` after `/a` automatically converts `/a` to a directory with an `index` file
- **Async directory creation**: Directory operations use promises to ensure proper sequencing
- **Special character handling**: Encodes unsafe characters (spaces, null bytes, etc.) using percent-encoding
- **Windows reserved names**: Handles reserved names like `CON`, `PRN`, `AUX`, etc.
- **Case sensitivity handling**: Detects case-insensitive filesystems (Mac/Windows) and encodes conflicts
- **Path normalization**: Handles `/../`, `//`, query strings, and ensures paths stay within base directory
- **Unicode normalization**: Applies NFC normalization for consistent handling of composed characters (é vs e + combining accent)
- **File watching**: Monitors directory for changes and maintains key-to-filepath mapping
- **Concurrency management**: Promise chains ensure sequential operations per key, preventing race conditions

## Installation

```bash
npm install url-file-db
```

## API

```javascript
const { url_file_db } = require('url-file-db');

// Create a database watching base_dir
const db = await url_file_db.create('./data', (key) => {
  console.log('File changed:', key);
});

// Convert URL to key (removes query strings, normalizes /index)
const key = url_file_db.get_key('/hello/world.png?foo=bar');  // -> '/hello/world.png'

// Read file by key
const content = await db.read(key);

// Write file by key
await db.write(key, Buffer.from('Hello, World!'));
```

## Index File Convention

The special path component `index` is treated as equivalent to its parent:

```javascript
// These URLs all normalize to the same key '/a'
url_file_db.get_key('/a')              // -> '/a'
url_file_db.get_key('/a/index')        // -> '/a'
url_file_db.get_key('/a/index/foo')    // -> '/a'

// Write to /a as a file
await db.write(url_file_db.get_key('/a'), 'content for a');

// These are equivalent
await db.read(url_file_db.get_key('/a'));       // Reads from /a or /a/index
await db.read(url_file_db.get_key('/a/index')); // Same key, same result
```

## Automatic File-to-Directory Conversion

When you write to a nested path under an existing file, the file is automatically converted to a directory with an `index` file:

```javascript
// Write /a as a file
await db.write(url_file_db.get_key('/a'), 'original content');
// Filesystem: ./data/a

// Write /a/b - automatically converts /a to a directory
await db.write(url_file_db.get_key('/a/b'), 'nested content');
// Filesystem: ./data/a/index (contains "original content")
//             ./data/a/b     (contains "nested content")

// Reading /a still returns the original content
const content = await db.read(url_file_db.get_key('/a'));  // -> 'original content'
```

## How it works

1. **URL to key conversion**: `get_key()` normalizes URLs (removes query strings, `/index` paths, decodes percent-encoding)
2. **Key to filepath mapping**: Keys are mapped to filesystem paths with proper encoding
3. **Directory detection**: Nodes track whether they're directories via `directory_promise`
4. **Index file handling**: Directories store their content in an `index` file
5. **Safe encoding**: Unsafe characters, Windows reserved names, and case conflicts are percent-encoded
6. **Concurrency safety**: Per-node promise chains serialize all operations

## Example

```javascript
const { url_file_db } = require('url-file-db');

const db = await url_file_db.create('./data', (key) => {
  console.log('Changed:', key);
});

// Query strings are stripped
const key1 = url_file_db.get_key('/api/user?id=123');  // -> '/api/user'

// /index paths are normalized
const key2 = url_file_db.get_key('/docs/index');       // -> '/docs'

// Special characters are encoded when written to disk
const key3 = url_file_db.get_key('/test/file with spaces.txt');
await db.write(key3, 'content');  // Creates ./data/test/file%20with%20spaces.txt

// Windows reserved names are encoded
const key4 = url_file_db.get_key('/test/CON');
await db.write(key4, 'content');  // Creates ./data/test/CO%4E (not CON)

// Case conflicts are handled on case-insensitive filesystems
await db.write(url_file_db.get_key('/test/File.txt'), 'uppercase');
await db.write(url_file_db.get_key('/test/file.txt'), 'lowercase');
// On Mac/Windows: ./data/test/File.txt and ./data/test/fil%65.txt

// File-to-directory conversion
await db.write(url_file_db.get_key('/a'), 'a content');
await db.write(url_file_db.get_key('/a/b'), 'b content');
await db.write(url_file_db.get_key('/a/b/c'), 'c content');
// Filesystem: ./data/a/index (contains "a content")
//             ./data/a/b/index (contains "b content")
//             ./data/a/b/c (contains "c content")
```

## Testing

```bash
npm test
```
