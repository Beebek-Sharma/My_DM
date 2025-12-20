// MyDM Popup Script - Complete Rewrite
// Manages the popup UI and communication with background service worker

let downloads = new Map();
let lastUpdateTime = new Date();
let lastRenderedState = ''; // Track last rendered state to avoid unnecessary re-renders

// Initialize popup on load
document.addEventListener('DOMContentLoaded', () => {
  loadDownloads();
  startAutoRefresh();

  // Attach event listeners to header buttons
  document.getElementById('btnClearCompleted').addEventListener('click', clearCompleted);
  document.getElementById('btnClearAll').addEventListener('click', clearAll);
  document.getElementById('btnDownload').addEventListener('click', downloadFromInput);
  document.getElementById('btnPaste').addEventListener('click', pasteFromClipboard);

  // Allow Enter key to trigger download
  document.getElementById('linkInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      downloadFromInput();
    }
  });
});

// Load downloads from chrome storage
function loadDownloads() {
  chrome.runtime.sendMessage({ action: 'getDownloads' }, (response) => {
    if (response && response.downloads) {
      // Create a comparable state string
      const newState = JSON.stringify(response.downloads);

      // Only update if state has changed
      if (newState !== lastRenderedState) {
        downloads.clear();
        response.downloads.forEach(download => {
          downloads.set(download.id, download);
        });
        lastRenderedState = newState;
        renderDownloads();
      }
    }
  });
}

// Render downloads in the UI
function renderDownloads() {
  const container = document.getElementById('downloadsContainer');

  if (downloads.size === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📁</div>
        <p>No active downloads</p>
        <p style="font-size: 12px;">Right-click any file to download with MyDM</p>
      </div>
    `;
    document.getElementById('statusBadge').textContent = 'Idle';
    return;
  }

  // Count active downloads
  const activeCount = Array.from(downloads.values()).filter(
    d => d.status === 'downloading' || d.status === 'paused'
  ).length;
  document.getElementById('statusBadge').textContent = `${activeCount} Active`;

  // Build HTML for all downloads
  let html = '';
  downloads.forEach((download) => {
    // Safety checks for undefined properties
    if (!download || !download.id) return; // Skip invalid downloads

    const filename = download.filename || 'Unknown file';
    const statusClass = download.status || 'downloading';
    const isActive = statusClass === 'downloading' || statusClass === 'paused';

    // Format file size
    const sizeStr = download.size
      ? formatBytes(download.size)
      : 'Unknown size';
    const downloadedStr = download.downloaded
      ? formatBytes(download.downloaded)
      : '0 B';

    // Determine button visibility
    let actions = '';
    if (statusClass === 'downloading') {
      actions = `
        <button class="btn btn-pause" data-action="pause" data-id="${download.id}" type="button">⏸ Pause</button>
        <button class="btn btn-cancel" data-action="cancel" data-id="${download.id}" type="button">✕ Cancel</button>
      `;
    } else if (statusClass === 'paused') {
      actions = `
        <button class="btn btn-resume" data-action="resume" data-id="${download.id}" type="button">▶ Resume</button>
        <button class="btn btn-cancel" data-action="cancel" data-id="${download.id}" type="button">✕ Cancel</button>
      `;
    } else if (statusClass === 'complete') {
      actions = `
        <button class="btn btn-complete" disabled type="button">✓ Complete</button>
        <button class="btn btn-show-folder" data-action="showFolder" data-id="${download.id}" type="button">📂 Show in Folder</button>
        <button class="btn btn-remove" data-action="remove" data-id="${download.id}" type="button">🗑 Remove</button>
      `;
    } else if (statusClass === 'error') {
      actions = `
        <button class="btn" style="background: #ffebee; color: #d32f2f; border: 1px solid #ffcdd2;" disabled type="button">✕ Error</button>
        <button class="btn" style="background:#f5f5f5;color:#555;border:1px solid #ddd;" data-action="remove" data-id="${download.id}" type="button">🗑 Remove</button>
      `;
    }

    // Build error message if present
    const errorMsg = download.error ? `<div class="error-message">Error: ${download.error}</div>` : '';

    // Build progress bar section
    let progressSection = '';
    if (statusClass === 'downloading' || statusClass === 'paused') {
      const percent = Math.min(100, Math.max(0, download.percent || 0));
      progressSection = `
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${percent}%"></div>
          </div>
          <div class="progress-text">
            <span>${percent}%</span>
            <span>${downloadedStr} / ${sizeStr}</span>
          </div>
        </div>
      `;
    } else if (statusClass === 'complete') {
      progressSection = `<div class="success-message">Download complete!</div>`;
    }

    // Build download info
    const speedInfo = download.speed && statusClass === 'downloading'
      ? `<div class="download-info-item">Speed: ${download.speed}</div>`
      : '';

    html += `
      <div class="download-item ${statusClass}">
        <div class="download-header">
          <div class="download-name" title="${filename}">
            ${escapeHtml(filename)}
          </div>
          <span class="download-status ${statusClass}">
            ${statusClass === 'complete' ? '<span style="color:#388e3c;font-weight:bold;">✓ Complete</span>' : statusClass}
          </span>
        </div>
        <div class="download-info">
          ${speedInfo}
          <div class="download-info-item">${sizeStr}</div>
        </div>
        ${progressSection}
        ${errorMsg}
        ${isActive || statusClass === 'complete' ? `<div class="download-actions">${actions}</div>` : ''}
      </div>
    `;
  });

  container.innerHTML = html;
  updateLastUpdated();

  // Attach event listeners to all action buttons
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const downloadId = btn.dataset.id;
    if (action === 'pause') {
      pauseDownload(downloadId);
    } else if (action === 'resume') {
      resumeDownload(downloadId);
    } else if (action === 'cancel') {
      cancelDownload(downloadId);
    } else if (action === 'remove') {
      removeDownload(downloadId);
    } else if (action === 'showFolder') {
      showInFolder(downloadId);
    }
  });
  // Show in folder for completed download
  function showInFolder(downloadId) {
    chrome.runtime.sendMessage({
      action: 'showInFolder',
      id: downloadId
    });
  }
}

// Pause a download
function pauseDownload(downloadId) {
  chrome.runtime.sendMessage({
    action: 'pauseDownload',
    id: downloadId
  }, (response) => {
    if (response) {
      console.log('Pause requested for', downloadId);
    }
  });
}

// Resume a download
function resumeDownload(downloadId) {
  chrome.runtime.sendMessage({
    action: 'resumeDownload',
    id: downloadId
  }, (response) => {
    if (response) {
      console.log('Resume requested for', downloadId);
    }
  });
}

// Cancel a download
function cancelDownload(downloadId) {
  if (confirm('Are you sure you want to cancel this download?')) {
    chrome.runtime.sendMessage({
      action: 'cancelDownload',
      id: downloadId
    }, (response) => {
      if (response) {
        console.log('Cancel requested for', downloadId);
      }
    });
  }
}

// Remove a download from list (works even if background/native host are inactive)
function removeDownload(downloadId) {
  chrome.storage.local.get('downloads', (result) => {
    const list = (result.downloads || []).filter(d => d.id !== downloadId);
    chrome.storage.local.set({ downloads: list }, () => {
      loadDownloads();
    });
  });
}

function clearCompleted() {
  chrome.storage.local.get('downloads', (result) => {
    const list = (result.downloads || []).filter(d => !['complete', 'error', 'cancelled'].includes(d.status));
    chrome.storage.local.set({ downloads: list }, () => {
      loadDownloads();
    });
  });
}

function clearAll() {
  if (confirm('Clear all items from the list?')) {
    chrome.storage.local.set({ downloads: [] }, () => {
      downloads.clear();
      renderDownloads();
    });
  }
}

// Listen for updates from background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateDownload') {
    const message = request.data;
    if (!message || !message.id) return;

    // Normalize native-host events into the popup's download object shape.
    const normalized = normalizeNativeMessage(message);
    const existing = downloads.get(message.id) || {};
    downloads.set(message.id, { ...existing, ...normalized });
    renderDownloads();
  }
});

function normalizeNativeMessage(message) {
  const out = { ...message };

  // Convert native host event into a stable status field.
  if (message.event === 'started') {
    out.status = 'downloading';
    out.filename = out.filename || 'Starting download...';
    out.percent = typeof out.percent === 'number' ? out.percent : 0;
    out.speed = out.speed || 'N/A';
    out.size = typeof out.size === 'number' ? out.size : 0;
    out.downloaded = typeof out.downloaded === 'number' ? out.downloaded : 0;
  } else if (message.event === 'progress') {
    out.status = 'downloading';
  } else if (message.event === 'paused') {
    out.status = 'paused';
  } else if (message.event === 'resumed') {
    out.status = 'downloading';
  } else if (message.event === 'cancelled') {
    out.status = 'cancelled';
  } else if (message.event === 'complete') {
    out.status = 'complete';
    out.percent = 100;
  } else if (message.event === 'error') {
    out.status = 'error';
    out.filename = out.filename || 'Unknown file';
  }

  // Ensure percent is a safe number when present.
  if (out.percent !== undefined) {
    const p = Number(out.percent);
    out.percent = Number.isFinite(p) ? Math.min(100, Math.max(0, p)) : 0;
  }

  return out;
}

// Auto-refresh downloads every 1000ms (reduced from 500ms for performance)
function startAutoRefresh() {
  setInterval(() => {
    loadDownloads();
  }, 1000);
}

// Format bytes to human-readable format
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// Update last updated timestamp
function updateLastUpdated() {
  const now = new Date();
  const seconds = Math.floor((now - lastUpdateTime) / 1000);

  let timeStr;
  if (seconds < 5) {
    timeStr = 'Just now';
  } else if (seconds < 60) {
    timeStr = `${seconds}s ago`;
  } else {
    const minutes = Math.floor(seconds / 60);
    timeStr = `${minutes}m ago`;
  }

  document.getElementById('lastUpdated').textContent = timeStr;
  lastUpdateTime = now;
}

// Escape HTML to prevent XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Download from input box
function downloadFromInput() {
  const url = document.getElementById('linkInput').value.trim();

  if (!url) {
    alert('Please enter a URL');
    return;
  }

  // Validate URL
  try {
    new URL(url);
  } catch (e) {
    alert('Please enter a valid URL');
    return;
  }

  // Send download request to background
  chrome.runtime.sendMessage({
    action: 'downloadFromPopup',
    url: url
  }, (response) => {
    if (response && response.status === 'started') {
      document.getElementById('linkInput').value = ''; // Clear input
      console.log('Download started from popup');
    } else {
      alert('Failed to start download');
    }
  });
}

// Paste from clipboard
function pasteFromClipboard() {
  navigator.clipboard.readText()
    .then(text => {
      document.getElementById('linkInput').value = text;
    })
    .catch(err => {
      alert('Failed to read clipboard. Please paste manually.');
    });
}
