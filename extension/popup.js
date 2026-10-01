/**
 * MyDM Popup Controller
 * Manages UI rendering, user actions, filtering, media sniffer, and settings.
 */

(function () {
  'use strict';

  const SpeedTracker = typeof MyDMSpeedTracker !== 'undefined' ? MyDMSpeedTracker : null;

  let currentTab = 'downloads';
  let downloadsList = [];
  let settings = {};
  let detectedMedia = [];
  let pollInterval = null;

  // DOM Elements
  const badgeActiveCount = document.getElementById('badgeActiveCount');
  const downloadsContainer = document.getElementById('downloadsList');
  const snifferContainer = document.getElementById('snifferList');
  const inputUrl = document.getElementById('inputUrl');
  const inputSearch = document.getElementById('inputSearch');
  const selectCategory = document.getElementById('selectCategory');
  const labelLastUpdated = document.getElementById('labelLastUpdated');

  // Tab Content Panels
  const tabPanels = {
    downloads: document.getElementById('tabDownloads'),
    active: document.getElementById('tabDownloads'),
    completed: document.getElementById('tabDownloads'),
    sniffer: document.getElementById('tabSniffer'),
    settings: document.getElementById('tabSettings')
  };

  // Settings Inputs
  const settingMaxConcurrent = document.getElementById('settingMaxConcurrent');
  const settingAutoCategorize = document.getElementById('settingAutoCategorize');
  const settingCategoryFolders = document.getElementById('settingCategoryFolders');
  const settingConflictAction = document.getElementById('settingConflictAction');
  const settingMaxRetries = document.getElementById('settingMaxRetries');

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadState();
    startPolling();
  });

  function bindEvents() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabKey = btn.dataset.tab;
        switchTab(tabKey, btn);
      });
    });

    // Start download
    document.getElementById('btnStartDownload').addEventListener('click', handleDownloadInput);
    inputUrl.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleDownloadInput();
    });

    // Paste clipboard
    document.getElementById('btnPasteClipboard').addEventListener('click', handlePasteClipboard);

    // Search and category filter
    inputSearch.addEventListener('input', renderDownloads);
    selectCategory.addEventListener('change', renderDownloads);

    // Clear and reload buttons
    document.getElementById('btnClearCompleted').addEventListener('click', handleClearCompleted);
    document.getElementById('btnClearAll').addEventListener('click', handleClearAll);
    const btnReload = document.getElementById('btnReloadExt');
    if (btnReload) {
      btnReload.addEventListener('click', () => {
        chrome.runtime.reload();
        window.close();
      });
    }

    // Media scan button
    document.getElementById('btnScanMedia').addEventListener('click', scanCurrentPageMedia);

    // Save settings
    document.getElementById('btnSaveSettings').addEventListener('click', handleSaveSettings);

    // Downloads List Event Delegation (Pause, Resume, Cancel, Retry, Folder, Open, Delete)
    downloadsContainer.addEventListener('click', handleItemAction);
    snifferContainer.addEventListener('click', handleSnifferAction);

    // Listen for background updates
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'STORE_EVENT' || request.action === 'DOWNLOAD_UPDATED') {
        loadState();
      }
    });
  }

  function switchTab(tabKey, activeBtn) {
    currentTab = tabKey;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    activeBtn.classList.add('active');

    // Show appropriate tab content
    Object.values(tabPanels).forEach((panel) => panel.classList.remove('active'));
    if (tabPanels[tabKey]) {
      tabPanels[tabKey].classList.add('active');
    }

    if (tabKey === 'sniffer' && detectedMedia.length === 0) {
      scanCurrentPageMedia();
    }

    renderDownloads();
  }

  function loadState() {
    chrome.runtime.sendMessage({ action: 'GET_STATE' }, (res) => {
      if (chrome.runtime.lastError || !res) return;

      downloadsList = res.downloads || [];
      settings = res.settings || {};

      updateHeaderStats();
      syncSettingsForm();
      renderDownloads();

      labelLastUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString();
    });
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(loadState, 1000);
  }

  function updateHeaderStats() {
    const active = downloadsList.filter(
      (d) => d.status === 'DOWNLOADING' || d.status === 'STARTING' || d.status === 'RESUMING' || d.status === 'QUEUED'
    ).length;

    badgeActiveCount.textContent = active > 0 ? `${active} Active` : 'Idle';
    badgeActiveCount.style.background = active > 0 ? 'rgba(56, 189, 248, 0.25)' : 'rgba(255, 255, 255, 0.1)';
  }

  function syncSettingsForm() {
    if (settingMaxConcurrent) settingMaxConcurrent.value = settings.maxConcurrentDownloads || 3;
    if (settingAutoCategorize) settingAutoCategorize.checked = settings.autoCategorize !== false;
    if (settingCategoryFolders) settingCategoryFolders.checked = settings.categoryFolders !== false;
    if (settingConflictAction) settingConflictAction.value = settings.conflictAction || 'uniquify';
    if (settingMaxRetries) settingMaxRetries.value = settings.maxRetries !== undefined ? settings.maxRetries : 3;
  }

  function handleSaveSettings() {
    const newSettings = {
      maxConcurrentDownloads: parseInt(settingMaxConcurrent.value, 10) || 3,
      autoCategorize: settingAutoCategorize.checked,
      categoryFolders: settingCategoryFolders.checked,
      conflictAction: settingConflictAction.value,
      maxRetries: parseInt(settingMaxRetries.value, 10) || 3
    };

    chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', settings: newSettings }, (res) => {
      if (res && res.success) {
        settings = res.settings;
        alert('Settings saved successfully!');
      }
    });
  }

  function handleDownloadInput() {
    const url = (inputUrl.value || '').trim();
    if (!url) {
      alert('Please enter a valid download URL');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      alert('URL must start with http:// or https://');
      return;
    }

    chrome.runtime.sendMessage({ action: 'CREATE_DOWNLOAD', url }, (res) => {
      if (chrome.runtime.lastError) {
        alert('Failed to start download: ' + chrome.runtime.lastError.message);
        return;
      }
      if (res && res.success) {
        inputUrl.value = '';
        if (res.duplicate) {
          alert('This download is already in progress!');
        }
        loadState();
      } else {
        const errMsg = (res && res.error) || 'Failed to initialize download';
        alert('Failed to start download: ' + errMsg);
      }
    });
  }

  function handlePasteClipboard() {
    navigator.clipboard.readText().then((text) => {
      const trimmed = (text || '').trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        inputUrl.value = trimmed;
        handleDownloadInput();
      } else {
        inputUrl.value = trimmed;
        alert('Clipboard content does not appear to be an HTTP/HTTPS URL.');
      }
    }).catch(() => {
      alert('Unable to read clipboard. Please paste manually.');
    });
  }

  function handleClearCompleted() {
    chrome.runtime.sendMessage({ action: 'CLEAR_COMPLETED' }, () => {
      loadState();
    });
  }

  function handleClearAll() {
    if (confirm('Clear all downloads from history? Active downloads will be cancelled.')) {
      chrome.runtime.sendMessage({ action: 'CLEAR_ALL' }, () => {
        loadState();
      });
    }
  }

  function renderDownloads() {
    if (currentTab === 'sniffer' || currentTab === 'settings') return;

    const searchTerm = (inputSearch.value || '').toLowerCase().trim();
    const categoryFilter = selectCategory.value;

    let filtered = downloadsList;

    // Filter by tab
    if (currentTab === 'active') {
      filtered = filtered.filter((d) => ['QUEUED', 'STARTING', 'DOWNLOADING', 'PAUSED', 'PAUSING', 'RESUMING', 'RETRYING'].includes(d.status));
    } else if (currentTab === 'completed') {
      filtered = filtered.filter((d) => d.status === 'COMPLETED');
    }

    // Filter by category
    if (categoryFilter !== 'ALL') {
      filtered = filtered.filter((d) => d.category === categoryFilter);
    }

    // Filter by search
    if (searchTerm) {
      filtered = filtered.filter((d) =>
        (d.filename && d.filename.toLowerCase().includes(searchTerm)) ||
        (d.url && d.url.toLowerCase().includes(searchTerm))
      );
    }

    if (filtered.length === 0) {
      downloadsContainer.innerHTML = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';

      const emptyIcon = document.createElement('div');
      emptyIcon.className = 'empty-icon';
      emptyIcon.textContent = '📁';

      const p1 = document.createElement('p');
      p1.textContent = 'No downloads matching your filter.';

      const p2 = document.createElement('p');
      p2.style.fontSize = '11px';
      p2.style.marginTop = '4px';
      p2.textContent = 'Add a link above or right-click any link on a webpage.';

      emptyDiv.appendChild(emptyIcon);
      emptyDiv.appendChild(p1);
      emptyDiv.appendChild(p2);
      downloadsContainer.appendChild(emptyDiv);
      return;
    }

    // Render download cards
    downloadsContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    filtered.forEach((d) => {
      const card = createDownloadCard(d);
      fragment.appendChild(card);
    });

    downloadsContainer.appendChild(fragment);
  }

  function createDownloadCard(d) {
    const card = document.createElement('div');
    card.className = 'download-card';
    card.dataset.id = d.id;

    // Card Top: Filename and Badges
    const top = document.createElement('div');
    top.className = 'card-top';

    const name = document.createElement('div');
    name.className = 'card-filename';
    name.textContent = d.filename || 'download';
    name.title = d.filename || 'download';

    const badges = document.createElement('div');
    badges.className = 'card-badges';

    const catBadge = document.createElement('span');
    catBadge.className = 'badge badge-category';
    catBadge.textContent = d.category || 'Other';

    const statusBadge = document.createElement('span');
    statusBadge.className = `badge badge-${d.status}`;
    statusBadge.textContent = d.status;

    badges.appendChild(catBadge);
    badges.appendChild(statusBadge);

    top.appendChild(name);
    top.appendChild(badges);
    card.appendChild(top);

    // Progress Bar (if active or completed)
    const barWrap = document.createElement('div');
    barWrap.className = 'progress-bar-wrap';

    const barFill = document.createElement('div');
    barFill.className = 'progress-bar-fill';
    if (d.status === 'COMPLETED') barFill.classList.add('complete');
    if (d.status === 'FAILED') barFill.classList.add('error');

    const percent = Math.min(100, Math.max(0, d.percent || 0));
    barFill.style.width = (d.status === 'COMPLETED' ? 100 : percent) + '%';

    barWrap.appendChild(barFill);
    card.appendChild(barWrap);

    // Meta Info: Size, Speed, ETA
    const meta = document.createElement('div');
    meta.className = 'card-meta';

    const sizeSpan = document.createElement('span');
    const downloadedStr = SpeedTracker ? SpeedTracker.formatBytes(d.downloadedBytes || 0) : `${d.downloadedBytes || 0} B`;
    const totalStr = d.totalBytes > 0
      ? (SpeedTracker ? SpeedTracker.formatBytes(d.totalBytes) : `${d.totalBytes} B`)
      : 'Unknown size';

    sizeSpan.textContent = d.totalBytes > 0
      ? `${percent}% • ${downloadedStr} / ${totalStr}`
      : `${downloadedStr} (Unknown size)`;

    const speedEtaSpan = document.createElement('span');
    if (d.status === 'DOWNLOADING') {
      const speedStr = d.speedFormatted || (SpeedTracker ? SpeedTracker.formatSpeed(d.speed || 0) : '');
      const etaStr = SpeedTracker && d.eta ? ` • ${SpeedTracker.formatEta(d.eta)}` : '';
      speedEtaSpan.textContent = `${speedStr}${etaStr}`;
    } else if (d.status === 'PAUSED') {
      speedEtaSpan.textContent = 'Paused';
    } else if (d.status === 'COMPLETED') {
      speedEtaSpan.textContent = '✓ Complete';
      speedEtaSpan.style.color = 'var(--success)';
    } else if (d.status === 'QUEUED') {
      speedEtaSpan.textContent = 'Queued in line...';
    } else if (d.status === 'RETRYING') {
      speedEtaSpan.textContent = 'Retrying soon...';
    }

    meta.appendChild(sizeSpan);
    meta.appendChild(speedEtaSpan);
    card.appendChild(meta);

    // Error banner if any
    if (d.error && (d.status === 'FAILED' || d.status === 'RETRYING')) {
      const errBox = document.createElement('div');
      errBox.className = 'card-error';
      errBox.textContent = `Error: ${d.error}`;
      card.appendChild(errBox);
    }

    // Controls
    const controls = document.createElement('div');
    controls.className = 'card-controls';

    if (d.status === 'DOWNLOADING' || d.status === 'STARTING') {
      controls.appendChild(createButton('⏸ Pause', 'pause', d.id));
      controls.appendChild(createButton('✕ Cancel', 'cancel', d.id, 'danger'));
    } else if (d.status === 'PAUSED') {
      controls.appendChild(createButton('▶ Resume', 'resume', d.id, 'success'));
      controls.appendChild(createButton('✕ Cancel', 'cancel', d.id, 'danger'));
    } else if (d.status === 'QUEUED') {
      controls.appendChild(createButton('✕ Cancel', 'cancel', d.id, 'danger'));
    } else if (d.status === 'FAILED' || d.status === 'CANCELLED') {
      controls.appendChild(createButton('🔄 Retry', 'retry', d.id, 'success'));
      controls.appendChild(createButton('🗑 Remove', 'delete', d.id));
    } else if (d.status === 'COMPLETED') {
      controls.appendChild(createButton('📂 Folder', 'folder', d.id));
      controls.appendChild(createButton('▶ Open', 'open', d.id));
      controls.appendChild(createButton('🗑 Remove', 'delete', d.id));
    }

    card.appendChild(controls);
    return card;
  }

  function createButton(text, action, id, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn-ctrl ${extraClass}`.trim();
    btn.textContent = text;
    btn.dataset.action = action;
    btn.dataset.id = id;
    return btn;
  }

  function handleItemAction(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'pause') {
      chrome.runtime.sendMessage({ action: 'PAUSE_DOWNLOAD', id }, () => loadState());
    } else if (action === 'resume') {
      chrome.runtime.sendMessage({ action: 'RESUME_DOWNLOAD', id }, () => loadState());
    } else if (action === 'cancel') {
      chrome.runtime.sendMessage({ action: 'CANCEL_DOWNLOAD', id }, () => loadState());
    } else if (action === 'retry') {
      chrome.runtime.sendMessage({ action: 'RETRY_DOWNLOAD', id }, () => loadState());
    } else if (action === 'delete') {
      chrome.runtime.sendMessage({ action: 'DELETE_DOWNLOAD', id }, () => loadState());
    } else if (action === 'folder') {
      chrome.runtime.sendMessage({ action: 'SHOW_IN_FOLDER', id });
    } else if (action === 'open') {
      chrome.runtime.sendMessage({ action: 'OPEN_FILE', id });
    }
  }

  // Media Sniffer Operations
  function scanCurrentPageMedia() {
    snifferContainer.innerHTML = '<div class="empty-state"><p>Scanning page for media & resources...</p></div>';

    chrome.runtime.sendMessage({ action: 'DETECT_PAGE_RESOURCES' }, (res) => {
      detectedMedia = (res && res.resources) || [];
      renderSnifferResults();
    });
  }

  function renderSnifferResults() {
    snifferContainer.innerHTML = '';

    if (detectedMedia.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `
        <div class="empty-icon">🔍</div>
        <p>No downloadable media found on this page.</p>
        <p style="font-size: 11px; margin-top: 4px;">Try playing the video/audio or reloading the page, then scan again.</p>
      `;
      snifferContainer.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    detectedMedia.forEach((item, idx) => {
      const card = document.createElement('div');
      card.className = 'media-card';

      const info = document.createElement('div');
      info.className = 'media-info';

      const title = document.createElement('div');
      title.className = 'media-title';
      title.textContent = (item.isStream ? '📡 [STREAM] ' : '🎬 ') + (item.title || item.filename);

      const urlText = document.createElement('div');
      urlText.className = 'media-url';
      urlText.textContent = item.url;

      info.appendChild(title);
      info.appendChild(urlText);

      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'btn-ctrl success';
      dlBtn.textContent = '📥 Download';
      dlBtn.dataset.mediaIndex = idx;

      card.appendChild(info);
      card.appendChild(dlBtn);
      fragment.appendChild(card);
    });

    snifferContainer.appendChild(fragment);
  }

  function handleSnifferAction(e) {
    const btn = e.target.closest('button[data-media-index]');
    if (!btn) return;

    const idx = parseInt(btn.dataset.mediaIndex, 10);
    const media = detectedMedia[idx];
    if (!media) return;

    chrome.runtime.sendMessage({
      action: 'CREATE_DOWNLOAD',
      url: media.url,
      filename: media.filename
    }, (res) => {
      if (res && res.success) {
        alert(`Started download: ${media.filename}`);
        switchTab('downloads', document.querySelector('.tab-btn[data-tab="downloads"]'));
      } else {
        alert('Failed to start download: ' + (res ? res.error : 'Unknown'));
      }
    });
  }
})();
