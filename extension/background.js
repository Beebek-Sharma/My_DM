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

// Initialize engine asynchronously
engine.init().catch((err) => {
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

function handleNativeMessage(msg) {
  if (!msg || !msg.id) return;
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
      break;
    }

    case 'error':
      store.updateRecord(msg.id, {
        status: STATES.FAILED,
        error: msg.error || 'Video extraction error'
      });
      break;

    case 'paused':
      store.updateRecord(msg.id, { status: STATES.PAUSED });
      break;

    case 'resumed':
      store.updateRecord(msg.id, { status: STATES.DOWNLOADING });
      break;

    case 'cancelled':
      store.updateRecord(msg.id, { status: STATES.CANCELLED });
      break;
  }
}

// Download dispatcher (routes streaming to native host, others to browser engine)
async function triggerDownload({ url, referer = '', candidateName = '' }) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    throw new Error('Invalid download URL. Must start with http:// or https://');
  }

  if (isStreamingUrl(url)) {
    const existing = store.getByUrl(url);
    if (existing && isActive(existing.status)) {
      return { duplicate: true, record: existing };
    }

    let candidate = candidateName;
    if (!candidate) {
      if (typeof FilenameUtil !== 'undefined' && FilenameUtil && typeof FilenameUtil.extractFilenameFromUrl === 'function') {
        candidate = FilenameUtil.extractFilenameFromUrl(url, 'video.mp4');
      } else if (typeof MyDMFilenameUtil !== 'undefined' && MyDMFilenameUtil && typeof MyDMFilenameUtil.extractFilenameFromUrl === 'function') {
        candidate = MyDMFilenameUtil.extractFilenameFromUrl(url, 'video.mp4');
      } else {
        try {
          const parsed = new URL(url);
          const v = parsed.searchParams.get('v');
          candidate = v ? `${v}.mp4` : 'video.mp4';
        } catch (_) {
          candidate = 'video.mp4';
        }
      }
    }
    const filename = candidate.includes('.') ? candidate : `${candidate}.mp4`;

    const record = store.createRecord({
      url,
      referer: referer || url,
      filename,
      category: 'Videos',
      relativePath: `Videos/${filename}`,
      status: STATES.STARTING,
      engine: 'native'
    });

    sendToNativeHost({
      command: 'download',
      url: url,
      referer: referer || url,
      id: record.id
    });

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
        candidateName: request.filename || ''
      }).then((res) => {
        sendResponse({ success: true, ...res });
      }).catch((err) => {
        sendResponse({ success: false, error: err.message });
      });
      return true;
    }

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

    case 'CANCEL_DOWNLOAD':
    case 'cancelDownload': {
      const record = store.get(request.id);
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({ command: 'cancel', id: request.id });
        } catch (_) {}
        store.updateRecord(request.id, { status: STATES.CANCELLED });
        sendResponse({ success: true });
      } else {
        engine.cancelDownload(request.id).then(() => {
          sendResponse({ success: true });
        }).catch((err) => {
          sendResponse({ success: false, error: err.message });
        });
      }
      return true;
    }

    case 'RETRY_DOWNLOAD': {
      const record = store.get(request.id);
      if (record && record.engine === 'native') {
        try {
          store.updateRecord(request.id, {
            status: STATES.STARTING,
            error: null,
            percent: 0
          });
          sendToNativeHost({
            command: 'download',
            url: record.url,
            referer: record.referer || record.url,
            id: record.id
          });
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

    case 'DELETE_DOWNLOAD':
    case 'removeDownload': {
      const deleted = store.removeRecord(request.id);
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
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({
            command: 'show_in_folder',
            id: request.id,
            path: record.filePath || record.filename || ''
          });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else {
        const shown = engine.showInFolder(request.id);
        sendResponse({ success: shown });
      }
      return true;
    }

    case 'OPEN_FILE':
    case 'openFile': {
      const record = store.get(request.id);
      if (record && record.engine === 'native') {
        try {
          sendToNativeHost({
            command: 'open_file',
            id: request.id,
            path: record.filePath || record.filename || ''
          });
          sendResponse({ success: true });
        } catch (err) {
          sendResponse({ success: false, error: err.message });
        }
      } else {
        const opened = engine.openFile(request.id);
        sendResponse({ success: opened });
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
        chrome.tabs.sendMessage(tabs[0].id, { action: 'DETECT_PAGE_RESOURCES' }, (res) => {
          if (chrome.runtime.lastError || !res) {
            sendResponse({ resources: [] });
          } else {
            sendResponse({ resources: res.resources || [] });
          }
        });
      });
      return true;
    }

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
      return true;
  }
});
