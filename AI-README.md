# AI-README.md

## Overview

`url-file-db` is a Node.js library that maps web URLs to filesystem paths with proper encoding and normalization. It handles the complexities of converting URL paths to filesystem-safe paths while maintaining semantic equivalence.

## Core Concepts

### Canonical Paths

A **canonical path** is the normalized representation of a URL path after:
- Removing query strings and fragments
- Decoding percent-encoding
- Normalizing `/index` components (see Index Convention)
- Applying Unicode NFC normalization

Example: `/hello%20world?foo=bar` → `/hello world`

### Index Convention

The path component `index` is treated as semantically equivalent to its parent directory:
- `/a` and `/a/index` both map to canonical path `/a`
- `/a/index/foo` also maps to `/a` (trailing parts after index are ignored)

This allows the same resource to be accessed via multiple URL forms.

### File Path Components

When writing to the filesystem, canonical path components are encoded to handle:
- Special characters (`<`, `>`, `:`, `%`, `/`, etc.) via percent-encoding
- Windows reserved names (`CON`, `PRN`, `AUX`, etc.) by encoding at least one character
- Trailing dots and spaces (problematic on Windows)
- Case collisions on case-insensitive filesystems

### Case Collision Handling

On case-insensitive filesystems (macOS, Windows), the library detects when two canonical paths would map to the same filesystem path (e.g., `/File.txt` and `/file.txt`). The second path is modified by percent-encoding letters until it becomes unique.

The function `encode_to_avoid_icase_collision(component, existing_icomponents)` implements this by:
1. Checking if the lowercased component collides with existing lowercased components
2. If collision detected, percent-encode the last letter (working right-to-left)
3. Repeat until no collision exists

### Naming Convention: `i` Prefix

Throughout the codebase, variables with an `i` prefix represent **case-insensitive** (lowercased) versions:
- `icomponent` = `component.toLowerCase()`
- `ifile_path_component` = `file_path_component.toLowerCase()`
- `existing_icomponents` = Set of lowercased components

This convention makes it immediately clear which variables are used for case-insensitive comparisons.

## API Changes

### v0.0.23+

The `create` function now accepts an `options` object as the fifth parameter:
```javascript
url_file_db.create(base_dir, meta_dir, callback?, filter_cb?, options?)
```

Options:
- `stability_threshold` (default: 100ms) - Time to wait for file writes to stabilize before triggering events. Also used for chokidar's `awaitWriteFinish` and the anticipated events timeout.
- `scan_interval_ms` (default: 20000ms) - Interval for periodic filesystem scanning to catch any changes chokidar might miss.

### v0.0.17

The `create` function signature changed:
```javascript
// Old: url_file_db.create(base_dir, callback?, meta_dir?)
// New: url_file_db.create(base_dir, meta_dir, callback?, filter_cb?)
```

- `meta_dir` is now required and moved to second position
- Added optional `filter_cb` for filtering file events

### Features Added Over Time

- **Metadata persistence**: Files are tracked across database restarts
- **Read-only support**: Mark files as read-only while allowing programmatic writes
- **Event filtering**: Filter which file events to process
- **Improved serialization**: Uses `within_fiber` pattern throughout for better concurrency
- **Anticipated events**: Reference-counted tracking of db.write operations to suppress duplicate callbacks
- **Periodic scanning**: Fallback scanner catches any file changes that chokidar might miss

## Architecture

### Node Tree Structure

The database maintains an in-memory tree mirroring the filesystem:

```javascript
{
  file_path_component: 'hello%20world',  // Encoded filesystem name
  component_to_node: Map,                 // Decoded component → child node
  icomponent_to_ifile_path_components: Map, // Lowercased component → Set of lowercased filesystem names
  directory_promise: null | Promise       // null = file, Promise = directory
}
```

### File-to-Directory Conversion

When writing `/a/b` after `/a` exists as a file:
1. The file at `/a` is renamed to `/a/index`
2. `/a` becomes a directory
3. `/a/b` is written as a new file

This maintains the semantic equivalence of `/a` and `/a/index` while allowing nested paths.

### Concurrency Management

All database operations are serialized per canonical path using `within_fiber`:

```javascript
within_fiber(`db:${canonical_path}`, async () => {
  // Operations on the same path are queued and executed sequentially
})
```

This ensures that concurrent reads, writes, and deletes to the same path don't cause race conditions.

### File Watching

Uses `chokidar` to watch the base directory for external changes. The `chokidar_handler`:
- Builds and maintains the node tree
- Calls the user callback for new files or modified files
- Uses `within_fiber` to serialize events per path, preventing duplicate callbacks
- Supports optional `filter_cb` to skip certain files/events
- Tracks file modification times using BigInt for nanosecond precision
- Configured with `awaitWriteFinish` to wait for writes to stabilize before triggering events

### Anticipated Events

When `db.write` is called, the path is added to `anticipated_events` (a Map with reference counting) to suppress callbacks from chokidar or the scanner for that write. The reference count handles rapid successive writes to the same path. After `stability_threshold` milliseconds, the count is decremented.

### Periodic Scanner

A fallback scanner runs every `scan_interval_ms` to catch any file changes that chokidar might miss (rare edge cases on some filesystems). The scanner:
- Recursively walks the directory tree
- Compares file mtimes against stored metadata
- Triggers callbacks for any files with newer mtimes
- Respects `anticipated_events` to avoid duplicate callbacks
- Respects `filter_cb` to skip certain files

### Meta Storage

The metadata storage (previously in meta.js) is now inline in index.js:
- Stores metadata in a separate directory as JSON files
- Tracks when files were first seen and last modified
- Supports custom metadata fields via `update_meta`
- Uses `within_fiber` for serialization instead of promise chains
- Handles case-insensitive filesystems with collision avoidance
- Persists across database restarts

## Key Functions

### Path Conversion Functions

- `url_path_to_canonical_path(url_path)` - Converts URL path to canonical form
- `file_path_to_canonical_path(file_path)` - Converts filesystem path to canonical form
- `encode_file_path_component(component)` - Encodes component for filesystem safety
- `decode_file_path_component(file_path_component)` - Decodes filesystem component back to canonical form

### Database Operations

#### File Operations
- `db.read(canonical_path)` - Returns file contents or null
- `db.write(canonical_path, content)` - Writes file, handling directory creation and file-to-directory conversion
- `db.delete(canonical_path)` - Deletes file and its metadata, returns true/false

#### Metadata Operations
- `db.has(canonical_path)` - Checks if file has been seen before
- `db.list()` - Returns array of all known canonical paths
- `db.get_meta(canonical_path)` - Gets metadata object for a path
- `db.set_meta(canonical_path, meta)` - Sets complete metadata
- `db.update_meta(canonical_path, updates)` - Updates specific metadata fields

#### Read-Only Operations
- `db.is_read_only(canonical_path)` - Checks if file is marked read-only
- `db.set_read_only(canonical_path, value)` - Sets/clears read-only flag

## Testing Strategy

Tests are organized by functionality:
- Path encoding/decoding round-trips
- URL path normalization (query strings, fragments, index handling)
- Case collision resolution
- File-to-directory conversion
- Edge cases (Windows reserved names, special characters)
- Metadata persistence and operations
- Read-only file handling
- Callback behavior for new vs existing files
- Concurrent operations and serialization

The test runner supports filtering:
```bash
node test/test.js --filter="meta"  # Run only meta-related tests
node test/test.js --grep="delete"  # Run only delete-related tests
```

## Common Pitfalls

1. **Canonical vs File Paths**: Always use canonical paths with `db.read/write/delete`. File paths are internal.
2. **Index Normalization**: Remember that `/a/index` and `/a` refer to the same resource.
3. **Case Sensitivity**: The library auto-detects filesystem case sensitivity per database instance.
4. **Percent-Encoding**: Some characters get double-encoded (once in URL, once for filesystem safety).

## Module Structure

- `canonical_path.js` - Path conversion and encoding utilities
- `index.js` - Main database API including:
  - Node tree management for filesystem mirroring
  - File watching with chokidar
  - Database operations (read/write/delete)
  - Inline meta storage implementation (previously in meta.js)
  - Read-only file support
  - Event serialization using `within_fiber` utility
- `test/canonical_path_tests.js` - Path conversion tests
- `test/test.js` - Integration tests with `--filter` support for selective testing

## Standard Release Workflow

When making changes and publishing a new version:

1. **Bump version** in `package.json`
2. **Run tests** to ensure everything works:
   ```bash
   npm test
   node test/canonical_path_tests.js
   ```
3. **Commit changes** with descriptive message following the pattern:
   ```bash
   git add -A
   git commit -m "0.0.X - Brief description

   Detailed explanation of changes.

   🤖 Generated with [Claude Code](https://claude.com/claude-code)

   Co-Authored-By: Claude <noreply@anthropic.com>"
   ```
4. **Push to remote**:
   ```bash
   git push
   ```
5. **Publish to npm**:
   ```bash
   npm publish
   ```
