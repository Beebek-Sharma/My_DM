/**
 * MyDM Background Service Worker (Manifest V3)
 * Orchestrates browser-native downloads, video streaming extraction via native host,
 * context menus, and popup communication.
 */

// Load engine modules synchronously into Service Worker scope
importScripts(
  'engine/state_machine.js',
  'engine/filename_util.js',
  'engine/rules_engine.js',
  'engine/speed_tracker.js',
  'engine/download_store.js',
  'engine/download_manager.js'
);

const { STATES, isActive } = MyDMStateMachine;
const FilenameUtil = typeof MyDMFilenameUtil !== 'undefined' ? MyDMFilenameUtil : (self.MyDMFilenameUtil || {});
const RulesEngine = typeof MyDMRulesEngine !== 'undefined' ? MyDMRulesEngine : (self.MyDMRulesEngine || {});
const SpeedTracker = typeof MyDMSpeedTracker !== 'undefined' ? MyDMSpeedTracker : (self.MyDMSpeedTracker || {});
const { DownloadStore } = MyDMDownloadStore;
const { DownloadEngine } = MyDMDownloadEngine;

const store = new DownloadStore();
const engine = new DownloadEngine(store);

// Initialize engine asynchronously and reconcile any stale native download states
engine.init().then(() => {
  const records = store.getAll();
  for (const r of records) {
    if (r.engine === 'native' && (r.status === STATES.DOWNLOADING || r.status === STATES.STARTING)) {
      store.updateRecord(r.id, {
        status: STATES.PAUSED,
        speed: 0,
        speedFormatted: ''
      });
    }
  }
}).catch((err) => {
  console.error('[MyDM] Engine init error:', err);
});

// Streaming domain detection
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
  try {
    const parsed = new URL(url);
    let domain = parsed.hostname.toLowerCase();
    if (domain.startsWith('www.')) domain = domain.substring(4);
    return STREAMING_DOMAINS.has(domain);
  } catch (_) {
    return false;
  }
}

function isDirectVideoUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) host = host.substring(4);
    const path = parsed.pathname;

    if (host === 'youtube.com' || host === 'm.youtube.com') {
      return path === '/watch' || path.startsWith('/shorts/') || path.startsWith('/live/');
    }
    if (host === 'youtu.be') return path.length > 1;
    if (host === 'vimeo.com' || host === 'player.vimeo.com') return /\/\d+/.test(path);
    if (host === 'tiktok.com' || host === 'm.tiktok.com' || host === 'vm.tiktok.com') {
      return path.includes('/video/') || path.includes('/v/');
    }
    if (host === 'instagram.com' || host === 'm.instagram.com') {
      return /^\/(p|reel|tv|stories)\/([A-Za-z0-9_-]+)/.test(path);
    }
    if (host === 'twitter.com' || host === 'x.com' || host === 'mobile.twitter.com') {
      return path.includes('/status/');
    }
    if (host === 'facebook.com' || host === 'm.facebook.com' || host === 'fb.watch') {
      return path.includes('/watch') || path.includes('/reel/') || path.includes('/videos/') || path.includes('story.php');
    }
    if (host === 'reddit.com' || host === 'v.redd.it') {
      return path.includes('/comments/') || host === 'v.redd.it';
    }
    if (host === 'twitch.tv' || host === 'm.twitch.tv') {
      return path.includes('/videos/') || path.includes('/clip/');
    }
    if (host === 'bilibili.com' || host === 'b23.tv') {
      return path.includes('/video/');
    }
    if (host === 'dailymotion.com') return path.includes('/video/');
    return false;
  } catch (_) {
    return false;
  }
}

function isPlaylistUrl(url) {
  if (!url) return false;
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

function getCookiesHeader(url, callback) {
  if (typeof callback === 'function') {
    if (typeof chrome === 'undefined' || !chrome.cookies || !url) {
      callback('');
      return;
    }
    try {
      chrome.cookies.getAll({ url }, (cookies) => {
        if (chrome.runtime.lastError || !cookies || cookies.length === 0) {
          callback('');
          return;
        }
        const header = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
        callback(header);
      });
    } catch (_) {
      callback('');
    }
    return;
  }
  return new Promise((resolve) => {
    getCookiesHeader(url, resolve);
  });
}

// Native Messaging Bridge (com.mydm.native)
let nativePort = null;

function getNativePort() {
  if (nativePort) return nativePort;
  try {
    nativePort = chrome.runtime.connectNative('com.mydm.native');
    nativePort.onMessage.addListener(handleNativeMessage);
    nativePort.onDisconnect.addListener(() => {
      const err = chrome.runtime.lastError ? chrome.runtime.lastError.message : 'Port disconnected';
      console.warn('[MyDM] Native messaging disconnected:', err);
      nativePort = null;
      const records = store.getAll();
      for (const r of records) {
        if (r.engine === 'native' && (r.status === STATES.DOWNLOADING || r.status === STATES.STARTING)) {
          store.updateRecord(r.id, {
            status: STATES.PAUSED,
            speed: 0,
            speedFormatted: ''
          });
        }
      }
    });
    return nativePort;
  } catch (err) {
    console.error('[MyDM] connectNative failed:', err);
    nativePort = null;
    return null;
  }
}

function sendToNativeHost(message) {
  const port = getNativePort();
  if (!port) {
    throw new Error('Native host connection failed. Ensure host is registered in Windows registry.');
  }
  port.postMessage(message);
}

const pendingFormatRequests = new Map();
const pendingPlaylistRequests = new Map();

function handleNativeMessage(msg) {
  if (!msg || !msg.id) return;

  // Handle video format detection responses
  if (msg.event === 'formats') {
    const pending = pendingFormatRequests.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingFormatRequests.delete(msg.id);
      pending.resolve(msg.data);
      return;
    }
  }

  if (msg.event === 'formats_error') {
    const pending = pendingFormatRequests.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingFormatRequests.delete(msg.id);
      pending.reject(new Error(msg.error || 'Failed to extract video formats'));
      return;
    }
  }

  // Handle playlist info detection responses
  if (msg.event === 'playlist_info') {
    const pending = pendingPlaylistRequests.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPlaylistRequests.delete(msg.id);
      pending.resolve(msg.data);
      return;
    }
  }

  if (msg.event === 'playlist_error') {
    const pending = pendingPlaylistRequests.get(msg.id);
    if (pending) {
      clearTimeout(pending.timer);
      pendingPlaylistRequests.delete(msg.id);
      pending.reject(new Error(msg.error || 'Failed to extract playlist info'));
      return;
    }
  }

  const record = store.get(msg.id);
  if (!record) return;

  switch (msg.event) {
    case 'started':
      store.updateRecord(msg.id, {
        status: STATES.DOWNLOADING,
        startedAt: record.startedAt || Date.now()
      });
      break;

    case 'progress': {
      const updates = {
        status: STATES.DOWNLOADING
      };
      if (msg.filename && msg.filename !== 'video.mp4') {
        updates.filename = msg.filename;
        updates.category = RulesEngine.getCategoryForFile(msg.filename);
      }
      if (typeof msg.percent === 'number') {
        updates.percent = Math.min(100, Math.max(0, Math.round(msg.percent)));
      }
      if (typeof msg.size === 'number' && msg.size > 0) {
        updates.totalBytes = msg.size;
      }
      if (typeof msg.downloaded === 'number') {
        updates.downloadedBytes = msg.downloaded;
      }
      if (msg.speed) {
        updates.speedFormatted = typeof msg.speed === 'string' ? msg.speed : '';
      }
      store.updateRecord(msg.id, updates);
      break;
    }

    case 'complete': {
      const updates = {
        status: STATES.COMPLETED,
        percent: 100,
        completedAt: Date.now()
      };
      if (msg.filename) {
        updates.filename = msg.filename;
        updates.category = RulesEngine.getCategoryForFile(msg.filename);
      }
      if (msg.file) {
        updates.filePath = msg.file;
      }
      store.updateRecord(msg.id, updates);
      checkNativeQueue();
      if (engine && engine.scheduleNext) engine.scheduleNext();
      break;
    }

    case 'error':
      store.updateRecord(msg.id, {
        status: STATES.FAILED,
        error: msg.error || 'Video extraction error'
      });
      checkNativeQueue();
      if (engine && engine.scheduleNext) engine.scheduleNext();
      break;

    case 'paused':
      store.updateRecord(msg.id, { status: STATES.PAUSED });
      checkNativeQueue();
      break;

    case 'resumed':
      store.updateRecord(msg.id, { status: STATES.DOWNLOADING });
      break;

    case 'cancelled':
      store.updateRecord(msg.id, { status: STATES.CANCELLED });
      checkNativeQueue();
      if (engine && engine.scheduleNext) engine.scheduleNext();
      break;
  }
}

function startNativeDownload(record) {
  if (!record || record.status === STATES.DOWNLOADING) return;
  store.updateRecord(record.id, {
    status: STATES.STARTING,
    startedAt: record.startedAt || Date.now(),
    error: null
  });

  getCookiesHeader(record.url, (cookieHeader) => {
    try {
      sendToNativeHost({
        command: 'download',
        url: record.url,
        referer: record.referer || record.url,
        id: record.id,
        filename: record.relativePath || record.filename,
        output_template: record.relativePath || record.filename,
        format_spec: record.formatSpec || null,
        audio_only: Boolean(record.audioOnly),
        is_streaming: true,
        cookie_header: cookieHeader || ''
      });
    } catch (err) {
      store.updateRecord(record.id, {
        status: STATES.FAILED,
        error: err.message
      });
      checkNativeQueue();
    }
  });
}

function checkNativeQueue() {
  const all = store.getAll();
  const activeCount = all.filter(
    (d) => d.status === STATES.DOWNLOADING || d.status === STATES.STARTING || d.status === STATES.RESUMING
  ).length;

  const maxConcurrent = (store.getSettings && store.getSettings().maxConcurrentDownloads) || 3;
  const availableSlots = Math.max(0, maxConcurrent - activeCount);
  if (availableSlots <= 0) return;

  const queuedNative = all.filter((d) => d.engine === 'native' && d.status === STATES.QUEUED);
  for (let i = 0; i < Math.min(availableSlots, queuedNative.length); i++) {
    startNativeDownload(queuedNative[i]);
  }
}

// Download dispatcher (routes streaming & custom formats to native host, others to browser engine)
async function triggerDownload({ url, referer = '', candidateName = '', formatSpec = null, audioOnly = false, quality = null }) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error('Invalid download URL. Must start with http:// or https://');
  }

  const isStreaming = isStreamingUrl(url) || Boolean(formatSpec) || Boolean(audioOnly);

  if (isStreaming) {
    const defaultExt = audioOnly ? 'mp3' : 'mp4';
    const category = audioOnly ? 'Audio' : 'Videos';

    const existing = store.getByUrl(url);
    if (existing && isActive(existing.status) && existing.category === category && (existing.formatSpec || null) === (formatSpec || null)) {
      return { duplicate: true, record: existing };
    }
    let candidate = candidateName;
    if (!candidate) {
      if (typeof FilenameUtil !== 'undefined' && FilenameUtil && typeof FilenameUtil.extractFilenameFromUrl === 'function') {
        candidate = FilenameUtil.extractFilenameFromUrl(url, `media.${defaultExt}`);
      } else if (typeof MyDMFilenameUtil !== 'undefined' && MyDMFilenameUtil && typeof MyDMFilenameUtil.extractFilenameFromUrl === 'function') {
        candidate = MyDMFilenameUtil.extractFilenameFromUrl(url, `media.${defaultExt}`);
      } else {
        try {
          const parsed = new URL(url);
          const v = parsed.searchParams.get('v');
          candidate = v ? `${v}.${defaultExt}` : `media.${defaultExt}`;
        } catch (_) {
          candidate = `media.${defaultExt}`;
        }
      }
    }
    const filename = candidate.includes('.') ? candidate : `${candidate}.${defaultExt}`;

    const all = store.getAll();
    const activeCount = all.filter(
      (d) => d.status === STATES.DOWNLOADING || d.status === STATES.STARTING || d.status === STATES.RESUMING
    ).length;
    const maxConcurrent = (store.getSettings && store.getSettings().maxConcurrentDownloads) || 3;
    const initialStatus = activeCount < maxConcurrent ? STATES.STARTING : STATES.QUEUED;

    const record = store.createRecord({
      url,
      referer: referer || url,
      filename,
      category,
      relativePath: `${category}/${filename}`,
      status: initialStatus,
      engine: 'native',
      audioOnly: Boolean(audioOnly),
      quality: quality || (audioOnly ? 'Audio MP3' : 'Best Quality'),
      formatSpec: formatSpec || null
    });

    if (initialStatus === STATES.STARTING) {
      startNativeDownload(record);
    }

    return { duplicate: false, record };
  }

  return await engine.addDownload({
    url,
    referer,
    candidateName
  });
}

// Setup context menus
chrome.runtime.onInstalled.addListener(() => {
  setupContextMenus();
});

function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'mydm-download-link',
      title: 'Download with MyDM',
      contexts: ['link', 'image', 'video', 'audio']
    });

    chrome.contextMenus.create({
      id: 'mydm-download-selection',
      title: 'Download Selected Link with MyDM',
      contexts: ['selection']
    });
  });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  let targetUrl = '';
  if (info.menuItemId === 'mydm-download-link') {
    targetUrl = info.linkUrl || info.srcUrl || '';
  } else if (info.menuItemId === 'mydm-download-selection') {
    const text = (info.selectionText || '').trim();
    if (text.startsWith('http://') || text.startsWith('https://')) {
      targetUrl = text;
    }
  }

  if (targetUrl && (targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    triggerDownload({
      url: targetUrl,
      referer: tab && tab.url ? tab.url : ''
    }).then((res) => {
      broadcastMessage('DOWNLOAD_UPDATED', { record: res.record });
    }).catch((err) => {
      console.error('[MyDM] Download trigger error:', err);
    });
  }
});

// Broadcast state updates to open popup views
store.subscribe((event, data) => {
  broadcastMessage('STORE_EVENT', { event, data });
});

function broadcastMessage(action, payload) {
  chrome.runtime.sendMessage({ action, ...payload }).catch(() => {
    // Popup not open; safe to ignore
  });
}

// Handle runtime messages from Popup and Content Scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const { action } = request;

  switch (action) {
    case 'GET_STATE':
    case 'GET_DOWNLOADS':
      sendResponse({
        downloads: store.getAll(),
        settings: store.getSettings()
      });
      return true;

    case 'GET_FORMATS': {
      const url = request.url;
      if (!url) {
        sendResponse({ success: false, error: 'No URL provided' });
        return true;
      }
      const id = 'fmt_' + Math.random().toString(36).substring(2, 9);
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingFormatRequests.delete(id);
          reject(new Error('Format detection timed out'));
        }, 15000);
        pendingFormatRequests.set(id, { resolve, reject, timer });
        getCookiesHeader(url, (cookieHeader) => {
          try {
            sendToNativeHost({ command: 'get_formats', id, url, cookie_header: cookieHeader || '' });
          } catch (err) {
            clearTimeout(timer);
            pendingFormatRequests.delete(id);
            reject(err);
          }
        });
      });

      promise
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'GET_PLAYLIST_INFO': {
      const url = request.url;
      if (!url) {
        sendResponse({ success: false, error: 'No URL provided' });
        return true;
      }
      const id = 'pli_' + Math.random().toString(36).substring(2, 9);
      const promise = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingPlaylistRequests.delete(id);
          reject(new Error('Playlist extraction timed out'));
        }, 30000);
        pendingPlaylistRequests.set(id, { resolve, reject, timer });
        getCookiesHeader(url, (cookieHeader) => {
          try {
            sendToNativeHost({ command: 'get_playlist_info', id, url, cookie_header: cookieHeader || '' });
          } catch (err) {
            clearTimeout(timer);
            pendingPlaylistRequests.delete(id);
            reject(err);
          }
        });
      });

      promise
        .then((data) => sendResponse({ success: true, data }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;
    }

    case 'DOWNLOAD_PLAYLIST': {
      const { playlistTitle, entries, formatSpec = null, audioOnly = false, quality = null, playlistUrl = '' } = request;
      if (!entries || !Array.isArray(entries) || entries.length === 0) {
        sendResponse({ success: false, error: 'No playlist entries provided' });
        return true;
      }

      const defaultExt = audioOnly ? 'mp3' : 'mp4';
      const category = audioOnly ? 'Audio' : 'Videos';
      const safeFolder = (playlistTitle || 'Playlist').replace(/[/\\?%*:|"<>]/g, '_').trim().slice(0, 60) || 'Playlist';

      const createdRecords = [];
      entries.forEach((entry, idx) => {
        if (!entry || !entry.url) return;
        const cleanEntryTitle = (entry.title || `Video_${idx + 1}`).replace(/[/\\?%*:|"<>]/g, '_').trim().slice(0, 70);
        const prefix = String(entry.index || (idx + 1)).padStart(2, '0');
        const filename = `${prefix} - ${cleanEntryTitle}.${defaultExt}`;
        const relativePath = `${category}/${safeFolder}/${filename}`;

        // Check if duplicate is active
        const existing = store.getByUrl(entry.url);
        if (existing && isActive(existing.status) && existing.relativePath === relativePath) {
          return;
        }

        if (existing && !isActive(existing.status)) {
          store.updateRecord(existing.id, {
            status: STATES.QUEUED,
            error: null,
            percent: 0,
            relativePath,
            filename,
            category,
            audioOnly: Boolean(audioOnly),
            quality: quality || (audioOnly ? 'Audio MP3' : 'Best Quality'),
            formatSpec: formatSpec || null
          });
          createdRecords.push(existing);
          return;
        }

        const record = store.createRecord({
          url: entry.url,
          referer: playlistUrl || entry.url,
          filename,
          category,
          relativePath,
          status: STATES.QUEUED,
          engine: 'native',
          audioOnly: Boolean(audioOnly),
          quality: quality || (audioOnly ? 'Audio MP3' : 'Best Quality'),
          formatSpec: formatSpec || null
        });
        createdRecords.push(record);
      });

      checkNativeQueue();
      sendResponse({ success: true, count: createdRecords.length, folder: safeFolder });
      return true;
    }

    case 'CREATE_DOWNLOAD':
    case 'downloadFromPopup': {
      const url = request.url;
      if (!url) {
        sendResponse({ success: false, error: 'No URL provided' });
        return true;
      }
      triggerDownload({
        url,
        referer: request.referer || '',
        candidateName: request.filename || request.candidateName || '',
        formatSpec: request.formatSpec || null,
        audioOnly: Boolean(request.audioOnly),
        quality: request.quality || null
      }).then((res) => {
        sendResponse({ success: true, ...res });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

    case 'PAUSE':
    case 'PAUSE_DOWNLOAD':
    case 'pauseDownload': {
      const record = store.get(request.id);
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({ command: 'pause', id: request.id });
          store.updateRecord(request.id, { status: STATES.PAUSED });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else {
        engine.pauseDownload(request.id).then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      }
      return true;
    }

    case 'RESUME':
    case 'RESUME_DOWNLOAD':
    case 'resumeDownload': {
      const record = store.get(request.id);
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({ command: 'resume', id: request.id });
          store.updateRecord(request.id, { status: STATES.DOWNLOADING });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else {
        engine.resumeDownload(request.id).then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      }
      return true;
    }

    case 'CANCEL':
    case 'CANCEL_DOWNLOAD':
    case 'cancelDownload': {
      const record = store.get(request.id);
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({ command: 'cancel', id: request.id });
        } catch (_) {}
        store.updateRecord(request.id, { status: STATES.CANCELLED });
        checkNativeQueue();
        sendResponse({ success: true });
      } else {
        engine.cancelDownload(request.id).then(() => {
          checkNativeQueue();
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      }
      return true;
    }

    case 'RETRY':
    case 'RETRY_DOWNLOAD': {
      const record = store.get(request.id);
      if (record && record.engine === 'native') {
        try {
          startNativeDownload(record);
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else {
        engine.retryDownload(request.id).then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      }
      return true;
    }

    case 'REMOVE':
    case 'DELETE_DOWNLOAD':
    case 'removeDownload': {
      const deleted = store.removeRecord(request.id);
      checkNativeQueue();
      sendResponse({ success: deleted });
      return true;
    }

    case 'CLEAR_COMPLETED':
    case 'clearCompleted': {
      const count = store.clearCompleted();
      sendResponse({ success: true, count });
      return true;
    }

    case 'CLEAR_ALL':
    case 'clearAll': {
      const count = store.clearAll();
      sendResponse({ success: true, count });
      return true;
    }

    case 'SHOW_IN_FOLDER':
    case 'showInFolder': {
      const record = store.get(request.id);
      const targetPath = (record && (record.filePath || record.relativePath || record.filename)) || '';
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({
            command: 'show_in_folder',
            id: request.id,
            path: targetPath
          });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else {
        const shown = engine.showInFolder(request.id);
        if (!shown && targetPath) {
          try {
            sendToNativeHost({
              command: 'show_in_folder',
              id: request.id,
              path: targetPath
            });
          } catch (_) {}
        }
        sendResponse({ success: shown || true });
      }
      return true;
    }

    case 'OPEN_FILE':
    case 'openFile': {
      const record = store.get(request.id);
      const targetPath = (record && (record.filePath || record.relativePath || record.filename)) || '';
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({
            command: 'open_file',
            id: request.id,
            path: targetPath
          });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else {
        const opened = engine.openFile(request.id);
        if (!opened && targetPath) {
          try {
            sendToNativeHost({
              command: 'open_file',
              id: request.id,
              path: targetPath
            });
          } catch (_) {}
        }
        sendResponse({ success: opened || true });
      }
      return true;
    }

    case 'UPDATE_SETTINGS': {
      const updated = store.updateSettings(request.settings || {});
      sendResponse({ success: true, settings: updated });
      return true;
    }

    case 'DETECT_PAGE_RESOURCES': {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs || tabs.length === 0 || !tabs[0].id) {
          sendResponse({ resources: [] });
          return;
        }
        const activeTab = tabs[0];
        const pageStreamResources = [];
        if (isPlaylistUrl(activeTab.url)) {
          const rawTitle = (activeTab.title || 'Playlist').replace(/\s*-\s*YouTube$/i, '').trim();
          pageStreamResources.push({
            url: activeTab.url,
            filename: `${rawTitle.slice(0, 70)} (Playlist)`,
            extension: 'mp4',
            type: 'playlist',
            title: `📁 Playlist: ${rawTitle}`,
            isStream: true,
            isPlaylist: true,
            thumbnail: activeTab.favIconUrl || ''
          });
        }
        if (isDirectVideoUrl(activeTab.url)) {
          pageStreamResources.push({
            url: activeTab.url,
            filename: `${(activeTab.title || 'video').slice(0, 80)}.mp4`,
            extension: 'mp4',
            type: 'video',
            title: activeTab.title || 'Streaming Video',
            isStream: true,
            thumbnail: activeTab.favIconUrl || ''
          });
        }

        function queryTab(canInject = true) {
          chrome.tabs.sendMessage(activeTab.id, { action: 'DETECT_PAGE_RESOURCES' }, (res) => {
            if (chrome.runtime.lastError || !res) {
              if (canInject && chrome.scripting && activeTab.id) {
                chrome.scripting.executeScript({
                  target: { tabId: activeTab.id },
                  files: ['content.js']
                }, () => {
                  if (chrome.runtime.lastError) {
                    sendResponse({ resources: pageStreamResources });
                  } else {
                    queryTab(false);
                  }
                });
                return;
              }
              sendResponse({ resources: pageStreamResources });
            } else {
              const list = res.resources || [];
              for (let i = pageStreamResources.length - 1; i >= 0; i--) {
                const item = pageStreamResources[i];
                if (!list.some((r) => r.url === item.url)) {
                  list.unshift(item);
                }
              }
              sendResponse({ resources: list });
            }
          });
        }

        queryTab(true);
      });
      return true;
    }

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return true;
  }
});
