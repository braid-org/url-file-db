
void (() => {

  // Main API
  url_file_db = {
    create: async (base_dir, cb) => {
      var db = {}

      base_dir = require('path').resolve(base_dir)

      // Set filesystem operations once
      var fs = require('fs').promises
      db._readFile = fs.readFile.bind(fs)
      db._writeFile = fs.writeFile.bind(fs)
      db._mkdir = fs.mkdir.bind(fs)
      db._unlink = fs.unlink.bind(fs)

      await db._mkdir(base_dir, { recursive: true })

      var is_case_sensitive = await detect_case_sensitivity(base_dir)

      var root = create_node('/')
      // Mark root as a directory since base_dir is a directory
      root.directory_promise = Promise.resolve()

      function chokidar_handler(fullpath, event) {
        if (!fullpath.startsWith(base_dir + '/')) {
          return
        }
        var path = fullpath.slice(base_dir.length)
        var parts = path.slice(1).split('/')

        if (event.startsWith('add')) {
          var node = root
          for (var i = 0; i < parts.length; i++) {
            var part = parts[i]
            var key = url_component_to_key(part)

            if (!node.key_to_part.has(key)) {
              node.key_to_part.set(key, create_node(part))
            }

            if (!is_case_sensitive) {
              var ipart = part.toLowerCase()
              var ikey = key.toLowerCase()

              if (!node.ikey_to_iparts.has(ikey)) {
                node.ikey_to_iparts.set(ikey, new Set())
              }
              node.ikey_to_iparts.get(ikey).add(ipart)
            }

            node = node.key_to_part.get(key)
            if (node.part !== part)
              throw new Error('Corruption detected - should never happen')

            // If this is the final part and it's a directory, mark it as such
            if (i === parts.length - 1 && event === 'addDir') {
              node.directory_promise = Promise.resolve()
            }
          }
        }

        if (event.startsWith('unlink')) {
          var node = root
          for (var i = 0; i < parts.length; i++) {
            var part = parts[i]
            var key = url_component_to_key(part)
            if (i === parts.length - 1) {
              node.key_to_part.delete(key)

              if (!is_case_sensitive) {
                var ipart = part.toLowerCase()
                var ikey = key.toLowerCase()
                var ikey_set = node.ikey_to_iparts.get(ikey)
                if (ikey_set) {
                  ikey_set.delete(ipart)
                  if (!ikey_set.size) {
                    node.ikey_to_iparts.delete(ikey)
                  }
                }
              }
            } else {
              node = node.key_to_part.get(key)
              if (!node) break // File not in tree, ignore deletion
            }
          }
        }

        if (!event.startsWith('unlink')) {
          var key = url_component_to_key(path)
          // Normalize /index to / and /a/index to /a
          if (key.endsWith('/index')) {
            key = key.slice(0, -6) // Remove '/index'
            if (!key) key = '/'
          }
          cb(key)
        }
      }
      var c = require('chokidar').watch(base_dir, {
          useFsEvents: true,
          usePolling: false,
      })
      for (let e of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'])
        c.on(e, x => chokidar_handler(x, e))

      db.read = async key => {
        var keys = key.match(/[^/]+/g) || []
        var node = root
        var fullpath = base_dir

        for (var key of keys) {
          node = node.key_to_part.get(key)
          // Node doesn't exist in tree - file not found
          if (!node) return null
          if (node.directory_promise) await node.directory_promise
          fullpath += '/' + node.part
        }

        // If the node is a directory, read from the index file inside it
        if (node.directory_promise) fullpath += '/index'

        // Serialize on the node's promise chain
        return await (node.promise_chain = node.promise_chain.then(async () => {
          try {
            return await db._readFile(fullpath)
          } catch (e) {
            // File doesn't exist or can't be read - return null
            return null
          }
        }))
      }

      db.delete = async key => {
        var keys = key.match(/[^/]+/g) || []

        // Navigate to the parent node
        var node = root
        var fullpath = base_dir
        var parent_node = null
        var last_key = null

        for (var i = 0; i < keys.length; i++) {
          var key_part = keys[i]
          parent_node = node
          last_key = key_part
          node = node.key_to_part.get(key_part)

          // Node doesn't exist in tree - file not found
          if (!node) return false

          if (node.directory_promise) await node.directory_promise
          fullpath += '/' + node.part
        }

        // If the node is a directory, delete the index file inside it
        if (node.directory_promise) {
          fullpath += '/index'
        }

        // Serialize on the node's promise chain
        return await (node.promise_chain = node.promise_chain.then(async () => {
          try {
            // Only remove node from parent's tree if it's not a directory
            // Directories may have other children, so we keep the node
            if (!node.directory_promise && parent_node && last_key) {
              parent_node.key_to_part.delete(last_key)

              // Clean up case-insensitive tracking
              if (!is_case_sensitive) {
                var ikey = last_key.toLowerCase()
                var ipart = node.part.toLowerCase()
                var ikey_set = parent_node.ikey_to_iparts.get(ikey)
                if (ikey_set) {
                  ikey_set.delete(ipart)
                  if (!ikey_set.size) {
                    parent_node.ikey_to_iparts.delete(ikey)
                  }
                }
              }
            }

            // Delete the file from filesystem
            await db._unlink(fullpath)

            return true
          } catch (e) {
            // File doesn't exist or can't be deleted
            return false
          }
        }))
      }

      db.write = async (key, stuff) => {
        var keys = key.match(/[^/]+/g) || []
        var node = root
        var fullpath = base_dir

        // Build path and create missing directories/nodes
        for (var i = 0; i < keys.length; i++) {
          var key_part = keys[i]

          // If node doesn't exist in tree, create it
          if (!node.key_to_part.has(key_part)) {
            var encoded_part = encode_filename(key_part)

            // On case-insensitive filesystems, check for case collisions
            if (!is_case_sensitive) {
              var ikey = key_part.toLowerCase()
              var iparts

              // Get or create iparts set
              if (node.ikey_to_iparts.has(ikey)) {
                iparts = node.ikey_to_iparts.get(ikey)
              } else {
                iparts = new Set()
                node.ikey_to_iparts.set(ikey, iparts)
              }

              // Resolve any case collisions
              encoded_part = resolve_case_collision(encoded_part, iparts)

              // Add to iparts set (single place to add)
              iparts.add(encoded_part.toLowerCase())
            }

            var new_node = create_node(encoded_part)
            node.key_to_part.set(key_part, new_node)
            fullpath += '/' + encoded_part

            // If it's a directory (not the last part), create it on filesystem
            if (i < keys.length - 1) {
              new_node.directory_promise = db._mkdir(fullpath, { recursive: true })
              await new_node.directory_promise
            }

            node = new_node
          } else {
            node = node.key_to_part.get(key_part)

            // If we need this to be a directory but it's currently a file
            if (i < keys.length - 1 && !node.directory_promise) {
              // Convert file to directory
              // Set directory_promise immediately so future operations know it's a directory
              var dir_fullpath = fullpath + '/' + node.part
              var convert_promise = (async () => {
                // Wait for any pending operations on this node
                await node.promise_chain

                // Read the existing file content
                var old_content = await db._readFile(dir_fullpath)

                // Delete the file
                await db._unlink(dir_fullpath)

                // Create directory
                await db._mkdir(dir_fullpath, { recursive: true })

                // Write content to index file
                await db._writeFile(dir_fullpath + '/index', old_content)
              })()

              node.directory_promise = convert_promise
              await node.directory_promise
            }

            if (node.directory_promise) await node.directory_promise
            fullpath += '/' + node.part
          }
        }

        // If the node is a directory, write to the index file inside it
        if (node.directory_promise) fullpath += '/index'

        // Serialize on the node's promise chain
        return await (node.promise_chain = node.promise_chain.then(async () => {
          // Write the file
          await db._writeFile(fullpath, stuff)
        }))
      }

      return db
    },
    get_key,
    encode_filename
  }

  // Utility functions

  function get_key(url) {
    var key = require('path').normalize('/' +
      url_component_to_key(url.split('?')[0]))

    // Normalize away /index and anything after it
    // /a/b/c/index/blah/bloop -> /a/b/c
    // /a/b/c/index -> /a/b/c
    var parts = key.split('/')
    var index_pos = parts.indexOf('index')
    if (index_pos !== -1) {
      key = parts.slice(0, index_pos).join('/')
      if (!key) {
        key = '/'
      }
    }

    return key
  }

  async function exists(fullpath) {
    try {
      return await require('fs').promises.stat(fullpath)
    } catch (e) {
      // File doesn't exist - return falsy
      // This is hit on case-sensitive filesystems during case sensitivity detection
    }
  }

  async function detect_case_sensitivity(dir) {
    var test_path = `${dir}/.case-test-${Math.random().toString(36).slice(2)}`
    await require('fs').promises.writeFile(test_path, '')
    var is_case_sensitive = !await exists(test_path.toUpperCase())
    await require('fs').promises.unlink(test_path)
    return is_case_sensitive
  }

  function url_component_to_key(url) {
    return decodeURIComponent(url).normalize()
  }

  function create_node(part) {
    return {
      part,
      key_to_part: new Map(),
      ikey_to_iparts: new Map(),
      promise_chain: Promise.resolve(),
      directory_promise: null
    }
  }

  // Encode a single character as %XX
  function encode_char(char) {
    return '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
  }

  // Encode unsafe characters in a string
  function encode_unsafe(str) {
    // Characters that are problematic on various platforms:
    // < > : " / \ | ? * - Windows/general filesystem restrictions
    // % - Must be encoded to avoid issues with decodeURIComponent
    // \x00-\x1f - Control characters (0-31)
    // \x7f - DEL character (127)
    return str.replace(/[<>:"|\\?*%\x00-\x1f\x7f/]/g, encode_char)
  }

  // Resolve case collisions by encoding characters until unique
  function resolve_case_collision(encoded_part, existing_iparts) {
    var encoded_lower = encoded_part.toLowerCase()

    // Keep encoding letters until we find a unique lowercase version
    while (existing_iparts.has(encoded_lower)) {
      // Find the last character that isn't part of a %XX encoding
      var found_char = false
      for (var j = encoded_part.length - 1; j >= 0; j--) {
        // Skip if this is the second hex digit of a %XX encoding
        // When we iterate backwards and hit the last hex digit, j-2 will point to %
        if (j >= 2 && encoded_part[j - 2] === '%') {
          j -= 2 // Skip the entire %XX sequence
          continue
        }

        // Note: The checks for j-1 === '%' and char === '%' are unreachable
        // because when iterating backwards through valid %XX encodings:
        // - We always hit the last hex digit first (caught by j-2 check above)
        // - The j -= 2 jumps us past the first hex digit and the % itself

        // Found a character we can encode
        var char = encoded_part[j]
        encoded_part = encoded_part.slice(0, j) + encode_char(char) + encoded_part.slice(j + 1)
        encoded_lower = encoded_part.toLowerCase()
        found_char = true
        break
      }

      if (!found_char) throw new Error('Should never happen - safety check')
    }

    return encoded_part
  }

  function encode_filename(filename) {
    // First, encode all unsafe characters
    var encoded = encode_unsafe(filename)

    // Windows reserved filenames (case-insensitive)
    // Check the original filename, not the encoded one
    var windows_reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
    var match = filename.match(windows_reserved)

    if (match) {
      // If the filename matches a Windows reserved name, encode the last letter of the reserved word
      var reserved_word = match[1] // The actual reserved word (con, prn, etc.)
      var last_char = reserved_word[reserved_word.length - 1]
      var encoded_reserved = reserved_word.slice(0, -1) + encode_char(last_char)

      // Reconstruct: encoded reserved word + encoded extension
      var encoded_extension = encoded.slice(reserved_word.length)
      encoded = encoded_reserved + encoded_extension
    }

    // Handle trailing dots and spaces (problematic on Windows)
    if (encoded.endsWith('.') || encoded.endsWith(' ')) {
      var last_char = encoded[encoded.length - 1]
      encoded = encoded.slice(0, -1) + encode_char(last_char)
    }

    return encoded
  }

  module.exports = { url_file_db }
})()
