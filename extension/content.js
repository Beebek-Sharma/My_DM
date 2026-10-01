/**
 * MyDM Content Script - Smart Resource & Media Detector
 * Inspects DOM and media elements on active pages to discover downloadable assets.
 */

(function () {
  'use strict';

  const DOWNLOADABLE_EXTENSIONS = new Set([
    // Videos & Audio
    'mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'wmv', 'mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac',
    // Streaming Manifests
    'm3u8', 'mpd',
    // Documents
    'pdf', 'epub', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'csv',
    // Archives & ISOs
    'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso', 'dmg',
    // Executables
    'exe', 'msi', 'pkg', 'deb', 'rpm', 'apk'
  ]);

  function scanPageResources() {
    const discovered = new Map();

    function addResource(rawUrl, meta) {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      if (rawUrl.startsWith('blob:') || rawUrl.startsWith('data:') || rawUrl.startsWith('javascript:')) return;

      try {
        const absUrl = new URL(rawUrl, window.location.href).href;
        if (!absUrl.startsWith('http://') && !absUrl.startsWith('https://')) return;

        if (!discovered.has(absUrl)) {
          const cleanPath = absUrl.split('?')[0].split('#')[0];
          const filename = cleanPath.split('/').pop() || 'resource';
          const ext = filename.split('.').pop().toLowerCase();

          discovered.set(absUrl, {
            url: absUrl,
            filename: decodeURIComponent(filename),
            extension: ext,
            type: meta.type || 'file',
            title: meta.title || filename,
            isStream: ext === 'm3u8' || ext === 'mpd'
          });
        }
      } catch (_) {}
    }

    // 1. Scan <video> and <audio> elements
    document.querySelectorAll('video, audio').forEach((media) => {
      const tag = media.tagName.toLowerCase();
      if (media.src) {
        addResource(media.src, {
          type: tag,
          title: media.title || media.getAttribute('aria-label') || `${tag} source`
        });
      }
      media.querySelectorAll('source').forEach((source) => {
        if (source.src) {
          addResource(source.src, {
            type: tag,
            title: source.type || `${tag} stream source`
          });
        }
      });
    });

    // 2. Scan links <a> pointing to downloadable extensions
    document.querySelectorAll('a[href]').forEach((a) => {
      const href = a.getAttribute('href');
      if (!href) return;
      try {
        const clean = href.split('?')[0].split('#')[0];
        const ext = clean.split('.').pop().toLowerCase();
        if (DOWNLOADABLE_EXTENSIONS.has(ext)) {
          addResource(href, {
            type: ext === 'm3u8' || ext === 'mpd' ? 'stream' : 'file',
            title: a.textContent.trim() || a.getAttribute('download') || clean.split('/').pop()
          });
        }
      } catch (_) {}
    });

    return Array.from(discovered.values());
  }

  // Listen for requests from popup or background
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'DETECT_PAGE_RESOURCES') {
      const resources = scanPageResources();
      sendResponse({ resources });
    }
    return true;
  });
})();
