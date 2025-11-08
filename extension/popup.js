// MyDM Popup Script
// Manages the popup UI and communication with background service worker

// Track downloads and their UI state
let downloads = new Map();
let lastUpdateTime = new Date();

// Initialize popup on load
document.addEventListener('DOMContentLoaded', () => {
  loadDownloads();
  startAutoRefresh();
});

// Load downloads from chrome storage
function loadDownloads() {
  chrome.runtime.sendMessage({ action: 'getDownloads' }, (response) => {
    if (response && response.downloads) {
      downloads.clear();
      response.downloads.forEach(download => {
        downloads.set(download.id, download);
      });
      renderDownloads();
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
        <button class="btn btn-pause" data-id="${download.id}" onclick="pauseDownload('${download.id}')">
          ⏸ Pause
        </button>
        <button class="btn btn-cancel" data-id="${download.id}" onclick="cancelDownload('${download.id}')">
          ✕ Cancel
        </button>
      `;
    } else if (statusClass === 'paused') {
      actions = `
        <button class="btn btn-resume" data-id="${download.id}" onclick="resumeDownload('${download.id}')">
          ▶ Resume
        </button>
        <button class="btn btn-cancel" data-id="${download.id}" onclick="cancelDownload('${download.id}')">
          ✕ Cancel
        </button>
      `;
    } else if (statusClass === 'complete') {
      actions = `
        <button class="btn" style="background: #e8f5e9; color: #388e3c; border: 1px solid #c8e6c9; cursor: default;" disabled>
          ✓ Complete
        </button>
      `;
    } else if (statusClass === 'error') {
      actions = `
        <button class="btn" style="background: #ffebee; color: #d32f2f; border: 1px solid #ffcdd2; cursor: default;" disabled>
          ✕ Error
        </button>
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
    }

    // Build download info
    const speedInfo = download.speed && statusClass === 'downloading'
      ? `<div class="download-info-item">Speed: ${download.speed}</div>`
      : '';

    html += `
      <div class="download-item ${statusClass}">
        <div class="download-header">
          <div class="download-name" title="${download.filename}">
            ${escapeHtml(download.filename)}
          </div>
          <span class="download-status ${statusClass}">
            ${statusClass}
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

// Listen for updates from background service worker
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateDownload') {
    const message = request.data;
    if (message.id) {
      // Update or create download entry
      if (downloads.has(message.id)) {
        const existing = downloads.get(message.id);
        downloads.set(message.id, { ...existing, ...message });
      } else {
        downloads.set(message.id, message);
      }
      renderDownloads();
    }
  }
});

// Auto-refresh downloads every 500ms
function startAutoRefresh() {
  setInterval(() => {
    loadDownloads();
  }, 500);
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
