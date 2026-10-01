/**
 * MyDM Filename Intelligence & Security Utilities
 * Handles robust filename extraction, sanitization, and path-traversal prevention.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.MyDMFilenameUtil = exportsObj;
    root.FilenameUtil = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const WINDOWS_RESERVED_NAMES = new Set([
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
  ]);

  function sanitizeFilename(name, fallback = 'download') {
    if (!name || typeof name !== 'string') {
      return fallback;
    }

    // Strip path traversal attempts and directory separators
    let safe = name.replace(/^[a-zA-Z]:[/\\]/, ''); // Strip Windows drive letter (e.g. C:)
    safe = safe.replace(/[/\\?%*:|"<>]/g, '_');    // Replace invalid filesystem chars with '_'
    safe = safe.replace(/[\x00-\x1f\x7f]/g, '');   // Remove control characters
    safe = safe.replace(/\.{2,}/g, '.');          // Prevent directory traversal (..)
    safe = safe.trim().replace(/^\.+/, '').replace(/\.+$/, ''); // Remove leading/trailing dots/spaces

    if (!safe) {
      return fallback;
    }

    // Check Windows reserved device names (e.g. CON, AUX, NUL)
    const baseName = safe.split('.')[0].toUpperCase();
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      safe = `_${safe}`;
    }

    // Enforce reasonable filename length (max 200 chars), preserving extension
    if (safe.length > 200) {
      const lastDot = safe.lastIndexOf('.');
      if (lastDot > 0 && lastDot > safe.length - 15) {
        const ext = safe.substring(lastDot);
        const base = safe.substring(0, 200 - ext.length);
        safe = base + ext;
      } else {
        safe = safe.substring(0, 200);
      }
    }

    return safe || fallback;
  }

  function extractFilenameFromUrl(rawUrl, fallback = 'download') {
    if (!rawUrl || typeof rawUrl !== 'string') return fallback;

    try {
      const parsed = new URL(rawUrl);
      const pathname = parsed.pathname;
      const segments = pathname.split('/').filter(Boolean);
      if (segments.length === 0) return fallback;

      let filename = segments[segments.length - 1];
      try {
        filename = decodeURIComponent(filename);
      } catch (_) {
        // Fallback to raw string if decoding fails
      }
      return sanitizeFilename(filename, fallback);
    } catch (_) {
      // Fallback for relative or malformed URLs
      const clean = rawUrl.split('?')[0].split('#')[0];
      const parts = clean.split(/[/\\]/).filter(Boolean);
      return sanitizeFilename(parts.pop(), fallback);
    }
  }

  function extractFilenameFromContentDisposition(header) {
    if (!header || typeof header !== 'string') return null;

    // RFC 5987 / 6266 filename*=UTF-8''...
    const starMatch = header.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\s]+)/i);
    if (starMatch && starMatch[1]) {
      try {
        return sanitizeFilename(decodeURIComponent(starMatch[1].replace(/['"]/g, '')));
      } catch (_) {
        return sanitizeFilename(starMatch[1].replace(/['"]/g, ''));
      }
    }

    // Standard quoted or unquoted filename="..."
    const standardMatch = header.match(/filename\s*=\s*("([^"]+)"|'([^']+)'|([^;\s]+))/i);
    if (standardMatch) {
      const candidate = standardMatch[2] || standardMatch[3] || standardMatch[4];
      if (candidate) {
        return sanitizeFilename(candidate.trim());
      }
    }

    return null;
  }

  function resolveFilename(candidateName, url, contentDisposition) {
    if (contentDisposition) {
      const cdName = extractFilenameFromContentDisposition(contentDisposition);
      if (cdName && cdName !== 'download') return cdName;
    }
    if (candidateName && typeof candidateName === 'string' && candidateName.trim()) {
      return sanitizeFilename(candidateName.trim());
    }
    return extractFilenameFromUrl(url);
  }

  function getFileExtension(filename) {
    if (!filename || typeof filename !== 'string') return '';
    const clean = filename.split(/[?#]/)[0];
    const lastDot = clean.lastIndexOf('.');
    if (lastDot <= 0 || lastDot === clean.length - 1) return '';
    return clean.substring(lastDot + 1).toLowerCase();
  }

  return {
    sanitizeFilename,
    extractFilenameFromUrl,
    extractFilenameFromContentDisposition,
    resolveFilename,
    getFileExtension
  };
});
