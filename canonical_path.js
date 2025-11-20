
// =============================================================================
// Canonical Path Utilities
// =============================================================================
//
// This module handles conversions between three path representations:
//
//   url_path       - URL path from HTTP requests (e.g., /a/hello%20world)
//   file_path      - Filesystem path on disk (e.g., /a/hello%20world)
//   canonical_path - Normalized internal representation (e.g., /a/hello world)
//
// Canonical paths use minimal encoding (only % and /) to allow components
// to contain any characters while remaining splittable on /.
//
// =============================================================================

// -----------------------------------------------------------------------------
// Canonical Path
// -----------------------------------------------------------------------------

function decode_canonical_path(canonical_path) {
  if (!canonical_path.startsWith('/')) {
    throw new Error('canonical path must begin with /')
  }
  var components = canonical_path.split('/').slice(1).map(decode_canonical_path_component)
  if (components.length === 1 && components[0] === '') return []
  return components
}

function encode_canonical_path(components) {
  return '/' + components.map(encode_canonical_path_component).join('/')
}

function encode_canonical_path_component(component) {
  component = component.replace(/%/g, '%25')
  component = component.replace(/\//g, '%2F')
  return component
}

function decode_canonical_path_component(component) {
  component = component.replace(/%2F/g, '/')
  component = component.replace(/%25/g, '%')
  return component
}

// -----------------------------------------------------------------------------
// File Path
// -----------------------------------------------------------------------------

function file_path_to_canonical_path(path) {
  if (!path.startsWith('/')) {
    throw new Error('file path must begin with /')
  }

  path = require('path').normalize(path)

  var file_path_components = path.split('/').slice(1)
  var components = file_path_components.map(decode_file_path_component)

  // Strip /index and everything after it
  var index_pos = components.indexOf('index')
  if (index_pos !== -1) {
    components = components.slice(0, index_pos)
  }

  return encode_canonical_path(components)
}

function decode_file_path_component(file_path_component) {
  return decodeURIComponent(file_path_component)
}

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
// URL Path
// -----------------------------------------------------------------------------

function url_path_to_canonical_path(url_path) {
  if (!url_path.startsWith('/')) {
    throw new Error('url path must begin with /')
  }

  // Remove query string and fragment
  var path = url_path.split(/[\?\#]/)[0]

  // Split into components and normalize each
  var components = path.split('/').map(component => {
    component = decodeURIComponent(component)
    component = component.normalize()
    component = encode_canonical_path_component(component)
    return component
  })

  // Strip /index and everything after it
  var index_pos = components.indexOf('index')
  if (index_pos !== -1) {
    components = components.slice(0, index_pos)
    if (components.length === 1) components.push('')
  }

  // Join and normalize dots
  var canonical_path = components.join('/')
  canonical_path = require('path').normalize(canonical_path)

  return canonical_path
}

// -----------------------------------------------------------------------------
// Case Collision Resolution
// -----------------------------------------------------------------------------

function ensure_unique_case_insensitive_path_component(component, existing_icomponents) {
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
  // Canonical path
  decode_canonical_path,
  encode_canonical_path,
  decode_canonical_path_component,
  encode_canonical_path_component,

  // File path
  file_path_to_canonical_path,
  decode_file_path_component,
  encode_file_path_component,

  // URL path
  url_path_to_canonical_path,

  // Utilities
  ensure_unique_case_insensitive_path_component,
  encode_char
}
