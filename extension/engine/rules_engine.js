/**
 * MyDM Rules & Categorization Engine
 * Maps filenames, MIME types, and URLs to categories and subfolders.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./filename_util'));
  } else {
    const exportsObj = factory(root.MyDMFilenameUtil || root.FilenameUtil);
    root.MyDMRulesEngine = exportsObj;
    root.RulesEngine = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (FilenameUtil) {
  'use strict';

  const CATEGORIES = Object.freeze({
    DOCUMENTS: 'Documents',
    IMAGES: 'Images',
    VIDEOS: 'Videos',
    AUDIO: 'Audio',
    ARCHIVES: 'Archives',
    PROGRAMS: 'Programs',
    ISOS: 'ISOs',
    OTHER: 'Other'
  });

  const EXTENSION_MAP = Object.freeze({
    // Documents
    pdf: CATEGORIES.DOCUMENTS,
    doc: CATEGORIES.DOCUMENTS,
    docx: CATEGORIES.DOCUMENTS,
    txt: CATEGORIES.DOCUMENTS,
    rtf: CATEGORIES.DOCUMENTS,
    odt: CATEGORIES.DOCUMENTS,
    xls: CATEGORIES.DOCUMENTS,
    xlsx: CATEGORIES.DOCUMENTS,
    ppt: CATEGORIES.DOCUMENTS,
    pptx: CATEGORIES.DOCUMENTS,
    csv: CATEGORIES.DOCUMENTS,
    epub: CATEGORIES.DOCUMENTS,
    md: CATEGORIES.DOCUMENTS,

    // Images
    jpg: CATEGORIES.IMAGES,
    jpeg: CATEGORIES.IMAGES,
    png: CATEGORIES.IMAGES,
    gif: CATEGORIES.IMAGES,
    webp: CATEGORIES.IMAGES,
    svg: CATEGORIES.IMAGES,
    bmp: CATEGORIES.IMAGES,
    ico: CATEGORIES.IMAGES,
    tiff: CATEGORIES.IMAGES,
    avif: CATEGORIES.IMAGES,
    psd: CATEGORIES.IMAGES,

    // Videos
    mp4: CATEGORIES.VIDEOS,
    mkv: CATEGORIES.VIDEOS,
    webm: CATEGORIES.VIDEOS,
    avi: CATEGORIES.VIDEOS,
    mov: CATEGORIES.VIDEOS,
    flv: CATEGORIES.VIDEOS,
    wmv: CATEGORIES.VIDEOS,
    m4v: CATEGORIES.VIDEOS,
    '3gp': CATEGORIES.VIDEOS,
    ts: CATEGORIES.VIDEOS,
    m3u8: CATEGORIES.VIDEOS,
    mpd: CATEGORIES.VIDEOS,

    // Audio
    mp3: CATEGORIES.AUDIO,
    wav: CATEGORIES.AUDIO,
    ogg: CATEGORIES.AUDIO,
    m4a: CATEGORIES.AUDIO,
    flac: CATEGORIES.AUDIO,
    aac: CATEGORIES.AUDIO,
    opus: CATEGORIES.AUDIO,
    wma: CATEGORIES.AUDIO,
    mid: CATEGORIES.AUDIO,

    // Archives
    zip: CATEGORIES.ARCHIVES,
    rar: CATEGORIES.ARCHIVES,
    '7z': CATEGORIES.ARCHIVES,
    tar: CATEGORIES.ARCHIVES,
    gz: CATEGORIES.ARCHIVES,
    bz2: CATEGORIES.ARCHIVES,
    xz: CATEGORIES.ARCHIVES,
    tgz: CATEGORIES.ARCHIVES,
    z: CATEGORIES.ARCHIVES,
    cab: CATEGORIES.ARCHIVES,

    // Programs
    exe: CATEGORIES.PROGRAMS,
    msi: CATEGORIES.PROGRAMS,
    dmg: CATEGORIES.PROGRAMS,
    pkg: CATEGORIES.PROGRAMS,
    deb: CATEGORIES.PROGRAMS,
    rpm: CATEGORIES.PROGRAMS,
    apk: CATEGORIES.PROGRAMS,
    appx: CATEGORIES.PROGRAMS,
    bat: CATEGORIES.PROGRAMS,
    cmd: CATEGORIES.PROGRAMS,

    // ISOs
    iso: CATEGORIES.ISOS,
    img: CATEGORIES.ISOS,
    bin: CATEGORIES.ISOS,
    vdi: CATEGORIES.ISOS,
    vmdk: CATEGORIES.ISOS
  });

  const MIME_PREFIX_MAP = [
    { prefix: 'image/', category: CATEGORIES.IMAGES },
    { prefix: 'video/', category: CATEGORIES.VIDEOS },
    { prefix: 'audio/', category: CATEGORIES.AUDIO },
    { prefix: 'application/pdf', category: CATEGORIES.DOCUMENTS },
    { prefix: 'application/zip', category: CATEGORIES.ARCHIVES },
    { prefix: 'application/x-rar', category: CATEGORIES.ARCHIVES },
    { prefix: 'application/x-7z', category: CATEGORIES.ARCHIVES },
    { prefix: 'application/x-tar', category: CATEGORIES.ARCHIVES },
    { prefix: 'application/gzip', category: CATEGORIES.ARCHIVES },
    { prefix: 'application/vnd.android.package-archive', category: CATEGORIES.PROGRAMS },
    { prefix: 'application/x-msdownload', category: CATEGORIES.PROGRAMS }
  ];

  function getCategoryForFile(filename, mimeType) {
    const extHelper = FilenameUtil && FilenameUtil.getFileExtension
      ? FilenameUtil.getFileExtension
      : (fn) => (fn ? (fn.split('.').pop() || '').toLowerCase() : '');

    const ext = extHelper(filename);
    if (ext && EXTENSION_MAP[ext]) {
      return EXTENSION_MAP[ext];
    }

    if (mimeType && typeof mimeType === 'string') {
      const lowerMime = mimeType.toLowerCase();
      for (const entry of MIME_PREFIX_MAP) {
        if (lowerMime.startsWith(entry.prefix)) {
          return entry.category;
        }
      }
    }

    return CATEGORIES.OTHER;
  }

  function getRelativeDownloadPath(filename, category, useSubfolders = true) {
    if (!useSubfolders || !category || category === CATEGORIES.OTHER) {
      return `MyDM/${filename}`;
    }
    return `MyDM/${category}/${filename}`;
  }

  const STREAMING_DOMAINS = new Set([
    'youtube.com', 'youtu.be', 'm.youtube.com',
    'vimeo.com', 'player.vimeo.com',
    'tiktok.com', 'vm.tiktok.com', 'm.tiktok.com',
    'twitter.com', 'x.com', 'mobile.twitter.com',
    'instagram.com', 'm.instagram.com',
    'facebook.com', 'm.facebook.com', 'fb.watch',
    'dailymotion.com',
    'reddit.com', 'v.redd.it',
    'twitch.tv', 'm.twitch.tv',
    'soundcloud.com',
    'bilibili.com', 'b23.tv'
  ]);

  function isStreamingUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      let domain = parsed.hostname.toLowerCase();
      if (domain.startsWith('www.')) domain = domain.substring(4);
      return STREAMING_DOMAINS.has(domain);
    } catch (_) {
      return false;
    }
  }

  function isPlaylistUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      let host = parsed.hostname.toLowerCase();
      if (host.startsWith('www.')) host = host.substring(4);
      if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
        return parsed.pathname === '/playlist' || parsed.searchParams.has('list');
      }
      return parsed.pathname.includes('/playlist') || parsed.searchParams.has('list');
    } catch (_) {
      return false;
    }
  }

  return {
    CATEGORIES,
    EXTENSION_MAP,
    STREAMING_DOMAINS,
    isStreamingUrl,
    isPlaylistUrl,
    getCategoryForFile,
    getRelativeDownloadPath
  };
});
