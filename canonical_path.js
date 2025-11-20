// =============================================================================
// Path Utilities
// =============================================================================
//
// A "path" is conceptually an array of strings representing hierarchical components.
//
// String Representation:
// - Components are separated by "/" characters
// - May optionally begin with "/" (which is ignored)
// - Each component is decoded via decodeURIComponent() and normalize()
// - The special component "index" and anything after it is removed
// - Path normalization handles "." (current) and ".." (parent) components
//
// Canonical Path:
// - A canonical path is a specific string encoding of a path array
// - Always begins with "/"
// - Components are joined with "/"
// - Only "%" and "/" within components are encoded (as %25 and %2F)
// - This minimal encoding keeps paths readable while allowing any characters
//
// Examples:
//   "/hello/world"         → ["hello", "world"]
//   "hello/world"          → ["hello", "world"]
//   "/hello%20world"       → ["hello world"]
//   "/api/users"           → ["api", "users"]
//   "/docs/index/foo"      → ["docs"]
//   "/a/./b/../c"          → ["a", "c"]
//
// =============================================================================

// -----------------------------------------------------------------------------
// Component Decoding
// -----------------------------------------------------------------------------

function decode_component(component) {
  return decodeURIComponent(component).normalize()
}

// -----------------------------------------------------------------------------
// Path Decoder
// -----------------------------------------------------------------------------

function decode_path(path) {
  // Handle optional leading slash
  if (path.startsWith('/')) {
    path = path.slice(1)
  }

  // Handle empty path or root path
  if (path === '') {
    return []
  }

  // Split by "/" and process each component
  var components = path.split('/').map(decode_component)

  // Handle /index normalization - strip /index and everything after it
  var index_pos = components.indexOf('index')
  if (index_pos !== -1) {
    components = components.slice(0, index_pos)
  }

  // Handle path normalization (. and ..)
  var normalized = []
  for (var component of components) {
    if (component === '.' || component === '') {
      continue
    }
    if (component === '..') {
      normalized.pop()
    } else {
      normalized.push(component)
    }
  }

  return normalized
}

// -----------------------------------------------------------------------------
// Canonical Path Encoding
// -----------------------------------------------------------------------------

function get_canonical_path(path) {
  var components = decode_path(path)
  return '/' + components.map(encode_canonical_path_component).join('/')
}

function encode_canonical_path_component(component) {
  // Only encode % and / to keep canonical paths readable
  component = component.replace(/%/g, '%25')
  component = component.replace(/\//g, '%2F')
  return component
}

// -----------------------------------------------------------------------------
// File System Path Encoding
// -----------------------------------------------------------------------------

function encode_file_path_component(component) {
  // Encode characters that are unsafe on various filesystems:
  //   < > : " / \ | ? *  - Windows restrictions
  //   %                  - Reserved for encoding
  //   \x00-\x1f, \x7f    - Control characters
  var encoded = component.replace(/[<>:"|\\?*%\x00-\x1f\x7f/]/g, encode_char)

  // Encode Windows reserved filenames (con, prn, aux, nul, com1-9, lpt1-9)
  var windows_reserved = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
  var match = component.match(windows_reserved)
  if (match) {
    var reserved_word = match[1]
    var last_char = reserved_word[reserved_word.length - 1]
    var encoded_reserved = reserved_word.slice(0, -1) + encode_char(last_char)
    var encoded_extension = encoded.slice(reserved_word.length)
    encoded = encoded_reserved + encoded_extension
  }

  // Encode trailing dots and spaces (stripped by Windows)
  if (encoded.endsWith('.') || encoded.endsWith(' ')) {
    var last_char = encoded[encoded.length - 1]
    encoded = encoded.slice(0, -1) + encode_char(last_char)
  }

  return encoded
}

// -----------------------------------------------------------------------------
// Case Collision Resolution
// -----------------------------------------------------------------------------

function encode_to_avoid_icase_collision(component, existing_icomponents) {
  var icomponent = component.toLowerCase()

  while (existing_icomponents.has(icomponent)) {
    var found_letter = false

    // Find the last letter (a-zA-Z) that isn't part of a %XX encoding
    for (var i = component.length - 1; i >= 0; i--) {
      if (i >= 2 && component[i - 2] === '%') {
        i -= 2
        continue
      }

      var char = component[i]

      // Only encode letters - encoding non-letters doesn't help resolve case collisions
      if (!/[a-zA-Z]/.test(char)) {
        continue
      }

      component = component.slice(0, i) + encode_char(char) + component.slice(i + 1)
      icomponent = component.toLowerCase()
      found_letter = true
      break
    }

    if (!found_letter) {
      throw new Error('Should never happen - safety check')
    }
  }

  return component
}

// -----------------------------------------------------------------------------
// Utilities
// -----------------------------------------------------------------------------

function encode_char(char) {
  return '%' + char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')
}

// -----------------------------------------------------------------------------
// Exports
// -----------------------------------------------------------------------------

module.exports = {
  // Core API
  decode_path,
  get_canonical_path,

  // Component handling
  decode_component,
  encode_file_path_component,

  // Utilities
  encode_canonical_path_component,
  encode_to_avoid_icase_collision,
  encode_char
}