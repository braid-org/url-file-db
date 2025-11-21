
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
    create: async (base_dir, cb) => {
      var db = {}

      base_dir = require('path').resolve(base_dir)

      // Bind filesystem operations
      var fs = require('fs').promises
      db._readFile = fs.readFile.bind(fs)
      db._writeFile = fs.writeFile.bind(fs)
      db._mkdir = fs.mkdir.bind(fs)
      db._unlink = fs.unlink.bind(fs)

      await db._mkdir(base_dir, { recursive: true })

      var is_case_sensitive = await detect_case_sensitivity(base_dir)

      // Track canonical_paths with anticipated events from db.write operations
      // These events should not trigger the user callback
      var anticipated_events = new Set()

      // Initialize root node
      var root = create_node('/')
      root.directory_promise = Promise.resolve()

      // -------------------------------------------------------------------------
      // File Watcher
      // -------------------------------------------------------------------------

      function chokidar_handler(fullpath, event) {
        if (!fullpath.startsWith(base_dir + '/')) {
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

        // Notify callback for file changes
        if (event === 'add' || event === 'change') {
          var canonical_path = get_canonical_path(file_path)

          // Don't call callback if this event was anticipated from db.write
          if (!anticipated_events.has(canonical_path)) {
            if (cb) cb(canonical_path)
          }
        }
      }

      var c = require('chokidar').watch(base_dir, {
          useFsEvents: true,
          usePolling: false,
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

  // -----------------------------------------------------------------------------
  // Exports
  // -----------------------------------------------------------------------------

  module.exports = { url_file_db }
})()
