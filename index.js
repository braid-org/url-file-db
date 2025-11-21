
void (() => {

  // =============================================================================
  // url-file-db
  // =============================================================================
  //
  // Maps web URLs to filesystem paths with proper encoding and normalization.
  // Supports treating paths as both files and directories through an index file
  // convention.
  //
  // =============================================================================

  // -----------------------------------------------------------------------------
  // Imports
  // -----------------------------------------------------------------------------

  var {
    decode_path,
    get_canonical_path,
    decode_component,
    encode_to_avoid_icase_collision,
    encode_file_path_component
  } = require('./canonical_path')

  // -----------------------------------------------------------------------------
  // Main API
  // -----------------------------------------------------------------------------

  url_file_db = {
    create: async (base_dir, meta_dir, cb, filter_cb) => {
      var db = {}

      base_dir = require('path').resolve(base_dir)
      meta_dir = require('path').resolve(meta_dir)

      // Bind filesystem operations
      var fs = require('fs').promises
      db._readFile = fs.readFile.bind(fs)
      db._writeFile = fs.writeFile.bind(fs)
      db._mkdir = fs.mkdir.bind(fs)
      db._unlink = fs.unlink.bind(fs)

      await db._mkdir(base_dir, { recursive: true })

      var is_case_sensitive = await detect_case_sensitivity(base_dir)

      // -----------------------------------------------------------------------------
      // Meta Storage (inline implementation using within_fiber)
      // -----------------------------------------------------------------------------

      var meta_storage = await (async () => {
        // In-memory cache for all metadata
        var meta_cache = new Map()

        // Track case-insensitive components to avoid collisions
        var path_to_encoded = new Map()  // canonical_path -> encoded filename
        var icomponent_to_paths = new Map()  // lowercase component -> Set of canonical paths

        // Ensure meta directory exists
        await fs.mkdir(meta_dir, { recursive: true })

        // Convert canonical path to safe filename for meta storage
        function path_to_meta_filename(canonical_path) {
          if (path_to_encoded.has(canonical_path)) {
            return path_to_encoded.get(canonical_path)
          }

          // Swap "/" and "!" to avoid ugly %2F encoding while keeping paths readable
          var swapped = canonical_path.replace(/[\/!]/g, x => x === '/' ? '!' : '/')
          var encoded = encode_file_path_component(swapped)

          if (!is_case_sensitive) {
            encoded = encode_to_avoid_icase_collision(encoded, icomponent_to_paths)
          }

          return encoded
        }

        // Save meta data for a specific path (internal - uses within_fiber)
        async function save_meta_internal(canonical_path, meta_data) {
          return within_fiber(`meta:${canonical_path}`, async () => {
            var filename = path_to_meta_filename(canonical_path)
            var filepath = meta_dir + '/' + filename

            meta_data.canonical_path = canonical_path
            meta_cache.set(canonical_path, meta_data)
            path_to_encoded.set(canonical_path, filename)

            if (!is_case_sensitive) {
              var icomponent = filename.toLowerCase()
              if (!icomponent_to_paths.has(icomponent)) {
                icomponent_to_paths.set(icomponent, new Set())
              }
              icomponent_to_paths.get(icomponent).add(canonical_path)
            }

            await fs.writeFile(filepath, JSON.stringify(meta_data, null, 2))
          })
        }

        // Delete meta data for a specific path (internal - uses within_fiber)
        async function delete_meta_internal(canonical_path) {
          return within_fiber(`meta:${canonical_path}`, async () => {
            var filename = path_to_meta_filename(canonical_path)
            var filepath = meta_dir + '/' + filename

            meta_cache.delete(canonical_path)
            path_to_encoded.delete(canonical_path)

            if (!is_case_sensitive) {
              var icomponent = filename.toLowerCase()
              var paths = icomponent_to_paths.get(icomponent)
              if (paths) {
                paths.delete(canonical_path)
                if (paths.size === 0) {
                  icomponent_to_paths.delete(icomponent)
                }
              }
            }

            try {
              await fs.unlink(filepath)
            } catch (e) {
              if (e.code !== 'ENOENT') throw e
            }
          })
        }

        // Load existing metadata from disk
        async function load_all_meta() {
          try {
            var files = await fs.readdir(meta_dir)
            for (var file of files) {
              try {
                var content = await fs.readFile(meta_dir + '/' + file, 'utf8')
                var data = JSON.parse(content)
                if (data.canonical_path) {
                  meta_cache.set(data.canonical_path, data)
                  path_to_encoded.set(data.canonical_path, file)

                  if (!is_case_sensitive) {
                    var icomponent = file.toLowerCase()
                    if (!icomponent_to_paths.has(icomponent)) {
                      icomponent_to_paths.set(icomponent, new Set())
                    }
                    icomponent_to_paths.get(icomponent).add(data.canonical_path)
                  }
                }
              } catch (e) {
                console.error(`Failed to load meta file ${file}:`, e.message)
              }
            }
          } catch (e) {
            if (e.code !== 'ENOENT') {
              console.error('Failed to load metadata:', e.message)
            }
          }
        }

        // Load all metadata on initialization
        await load_all_meta()

        // Return the meta storage API
        return {
          get(canonical_path) {
            return meta_cache.get(canonical_path)
          },

          async set(canonical_path, meta_data) {
            await save_meta_internal(canonical_path, meta_data)
          },

          async update(canonical_path, updates) {
            var existing = meta_cache.get(canonical_path) || {}
            var updated = { ...existing, ...updates }
            await save_meta_internal(canonical_path, updated)
          },

          async delete(canonical_path) {
            await delete_meta_internal(canonical_path)
          },

          has_been_seen(canonical_path) {
            return meta_cache.has(canonical_path)
          },

          async mark_as_seen(canonical_path, mtime_ns) {
            await this.update(canonical_path, {
              last_seen: Date.now(),
              mtime_ns: '' + mtime_ns
            })
          },

          get_all_paths() {
            return Array.from(meta_cache.keys())
          }
        }
      })()

      // Track canonical_paths with anticipated events from db.write operations
      // These events should not trigger the user callback
      var anticipated_events = new Set()

      // Initialize root node
      var root = create_node('/')
      root.directory_promise = Promise.resolve()

      // -------------------------------------------------------------------------
      // File Watcher
      // -------------------------------------------------------------------------

      async function chokidar_handler(fullpath, event) {
        if (!fullpath.startsWith(base_dir + '/')) {
          return
        }

        // Optional filter callback to decide whether to handle this event
        if (filter_cb && !filter_cb(fullpath, event)) {
          return
        }

        var file_path = fullpath.slice(base_dir.length)
        var file_path_components = file_path.slice(1).split('/')

        // Handle add/addDir events - build the node tree
        if (event.startsWith('add')) {
          var node = root
          for (var i = 0; i < file_path_components.length; i++) {
            var file_path_component = file_path_components[i]
            var component = decode_component(file_path_component)

            // Create node if it doesn't exist
            if (!node.component_to_node.has(component)) {
              node.component_to_node.set(component, create_node(file_path_component))
            }

            // Track case-insensitive mappings
            if (!is_case_sensitive) {
              var ifile_path_component = file_path_component.toLowerCase()
              var icomponent = component.toLowerCase()

              if (!node.icomponent_to_ifile_path_components.has(icomponent)) {
                node.icomponent_to_ifile_path_components.set(icomponent, new Set())
              }
              node.icomponent_to_ifile_path_components.get(icomponent).add(ifile_path_component)
            }

            node = node.component_to_node.get(component)
            if (node.file_path_component !== file_path_component)
              throw new Error('Corruption detected - should never happen')

            // Mark directories
            if (i === file_path_components.length - 1 && event === 'addDir') {
              node.directory_promise = Promise.resolve()
            }
          }
        }

        // Handle unlink/unlinkDir events - remove from node tree
        if (event.startsWith('unlink')) {
          var node = root
          for (var i = 0; i < file_path_components.length; i++) {
            var file_path_component = file_path_components[i]
            var component = decode_component(file_path_component)
            if (i === file_path_components.length - 1) {
              // Remove from component map
              node.component_to_node.delete(component)

              // Clean up case-insensitive tracking
              if (!is_case_sensitive) {
                var ifile_path_component = file_path_component.toLowerCase()
                var icomponent = component.toLowerCase()
                var icomponent_set = node.icomponent_to_ifile_path_components.get(icomponent)
                if (icomponent_set) {
                  icomponent_set.delete(ifile_path_component)
                  if (!icomponent_set.size) {
                    node.icomponent_to_ifile_path_components.delete(icomponent)
                  }
                }
              }
            } else {
              node = node.component_to_node.get(component)
              if (!node) break
            }
          }
        }

        // Handle file deletions - clean up metadata
        if (event === 'unlink') {
          var canonical_path = get_canonical_path(file_path)
          await meta_storage.delete(canonical_path)
        }

        // Notify callback for file changes
        if (event === 'add' || event === 'change') {
          var canonical_path = get_canonical_path(file_path)

          // Don't call callback if this event was anticipated from db.write
          if (!anticipated_events.has(canonical_path)) {
            // Serialize event handling per path to avoid duplicate callbacks
            within_fiber(`chokidar:${fullpath}`, async () => {
              try {
                var stats = await require('fs').promises.stat(fullpath, { bigint: true })
                var meta = meta_storage.get(canonical_path)

                // Trigger callback if:
                // 1. Never seen before (no metadata)
                // 2. File is newer than our last recorded mtime
                // Compare as BigInt for accurate nanosecond comparison
                var meta_mtime_ns = meta && meta.mtime_ns ? BigInt(meta.mtime_ns) : null
                var should_trigger = !meta ||
                                     !meta_mtime_ns ||
                                     stats.mtimeNs > meta_mtime_ns

                if (should_trigger) {
                  if (cb) cb(canonical_path)
                  // Update the metadata with new mtime
                  await meta_storage.mark_as_seen(canonical_path, stats.mtimeNs)
                }
              } catch (e) {
                // File was deleted, clean up metadata
                await meta_storage.delete(canonical_path)
              }
            })
          }
        }
      }

      var c = require('chokidar').watch(base_dir, {
          useFsEvents: true,
          usePolling: false,
          // Ignore the meta directory to avoid infinite loops
          ignored: meta_dir
      })
      for (let e of ['add', 'addDir', 'change', 'unlink', 'unlinkDir'])
        c.on(e, x => chokidar_handler(x, e))

      // -------------------------------------------------------------------------
      // db.read
      // -------------------------------------------------------------------------

      db.read = async path => {
        var components = decode_path(path)
        var node = root
        var fullpath = base_dir

        // Navigate to the target node
        for (var component of components) {
          node = node.component_to_node.get(component)
          if (!node) return null
          if (node.directory_promise) await node.directory_promise
          fullpath += '/' + node.file_path_component
        }

        // Directories store content in index file
        if (node.directory_promise) fullpath += '/index'

        // Serialize on the node's promise chain
        return await (node.promise_chain = node.promise_chain.then(async () => {
          try {
            return await db._readFile(fullpath)
          } catch (e) {
            return null
          }
        }))
      }

      // -------------------------------------------------------------------------
      // db.delete
      // -------------------------------------------------------------------------

      db.delete = async path => {
        var components = decode_path(path)

        var node = root
        var fullpath = base_dir
        var parent_node = null
        var last_component = null

        // Navigate to the target node
        for (var i = 0; i < components.length; i++) {
          var component = components[i]
          parent_node = node
          last_component = component
          node = node.component_to_node.get(component)

          if (!node) return false

          if (node.directory_promise) await node.directory_promise
          fullpath += '/' + node.file_path_component
        }

        // Directories store content in index file
        if (node.directory_promise) {
          fullpath += '/index'
        }

        // Serialize on the node's promise chain
        return await (node.promise_chain = node.promise_chain.then(async () => {
          try {
            // Temporarily remove read-only protection if needed for deletion
            if (await is_read_only(fullpath)) {
              await set_read_only(fullpath, false)
            }

            // Remove node from parent's tree (only for files, not directories)
            if (!node.directory_promise && parent_node && last_component) {
              parent_node.component_to_node.delete(last_component)

              // Clean up case-insensitive tracking
              if (!is_case_sensitive) {
                var icomponent = last_component.toLowerCase()
                var ifile_path_component = node.file_path_component.toLowerCase()
                var icomponent_set = parent_node.icomponent_to_ifile_path_components.get(icomponent)
                if (icomponent_set) {
                  icomponent_set.delete(ifile_path_component)
                  if (!icomponent_set.size) {
                    parent_node.icomponent_to_ifile_path_components.delete(icomponent)
                  }
                }
              }
            }

            await db._unlink(fullpath)

            // Delete metadata when file is deleted
            var canonical_path = get_canonical_path(path)
            await meta_storage.delete(canonical_path)

            return true
          } catch (e) {
            return false
          }
        }))
      }

      // -------------------------------------------------------------------------
      // db.write
      // -------------------------------------------------------------------------

      db.write = async (path, content) => {
        var components = decode_path(path)
        var canonical_path = get_canonical_path(path)  // Only needed for anticipated_events
        var node = root
        var fullpath = base_dir

        // Build path and create missing directories/nodes
        for (var i = 0; i < components.length; i++) {
          var component = components[i]

          // Create new node if needed
          if (!node.component_to_node.has(component)) {
            var file_path_component = encode_file_path_component(component)

            // Handle case collisions on case-insensitive filesystems
            if (!is_case_sensitive) {
              var icomponent = component.toLowerCase()
              var ifile_path_components

              if (node.icomponent_to_ifile_path_components.has(icomponent)) {
                ifile_path_components = node.icomponent_to_ifile_path_components.get(icomponent)
              } else {
                ifile_path_components = new Set()
                node.icomponent_to_ifile_path_components.set(icomponent, ifile_path_components)
              }

              file_path_component = encode_to_avoid_icase_collision(file_path_component, ifile_path_components)
              ifile_path_components.add(file_path_component.toLowerCase())
            }

            var new_node = create_node(file_path_component)
            node.component_to_node.set(component, new_node)
            fullpath += '/' + file_path_component

            // Create directory on filesystem (for non-leaf nodes)
            if (i < components.length - 1) {
              new_node.directory_promise = db._mkdir(fullpath, { recursive: true })
              await new_node.directory_promise
            }

            node = new_node
          } else {
            node = node.component_to_node.get(component)

            // Convert file to directory if needed
            if (i < components.length - 1 && !node.directory_promise) {
              var dir_fullpath = fullpath + '/' + node.file_path_component
              var convert_promise = (async () => {
                await node.promise_chain

                // Read existing content, delete file, create directory, write to index
                var old_content = await db._readFile(dir_fullpath)
                await db._unlink(dir_fullpath)
                await db._mkdir(dir_fullpath, { recursive: true })
                await db._writeFile(dir_fullpath + '/index', old_content)
              })()

              node.directory_promise = convert_promise
              await node.directory_promise
            }

            if (node.directory_promise) await node.directory_promise
            fullpath += '/' + node.file_path_component
          }
        }

        // Directories store content in index file
        if (node.directory_promise) fullpath += '/index'

        // Serialize on the node's promise chain
        return await (node.promise_chain = node.promise_chain.then(async () => {
          // Temporarily remove read-only protection if needed for writing
          var was_read_only = await is_read_only(fullpath)
          if (was_read_only) {
            await set_read_only(fullpath, false)
          }

          // Mark as anticipated to suppress callback
          anticipated_events.add(canonical_path)

          await db._writeFile(fullpath, content)

          // Record metadata with ns modified time
          try {
            var stats = await require('fs').promises.stat(fullpath, { bigint: true })
            await meta_storage.mark_as_seen(canonical_path, stats.mtimeNs)
          } catch (e) {
            // If file doesn't exist after write, delete metadata
            await meta_storage.delete(canonical_path)
          }

          // Restore read-only status if it was set before
          if (was_read_only) {
            await set_read_only(fullpath, true)
          }

          // Remove from anticipated events after chokidar detection window
          setTimeout(() => {
            anticipated_events.delete(canonical_path)
          }, 1000)
        }))
      }

      // -------------------------------------------------------------------------
      // db.is_read_only
      // -------------------------------------------------------------------------

      db.is_read_only = async path => {
        var components = decode_path(path)
        var node = root
        var fullpath = base_dir

        // Navigate to the target node
        for (var component of components) {
          node = node.component_to_node.get(component)
          if (!node) return false
          if (node.directory_promise) await node.directory_promise
          fullpath += '/' + node.file_path_component
        }

        // Directories check the index file
        if (node.directory_promise) fullpath += '/index'

        return await is_read_only(fullpath)
      }

      // -------------------------------------------------------------------------
      // db.set_read_only
      // -------------------------------------------------------------------------

      db.set_read_only = async (path, read_only) => {
        var components = decode_path(path)
        var node = root
        var fullpath = base_dir

        // Navigate to the target node
        for (var component of components) {
          node = node.component_to_node.get(component)
          if (!node) return false
          if (node.directory_promise) await node.directory_promise
          fullpath += '/' + node.file_path_component
        }

        // Directories set the index file
        if (node.directory_promise) fullpath += '/index'

        try {
          await set_read_only(fullpath, read_only)
          return true
        } catch (e) {
          return false
        }
      }

      // -------------------------------------------------------------------------
      // Meta storage API
      // -------------------------------------------------------------------------

      // Get metadata for a path
      db.get_meta = (path) => {
        var canonical_path = get_canonical_path(path)
        return meta_storage.get(canonical_path)
      }

      // Set complete metadata for a path
      db.set_meta = async (path, meta_data) => {
        var canonical_path = get_canonical_path(path)
        await meta_storage.set(canonical_path, meta_data)
      }

      // Update specific fields in metadata (merges with existing)
      db.update_meta = async (path, updates) => {
        var canonical_path = get_canonical_path(path)
        await meta_storage.update(canonical_path, updates)
      }

      // Delete metadata for a path
      db.delete_meta = async (path) => {
        var canonical_path = get_canonical_path(path)
        await meta_storage.delete(canonical_path)
      }

      // Check if database has this file (has seen it before)
      db.has = (path) => {
        var canonical_path = get_canonical_path(path)
        return meta_storage.has_been_seen(canonical_path)
      }

      // List all known paths (from metadata)
      db.list = () => {
        return meta_storage.get_all_paths()
      }

      // Alias for list() to be more explicit
      db.get_all_meta_paths = db.list

      return db
    },

    // Exported utilities
    get_canonical_path,
    decode_path,
    encode_file_path_component,
    encode_to_avoid_icase_collision,
    detect_case_sensitivity
  }

  // -----------------------------------------------------------------------------
  // Utility Functions
  // -----------------------------------------------------------------------------

  async function exists(fullpath) {
    try {
      return await require('fs').promises.stat(fullpath)
    } catch (e) {
      // File doesn't exist
    }
  }

  async function detect_case_sensitivity(dir) {
    var test_path = `${dir}/.case-test-${Math.random().toString(36).slice(2)}`
    await require('fs').promises.writeFile(test_path, '')
    var is_case_sensitive = !await exists(test_path.toUpperCase())
    await require('fs').promises.unlink(test_path)
    return is_case_sensitive
  }

  async function is_read_only(fullpath) {
    try {
      const stat = await require('fs').promises.stat(fullpath)
      return require('os').platform() === "win32" ?
        !!(stat.mode & 0x1) :
        !(stat.mode & 0o200)
    } catch (e) {
      return false
    }
  }

  async function set_read_only(fullpath, read_only) {
    if (require('os').platform() === "win32") {
      await new Promise((resolve, reject) => {
        require("child_process").exec(`fsutil file setattr readonly "${fullpath}" ${!!read_only}`, (error) => error ? reject(error) : resolve())
      })
    } else {
      let mode = (await require('fs').promises.stat(fullpath)).mode

      // Check if chmod is actually needed
      if (read_only && (mode & 0o222) === 0) return
      if (!read_only && (mode & 0o200) !== 0) return

      // Perform chmod only if necessary
      if (read_only) mode &= ~0o222  // Remove all write permissions
      else mode |= 0o200   // Add owner write permission

      await require('fs').promises.chmod(fullpath, mode)
    }
  }

  function create_node(file_path_component) {
    return {
      file_path_component,
      component_to_node: new Map(),
      icomponent_to_ifile_path_components: new Map(),
      promise_chain: Promise.resolve(),
      directory_promise: null
    }
  }

  // Serialize async operations by ID to prevent race conditions
  function within_fiber(id, func) {
    if (!within_fiber.chains) within_fiber.chains = {}
    var prev = within_fiber.chains[id] || Promise.resolve()
    var curr = prev.then(async () => {
      try {
        return await func()
      } finally {
        if (within_fiber.chains[id] === curr)
          delete within_fiber.chains[id]
      }
    }).catch(e => console.error(`Error in fiber ${id}:`, e))
    return within_fiber.chains[id] = curr
  }

  // -----------------------------------------------------------------------------
  // Exports
  // -----------------------------------------------------------------------------

  module.exports = { url_file_db }
})()
