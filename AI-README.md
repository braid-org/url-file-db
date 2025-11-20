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

The function `ensure_unique_case_insensitive_path_component(component, existing_icomponents)` implements this by:
1. Checking if the lowercased component collides with existing lowercased components
2. If collision detected, percent-encode the last letter (working right-to-left)
3. Repeat until no collision exists

### Naming Convention: `i` Prefix

Throughout the codebase, variables with an `i` prefix represent **case-insensitive** (lowercased) versions:
- `icomponent` = `component.toLowerCase()`
- `ifile_path_component` = `file_path_component.toLowerCase()`
- `existing_icomponents` = Set of lowercased components

This convention makes it immediately clear which variables are used for case-insensitive comparisons.

## Architecture

### Node Tree Structure

The database maintains an in-memory tree mirroring the filesystem:

```javascript
{
  file_path_component: 'hello%20world',  // Encoded filesystem name
  component_to_node: Map,                 // Decoded component → child node
  icomponent_to_ifile_path_components: Map, // Lowercased component → Set of lowercased filesystem names
  promise_chain: Promise,                 // Ensures sequential operations
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

Each node has a `promise_chain` that serializes operations on that path. Write and delete operations are chained to prevent race conditions:

```javascript
node.promise_chain = node.promise_chain.then(() => actual_operation())
```

### File Watching

Uses `chokidar` to watch the base directory for external changes. The `chokidar_handler` builds the node tree and calls the user callback for unanticipated changes (i.e., not from `db.write`).

## Key Functions

### Path Conversion Functions

- `url_path_to_canonical_path(url_path)` - Converts URL path to canonical form
- `file_path_to_canonical_path(file_path)` - Converts filesystem path to canonical form
- `encode_file_path_component(component)` - Encodes component for filesystem safety
- `decode_file_path_component(file_path_component)` - Decodes filesystem component back to canonical form

### Database Operations

- `db.read(canonical_path)` - Returns file contents or null
- `db.write(canonical_path, content)` - Writes file, handling directory creation and file-to-directory conversion
- `db.delete(canonical_path)` - Deletes file, returns true/false

## Testing Strategy

Tests are organized by functionality:
- Path encoding/decoding round-trips
- URL path normalization (query strings, fragments, index handling)
- Case collision resolution
- File-to-directory conversion
- Edge cases (Windows reserved names, special characters)

## Common Pitfalls

1. **Canonical vs File Paths**: Always use canonical paths with `db.read/write/delete`. File paths are internal.
2. **Index Normalization**: Remember that `/a/index` and `/a` refer to the same resource.
3. **Case Sensitivity**: The library auto-detects filesystem case sensitivity per database instance.
4. **Percent-Encoding**: Some characters get double-encoded (once in URL, once for filesystem safety).

## Module Structure

- `canonical_path.js` - Path conversion and encoding utilities
- `index.js` - Main database API with node tree, file watching, and operations
- `test/canonical_path_tests.js` - Path conversion tests
- `test/test.js` - Integration tests for database operations

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
