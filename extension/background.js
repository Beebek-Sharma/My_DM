// MyDM Background Service Worker
// Handles native messaging and context menu integration

let nativePort = null;
let downloadQueue = new Map(); // Track active downloads
const knownIds = new Set(); // IDs that belong to this session

// Persist queue to storage (throttled)
let persistTimeout = null;
function persistQueue() {
  // Throttle storage writes to avoid excessive I/O
  if (persistTimeout) clearTimeout(persistTimeout);
  persistTimeout = setTimeout(() => {
    chrome.storage.local.set({ downloads: Array.from(downloadQueue.values()) });
    persistTimeout = null;
  }, 100); // Wait 100ms before actual write
}

// Load persisted queue when SW starts
chrome.storage.local.get('downloads', (result) => {
  let list = [];
  if (result && Array.isArray(result.downloads)) {
    list = result.downloads;
  }
  list.forEach(d => {
    if (d && d.id) downloadQueue.set(d.id, d);
  });
});

// Initialize context menu on extension load
chrome.runtime.onInstalled.addListener(() => {
  createContextMenu();
});

// Create context menu for downloads
function createContextMenu() {
  chrome.contextMenus.create({
    id: 'download-with-mydm',
    title: 'Download with MyDM',
    contexts: ['link', 'image', 'video', 'audio']
  });
}

// Handle context menu click
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'download-with-mydm') {
    // Only send the download command for the specific item right-clicked
    let url = '';
    if (info.linkUrl) {
      url = info.linkUrl;
    } else if (info.srcUrl) {
      url = info.srcUrl;
    }
    // Prevent accidental triggering for empty or invalid URLs
    if (url && typeof url === 'string' && url.startsWith('http')) {
      sendToNativeHost({
        command: 'download',
        url: url,
        referer: tab && tab.url ? tab.url : ''
      });
    } else {
      console.warn('No valid URL found for context menu download:', info);
    }
  }
});

// Connect to native host (lazily)
function connectToNativeHost() {
  try {
    nativePort = chrome.runtime.connectNative('com.mydm.native');
    console.log('Connected to MyDM native host');

    // Handle messages from native host
    nativePort.onMessage.addListener((message) => {
      handleNativeMessage(message);
    });

    // Handle disconnection
    nativePort.onDisconnect.addListener(() => {
      // Avoid noisy console errors when host exits naturally
      nativePort = null;
    });
  } catch (error) {
    console.error('Failed to connect to native host:', error);
  }
}

// Send message to native host
function sendToNativeHost(message) {
  if (!nativePort) {
    connectToNativeHost();
  }

  if (!nativePort) {
    console.error('Native host not available');
    return;
  }

  try {
    nativePort.postMessage(message);
    console.log('Sent to native host:', message);
  } catch (error) {
    // Try a one-time reconnect
    try {
      connectToNativeHost();
      if (nativePort) {
        nativePort.postMessage(message);
        console.log('Sent to native host after reconnect:', message);
        return;
      }
    } catch (_) {}
    console.error('Failed to send message to native host:', error);
  }
}

// Handle messages from native host
function handleNativeMessage(message) {
  console.log('Message from native host:', message);

  switch (message.event) {
    case 'started':
      handleDownloadStarted(message);
      break;
    case 'progress':
      updateDownloadProgress(message);
      break;
    case 'complete':
      handleDownloadComplete(message);
      break;
    case 'error':
      handleDownloadError(message);
      break;
    case 'paused':
      updateDownloadStatus(message);
      break;
    case 'resumed':
      updateDownloadStatus(message);
      break;
    default:
      console.warn('Unknown event from native host:', message.event);
  }

  // Broadcast to popup if open
  chrome.runtime.sendMessage({
    action: 'updateDownload',
    data: message
  }).catch(() => {
    // Popup not open, ignore error
  });
}

// Handle download start
function handleDownloadStarted(message) {
  knownIds.add(message.id);
  downloadQueue.set(message.id, {
    id: message.id,
    filename: 'Starting download...',
    percent: 0,
    speed: 'N/A',
    status: 'downloading',
    size: 0,
    downloaded: 0
  });

  persistQueue();
}

// Update download progress in storage
function updateDownloadProgress(message) {
  if (!downloadQueue.has(message.id)) {
    // Ignore late progress for cleared/old items
    return;
  }
  downloadQueue.set(message.id, {
    id: message.id,
    filename: message.filename,
    percent: message.percent,
    speed: message.speed || 'N/A',
    status: 'downloading',
    size: message.size,
    downloaded: message.downloaded
  });

  persistQueue();
}

// Handle download completion
function handleDownloadComplete(message) {
  if (!downloadQueue.has(message.id)) return;
  downloadQueue.set(message.id, {
    id: message.id,
    filename: message.filename,
    percent: 100,
    status: 'complete',
    file: message.file
  });

  persistQueue();
}

// Handle download errors
function handleDownloadError(message) {
  if (!downloadQueue.has(message.id)) return; // Ignore errors from old/cleared items
  const existing = downloadQueue.get(message.id) || {};
  downloadQueue.set(message.id, {
    id: message.id,
    filename: message.filename || existing.filename || 'Unknown file',
    status: 'error',
    error: message.error,
    size: existing.size || 0,
    downloaded: existing.downloaded || 0
  });

  persistQueue();
}

// Update download status (pause/resume)
function updateDownloadStatus(message) {
  if (downloadQueue.has(message.id)) {
    const download = downloadQueue.get(message.id);
    download.status = message.event;
    downloadQueue.set(message.id, download);
    chrome.storage.local.set({ downloads: Array.from(downloadQueue.values()) });
  }
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getDownloads') {
    chrome.storage.local.get('downloads', (result) => {
      sendResponse({ downloads: result.downloads || [] });
    });
    return true; // Keep channel open for async response
  }

  if (request.action === 'pauseDownload') {
    sendToNativeHost({
      command: 'pause',
      id: request.id
    });
    sendResponse({ status: 'pause_requested' });
    return true;
  }

  if (request.action === 'resumeDownload') {
    sendToNativeHost({
      command: 'resume',
      id: request.id
    });
    sendResponse({ status: 'resume_requested' });
    return true;
  }

  if (request.action === 'cancelDownload') {
    sendToNativeHost({
      command: 'cancel',
      id: request.id
    });
    sendResponse({ status: 'cancel_requested' });
    return true;
  }

  if (request.action === 'removeDownload') {
    if (downloadQueue.has(request.id)) {
      downloadQueue.delete(request.id);
      knownIds.delete(request.id);
      persistQueue();
    }
    sendResponse({ status: 'removed' });
    return true;
  }

  if (request.action === 'clearCompleted') {
    const next = new Map();
    for (const [id, d] of downloadQueue.entries()) {
      if (d.status !== 'complete' && d.status !== 'error' && d.status !== 'cancelled') {
        next.set(id, d);
      } else {
        knownIds.delete(id);
      }
    }
    downloadQueue = next;
    persistQueue();
    sendResponse({ status: 'cleared_completed' });
    return true;
  }

  if (request.action === 'clearAll') {
    downloadQueue.clear();
    knownIds.clear();
    persistQueue();
    sendResponse({ status: 'cleared_all' });
    return true;
  }

  if (request.action === 'downloadFromPopup') {
    const url = request.url;
    if (url) {
      sendToNativeHost({
        command: 'download',
        url: url,
        referer: url // Use URL as referer
      });
      sendResponse({ status: 'started' });
    } else {
      sendResponse({ status: 'error', error: 'No URL provided' });
    }
    return true;
  }
});

// Do not connect on load; connect lazily when a command is sent
