// MyDM Background Service Worker
// Handles native messaging and context menu integration

let nativePort = null;
let downloadQueue = new Map(); // Track active downloads

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
    const url = info.linkUrl || info.srcUrl;
    if (url) {
      sendToNativeHost({
        command: 'download',
        url: url,
        referer: tab.url
      });
    }
  }
});

// Connect to native host
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
      console.log('Disconnected from native host');
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

  if (nativePort) {
    try {
      nativePort.postMessage(message);
      console.log('Sent to native host:', message);
    } catch (error) {
      console.error('Failed to send message to native host:', error);
    }
  } else {
    console.error('Native host not available');
  }
}

// Handle messages from native host
function handleNativeMessage(message) {
  console.log('Message from native host:', message);

  switch (message.event) {
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

// Update download progress in storage
function updateDownloadProgress(message) {
  downloadQueue.set(message.id, {
    id: message.id,
    filename: message.filename,
    percent: message.percent,
    speed: message.speed || 'N/A',
    status: 'downloading',
    size: message.size,
    downloaded: message.downloaded
  });

  chrome.storage.local.set({ downloads: Array.from(downloadQueue.values()) });
}

// Handle download completion
function handleDownloadComplete(message) {
  downloadQueue.set(message.id, {
    id: message.id,
    filename: message.filename,
    percent: 100,
    status: 'complete',
    file: message.file
  });

  chrome.storage.local.set({ downloads: Array.from(downloadQueue.values()) });
}

// Handle download errors
function handleDownloadError(message) {
  downloadQueue.set(message.id, {
    id: message.id,
    filename: message.filename,
    status: 'error',
    error: message.error
  });

  chrome.storage.local.set({ downloads: Array.from(downloadQueue.values()) });
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
});

// Initialize on load
connectToNativeHost();
