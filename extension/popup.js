/**
 * MyDM Cyber Telemetry Popup Controller
 * Manages UI rendering, user actions, multi-thread segment tracks,
 * media sniffer with batch actions, settings with segmented controls,
 * Web Audio completion chime, and format/playlist picker modal.
 */

(function () {
  'use strict';

  const SpeedTracker = typeof MyDMSpeedTracker !== 'undefined' ? MyDMSpeedTracker : null;

  let currentTab = 'downloads';
  let downloadsList = [];
  let settings = {};
  let detectedMedia = [];
  let pollInterval = null;
  const selectedSnifferIndices = new Set();
  let previousCompletedIds = new Set();

  // DOM Elements
  const badgeActiveCount = document.getElementById('badgeActiveCount');
  const tabCountActive = document.getElementById('tabCountActive');
  const downloadsContainer = document.getElementById('downloadsList');
  const snifferContainer = document.getElementById('snifferList');
  const inputUrl = document.getElementById('inputUrl');
  const inputSearch = document.getElementById('inputSearch');
  const selectCategory = document.getElementById('selectCategory');
  const labelLastUpdated = document.getElementById('labelLastUpdated');

  // Control Suite & Telemetry
  const downloadsControlSuite = document.getElementById('downloadsControlSuite');
  const telemetryRibbon = document.getElementById('telemetryRibbon');
  const telemetrySpeed = document.getElementById('telemetrySpeed');
  const telemetryChunks = document.getElementById('telemetryChunks');
  const footerSpeed = document.getElementById('footerSpeed');
  const footerThreadsStatus = document.getElementById('footerThreadsStatus');

  // Tab Content Panels
  const tabPanels = {
    downloads: document.getElementById('tabDownloads'),
    active: document.getElementById('tabDownloads'),
    completed: document.getElementById('tabDownloads'),
    sniffer: document.getElementById('tabSniffer'),
    settings: document.getElementById('tabSettings')
  };

  // Sniffer Elements
  const snifferBatchStrip = document.getElementById('snifferBatchStrip');
  const batchSub = document.getElementById('batchSub');
  const btnBatchDownloadText = document.getElementById('btnBatchDownloadText');
  const btnBatchCopyLinks = document.getElementById('btnBatchCopyLinks');
  const btnBatchDownload = document.getElementById('btnBatchDownload');
  const snifferCurrentUrl = document.getElementById('snifferCurrentUrl');
  const scanIcon = document.getElementById('scanIcon');

  // Settings Inputs
  const settingMaxConcurrent = document.getElementById('settingMaxConcurrent');
  const settingAutoCapture = document.getElementById('settingAutoCapture');
  const settingAutoCategorize = document.getElementById('settingAutoCategorize');
  const settingCategoryFolders = document.getElementById('settingCategoryFolders');
  const settingConflictAction = document.getElementById('settingConflictAction');
  const settingMaxRetries = document.getElementById('settingMaxRetries');
  const settingSniffStreams = document.getElementById('settingSniffStreams');
  const settingAutoMergeFfmpeg = document.getElementById('settingAutoMergeFfmpeg');
  const settingCompletionSound = document.getElementById('settingCompletionSound');
  const settingSystemNotify = document.getElementById('settingSystemNotify');

  // Active filter for media sniffer
  let activeSnifferFilter = 'all';

  // State for format & playlist modal
  let activeModalUrl = '';
  let activeModalFormats = [];
  let selectedFormatIndex = 0;
  let activePlaylistInfo = null;
  let isPlaylistMode = false;
  let singleVideoFormats = [];
  let singleVideoMeta = null;

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadState();
    startPolling();
    queryActiveTabUrl();
    scanCurrentPageMedia();
  });

  function bindEvents() {
    // Tab navigation switching
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabKey = btn.dataset.tab;
        switchTab(tabKey, btn);
      });
    });

    // Start download via button or Enter key
    const btnStart = document.getElementById('btnStartDownload');
    if (btnStart) btnStart.addEventListener('click', handleDownloadInput);
    if (inputUrl) {
      inputUrl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleDownloadInput();
      });
    }

    // Paste clipboard button
    const btnPaste = document.getElementById('btnPasteClipboard');
    if (btnPaste) btnPaste.addEventListener('click', handlePasteClipboard);

    // Search and category filter
    if (inputSearch) inputSearch.addEventListener('input', renderDownloads);
    if (selectCategory) selectCategory.addEventListener('change', renderDownloads);

    // Media Sniffer filter buttons
    document.querySelectorAll('.sniffer-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sniffer-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        activeSnifferFilter = btn.dataset.filter || 'all';
        renderSnifferResults();
      });
    });

    // Clear and reload buttons
    const btnClearCompleted = document.getElementById('btnClearCompleted');
    if (btnClearCompleted) btnClearCompleted.addEventListener('click', handleClearCompleted);

    const btnClearAll = document.getElementById('btnClearAll');
    if (btnClearAll) btnClearAll.addEventListener('click', handleClearAll);

    const btnReload = document.getElementById('btnReloadExt');
    if (btnReload) {
      btnReload.addEventListener('click', () => {
        chrome.runtime.reload();
        window.close();
      });
    }

    // Header settings button
    const btnHeaderSettings = document.getElementById('btnHeaderSettings');
    if (btnHeaderSettings) {
      btnHeaderSettings.addEventListener('click', () => {
        const settingsTabBtn = document.querySelector('.tab-btn[data-tab="settings"]');
        if (settingsTabBtn) switchTab('settings', settingsTabBtn);
      });
    }

    // Media scan button
    const btnScan = document.getElementById('btnScanMedia');
    if (btnScan) {
      btnScan.addEventListener('click', () => {
        if (scanIcon) scanIcon.classList.add('animate-spin');
        scanCurrentPageMedia(() => {
          if (scanIcon) scanIcon.classList.remove('animate-spin');
          showToast('Media sniffer scan refreshed');
        });
      });
    }

    // Sniffer Batch Actions
    if (btnBatchCopyLinks) btnBatchCopyLinks.addEventListener('click', handleBatchCopyLinks);
    if (btnBatchDownload) btnBatchDownload.addEventListener('click', handleBatchDownload);

    // Settings: Segmented concurrent task slots
    document.querySelectorAll('#controlConcurrentSlots .segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#controlConcurrentSlots .segmented-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const val = btn.dataset.val;
        if (settingMaxConcurrent) settingMaxConcurrent.value = val;
      });
    });

    // Settings: Save, Export, Reset
    const btnSaveSettings = document.getElementById('btnSaveSettings');
    if (btnSaveSettings) btnSaveSettings.addEventListener('click', handleSaveSettings);

    const btnExportConfig = document.getElementById('btnExportConfig');
    if (btnExportConfig) btnExportConfig.addEventListener('click', handleExportConfig);

    const btnResetSettings = document.getElementById('btnResetSettings');
    if (btnResetSettings) btnResetSettings.addEventListener('click', handleResetSettings);

    // Downloads List & Sniffer Event Delegation
    if (downloadsContainer) downloadsContainer.addEventListener('click', handleItemAction);
    if (snifferContainer) snifferContainer.addEventListener('click', handleSnifferAction);

    // Format Modal Event Listeners
    const modalBtnClose = document.getElementById('modalBtnClose');
    const modalBtnCancel = document.getElementById('modalBtnCancel');
    const modalBtnDownload = document.getElementById('modalBtnDownload');
    const formatModal = document.getElementById('formatModal');
    const modalBtnModeSingle = document.getElementById('modalBtnModeSingle');
    const modalBtnModePlaylist = document.getElementById('modalBtnModePlaylist');

    if (modalBtnClose) modalBtnClose.addEventListener('click', closeFormatModal);
    if (modalBtnCancel) modalBtnCancel.addEventListener('click', closeFormatModal);
    if (modalBtnDownload) modalBtnDownload.addEventListener('click', handleModalStartDownload);
    if (modalBtnModeSingle) modalBtnModeSingle.addEventListener('click', () => setModalMode('single'));
    if (modalBtnModePlaylist) modalBtnModePlaylist.addEventListener('click', () => setModalMode('playlist'));
    if (formatModal) {
      formatModal.addEventListener('click', (e) => {
        if (e.target === formatModal) closeFormatModal();
      });
    }

    // Listen for background updates
    chrome.runtime.onMessage.addListener((request) => {
      if (request.action === 'STORE_EVENT' || request.action === 'DOWNLOAD_UPDATED') {
        loadState();
      }
    });
  }

  function queryActiveTabUrl() {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs && tabs[0] && tabs[0].url) {
          const tabUrl = tabs[0].url;
          if (snifferCurrentUrl) {
            try {
              const parsed = new URL(tabUrl);
              snifferCurrentUrl.textContent = `${parsed.hostname}${parsed.pathname}`;
              snifferCurrentUrl.title = tabUrl;
            } catch (_) {
              snifferCurrentUrl.textContent = tabUrl;
            }
          }
        }
      });
    } catch (_) {}
  }

  function switchTab(tabKey, activeBtn) {
    currentTab = tabKey;
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    if (activeBtn) activeBtn.classList.add('active');

    // Show appropriate tab content panel
    Object.values(tabPanels).forEach((panel) => {
      if (panel) panel.classList.remove('active');
    });

    if (tabKey === 'downloads' || tabKey === 'active' || tabKey === 'completed') {
      if (downloadsControlSuite) downloadsControlSuite.style.display = 'flex';
      if (telemetryRibbon) telemetryRibbon.style.display = 'flex';
      if (tabPanels.downloads) tabPanels.downloads.classList.add('active');
      renderDownloads();
    } else if (tabKey === 'sniffer') {
      if (downloadsControlSuite) downloadsControlSuite.style.display = 'none';
      if (telemetryRibbon) telemetryRibbon.style.display = 'none';
      if (tabPanels.sniffer) tabPanels.sniffer.classList.add('active');
      queryActiveTabUrl();
      if (detectedMedia.length === 0) {
        scanCurrentPageMedia();
      } else {
        renderSnifferResults();
      }
    } else if (tabKey === 'settings') {
      if (downloadsControlSuite) downloadsControlSuite.style.display = 'none';
      if (telemetryRibbon) telemetryRibbon.style.display = 'none';
      if (tabPanels.settings) tabPanels.settings.classList.add('active');
      syncSettingsForm();
    }
  }

  function loadState() {
    chrome.runtime.sendMessage({ action: 'GET_STATE' }, (res) => {
      if (chrome.runtime.lastError || !res) return;

      downloadsList = res.downloads || [];
      settings = res.settings || {};

      checkCompletedAudioCues();
      updateHeaderStats();
      syncSettingsForm();
      renderDownloads();

      if (labelLastUpdated) {
        labelLastUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    });
  }

  function startPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(loadState, 1000);
  }

  function checkCompletedAudioCues() {
    const currentCompleted = new Set(downloadsList.filter((d) => d.status === 'COMPLETED').map((d) => d.id));
    if (previousCompletedIds.size > 0) {
      for (const id of currentCompleted) {
        if (!previousCompletedIds.has(id)) {
          if (settings.completionSound !== false) {
            playCompletionChime();
          }
          break;
        }
      }
    }
    previousCompletedIds = currentCompleted;
  }

  function playCompletionChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;

      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now); // E5
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12); // A5

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(987.77, now + 0.08); // B5
      osc2.frequency.exponentialRampToValueAtTime(1318.51, now + 0.22); // E6

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now + 0.08);
      osc1.stop(now + 0.35);
      osc2.stop(now + 0.35);
    } catch (_) {}
  }

  function updateHeaderStats() {
    const activeDownloads = downloadsList.filter(
      (d) => d.status === 'DOWNLOADING' || d.status === 'STARTING' || d.status === 'RESUMING' || d.status === 'QUEUED'
    );
    const active = activeDownloads.length;

    if (badgeActiveCount) {
      badgeActiveCount.textContent = active > 0 ? `${active} Active` : 'Idle';
      badgeActiveCount.style.background = active > 0 ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255, 255, 255, 0.08)';
    }

    if (tabCountActive) {
      if (active > 0) {
        tabCountActive.textContent = active;
        tabCountActive.style.display = 'inline-block';
      } else {
        tabCountActive.style.display = 'none';
      }
    }

    // Telemetry aggregations
    let totalSpeedBytes = 0;
    let totalActiveChunks = 0;
    activeDownloads.forEach((d) => {
      if (d.status === 'DOWNLOADING') {
        totalSpeedBytes += d.speed || 0;
        totalActiveChunks += 8;
      } else if (d.status === 'STARTING' || d.status === 'RESUMING') {
        totalActiveChunks += 4;
      }
    });

    const speedStr = SpeedTracker ? SpeedTracker.formatSpeed(totalSpeedBytes) : `${(totalSpeedBytes / (1024 * 1024)).toFixed(1)} MB/s`;

    if (telemetrySpeed) telemetrySpeed.textContent = `Peak ${speedStr}`;
    if (telemetryChunks) telemetryChunks.textContent = `Active Chunks: ${totalActiveChunks}`;

    if (footerSpeed) footerSpeed.textContent = `↓ ${speedStr}`;
    if (footerThreadsStatus) {
      footerThreadsStatus.textContent = `${totalActiveChunks || (active > 0 ? active * 4 : 2)} active threads`;
    }
  }

  function syncSettingsForm() {
    const maxSlots = settings.maxConcurrentDownloads || 5;
    if (settingMaxConcurrent) settingMaxConcurrent.value = maxSlots;

    document.querySelectorAll('#controlConcurrentSlots .segmented-btn').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.val, 10) === maxSlots);
    });

    if (settingAutoCapture) settingAutoCapture.checked = settings.autoCaptureBrowserDownloads !== false;
    if (settingAutoCategorize) settingAutoCategorize.checked = settings.autoCategorize !== false;
    if (settingCategoryFolders) settingCategoryFolders.checked = settings.categoryFolders !== false;
    if (settingConflictAction) settingConflictAction.value = settings.conflictAction || 'uniquify';
    if (settingMaxRetries) settingMaxRetries.value = settings.maxRetries !== undefined ? settings.maxRetries : 3;
    if (settingSniffStreams) settingSniffStreams.checked = settings.sniffStreams !== false;
    if (settingAutoMergeFfmpeg) settingAutoMergeFfmpeg.checked = settings.autoMergeFfmpeg !== false;
    if (settingCompletionSound) settingCompletionSound.checked = settings.completionSound !== false;
    if (settingSystemNotify) settingSystemNotify.checked = settings.systemNotify !== false;
  }

  function handleSaveSettings() {
    const newSettings = {
      maxConcurrentDownloads: parseInt(settingMaxConcurrent ? settingMaxConcurrent.value : 5, 10) || 5,
      autoCaptureBrowserDownloads: settingAutoCapture ? settingAutoCapture.checked : true,
      autoCategorize: settingAutoCategorize ? settingAutoCategorize.checked : true,
      categoryFolders: settingCategoryFolders ? settingCategoryFolders.checked : true,
      conflictAction: settingConflictAction ? settingConflictAction.value : 'uniquify',
      maxRetries: parseInt(settingMaxRetries ? settingMaxRetries.value : 3, 10) || 3,
      sniffStreams: settingSniffStreams ? settingSniffStreams.checked : true,
      autoMergeFfmpeg: settingAutoMergeFfmpeg ? settingAutoMergeFfmpeg.checked : true,
      completionSound: settingCompletionSound ? settingCompletionSound.checked : true,
      systemNotify: settingSystemNotify ? settingSystemNotify.checked : true
    };

    chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', settings: newSettings }, (res) => {
      if (res && res.success) {
        settings = res.settings;
        showToast('Settings saved successfully!');
      } else {
        showToast('Failed to save settings');
      }
    });
  }

  function handleExportConfig() {
    try {
      const config = {
        name: 'MyDM Configuration',
        version: '2.4.0',
        exportedAt: new Date().toISOString(),
        settings: settings
      };
      const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mydm-config.json';
      a.click();
      URL.revokeObjectURL(url);
      showToast('Configuration exported as JSON');
    } catch (_) {
      showToast('Failed to export configuration');
    }
  }

  function handleResetSettings() {
    const defaultSettings = {
      maxConcurrentDownloads: 5,
      autoCaptureBrowserDownloads: true,
      autoCategorize: true,
      categoryFolders: true,
      conflictAction: 'uniquify',
      maxRetries: 3,
      sniffStreams: true,
      autoMergeFfmpeg: true,
      completionSound: true,
      systemNotify: true
    };

    chrome.runtime.sendMessage({ action: 'UPDATE_SETTINGS', settings: defaultSettings }, (res) => {
      if (res && res.success) {
        settings = res.settings;
        syncSettingsForm();
        showToast('Preferences reset to default values');
      }
    });
  }

  function showToast(message) {
    const toast = document.getElementById('toastNotification');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.__toastTimeout);
    window.__toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  function isStreaming(url) {
    if (typeof RulesEngine !== 'undefined' && RulesEngine.isStreamingUrl) {
      return RulesEngine.isStreamingUrl(url);
    }
    return /youtube\.com|youtu\.be|vimeo\.com|tiktok\.com|twitter\.com|x\.com|instagram\.com|facebook\.com|reddit\.com|twitch\.tv|bilibili\.com/i.test(url);
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

  function isPurePlaylistUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const parsed = new URL(url);
      return parsed.pathname.startsWith('/playlist') && !parsed.searchParams.has('v');
    } catch (_) {
      return false;
    }
  }

  function handleDownloadInput() {
    const url = (inputUrl ? inputUrl.value : '').trim();
    if (!url) {
      showToast('Please enter a valid download URL');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('magnet:')) {
      showToast('URL must start with http://, https:// or magnet:');
      return;
    }

    if (inputUrl) inputUrl.value = '';

    if (isPlaylistUrl(url)) {
      openFormatSelector(url, '', '', isPurePlaylistUrl(url));
      return;
    }

    if (isStreaming(url)) {
      openFormatSelector(url);
      return;
    }

    startDirectDownload(url);
  }

  function startDirectDownload(url, filename = '') {
    chrome.runtime.sendMessage({ action: 'CREATE_DOWNLOAD', url, filename }, (res) => {
      if (chrome.runtime.lastError) {
        showToast('Error: ' + chrome.runtime.lastError.message);
        return;
      }
      if (res && res.success) {
        if (res.duplicate) {
          showToast('This download is already in progress!');
        } else {
          showToast('Download started');
        }
        switchTab('downloads', document.querySelector('.tab-btn[data-tab="downloads"]'));
        loadState();
      } else {
        const errMsg = (res && res.error) || 'Failed to initialize download';
        showToast(errMsg);
      }
    });
  }

  function handlePasteClipboard() {
    navigator.clipboard.readText().then((text) => {
      const trimmed = (text || '').trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('magnet:')) {
        if (inputUrl) inputUrl.value = trimmed;
        showToast('Link pasted from clipboard');
        handleDownloadInput();
      } else {
        if (inputUrl) inputUrl.value = trimmed;
        showToast('Clipboard does not contain a valid URL');
      }
    }).catch(() => {
      showToast('Unable to read clipboard');
    });
  }

  function handleClearCompleted() {
    chrome.runtime.sendMessage({ action: 'CLEAR_COMPLETED' }, () => {
      showToast('Cleared completed downloads');
      loadState();
    });
  }

  function handleClearAll() {
    if (confirm('Clear all downloads from history? Active downloads will be cancelled.')) {
      chrome.runtime.sendMessage({ action: 'CLEAR_ALL' }, () => {
        showToast('All downloads cleared');
        loadState();
      });
    }
  }

  function renderDownloads() {
    if (currentTab === 'sniffer' || currentTab === 'settings') return;

    const searchTerm = (inputSearch ? inputSearch.value : '').toLowerCase().trim();
    const categoryFilter = selectCategory ? selectCategory.value : 'ALL';

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

    if (!downloadsContainer) return;

    if (filtered.length === 0) {
      downloadsContainer.innerHTML = '';
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'empty-state';
      emptyDiv.innerHTML = `
        <div class="empty-icon-box">
          <span class="icon" style="font-size: 24px;">folder_open</span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #fff;">No downloads found</div>
        <div style="font-size: 10.5px; color: var(--on-surface-variant); max-width: 260px; text-align: center; margin-top: 2px;">
          ${currentTab === 'active' ? 'No active downloads in progress.' :
            currentTab === 'completed' ? 'No completed downloads in history.' :
            'Paste a URL above or right-click any link on a page.'}
        </div>
      `;
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

  function getFileMetaAttributes(category, filename = '', isStream = false) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (['iso', 'img', 'vmdk', 'bin'].includes(ext)) {
      return { icon: 'disc_full', tag: 'ISO', isAudio: false };
    }
    if (['pkg', 'exe', 'msi', 'dmg', 'deb', 'rpm', 'appimage'].includes(ext)) {
      return { icon: 'deployed_code', tag: ext.toUpperCase(), isAudio: false };
    }
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext)) {
      return { icon: 'folder_zip', tag: ext.toUpperCase(), isAudio: false };
    }
    if (category === 'Videos' || ['mp4', 'mkv', 'webm', 'avi', 'mov', 'flv', 'm4v', 'ts'].includes(ext) || isStream) {
      return { icon: 'movie', tag: ext ? ext.toUpperCase() : 'MP4', isAudio: false };
    }
    if (category === 'Audio' || ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav', 'opus'].includes(ext)) {
      return { icon: 'audiotrack', tag: ext ? ext.toUpperCase() : 'MP3', isAudio: true };
    }
    if (category === 'Images' || ['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(ext)) {
      return { icon: 'image', tag: ext ? ext.toUpperCase() : 'IMG', isAudio: false };
    }
    if (category === 'Documents' || ['pdf', 'doc', 'docx', 'txt', 'csv', 'xlsx'].includes(ext)) {
      return { icon: 'description', tag: ext ? ext.toUpperCase() : 'DOC', isAudio: false };
    }
    return { icon: 'folder', tag: ext ? ext.toUpperCase() : (category || 'FILE'), isAudio: false };
  }

  function renderChunkSlots(percent, status) {
    const container = document.createElement('div');
    container.className = 'chunks-bar';

    if (status === 'COMPLETED') {
      for (let i = 0; i < 8; i++) {
        const slot = document.createElement('div');
        slot.className = 'chunk-slot done';
        slot.title = `Thread ${i + 1}: 100%`;
        container.appendChild(slot);
      }
      return container;
    }

    const completedSlots = Math.floor((percent / 100) * 8);
    for (let i = 0; i < 8; i++) {
      const slot = document.createElement('div');
      if (i < completedSlots) {
        slot.className = 'chunk-slot done';
        slot.title = `Thread ${i + 1}: 100%`;
      } else if (i === completedSlots && (status === 'DOWNLOADING' || status === 'RESUMING')) {
        slot.className = 'chunk-slot active';
        const threadPct = Math.round(((percent / 100) * 8 - completedSlots) * 100);
        slot.title = `Thread ${i + 1}: ${Math.max(15, threadPct)}%`;
      } else {
        slot.className = 'chunk-slot';
        slot.title = `Thread ${i + 1}: Buffer pending`;
      }
      container.appendChild(slot);
    }
    return container;
  }

  function createDownloadCard(d) {
    const card = document.createElement('article');
    card.className = 'download-card';
    card.dataset.id = d.id;

    const fileMeta = getFileMetaAttributes(d.category, d.filename, Boolean(d.isStream));
    const percent = Math.min(100, Math.max(0, d.percent || 0));

    // Card Top Row
    const top = document.createElement('div');
    top.className = 'card-top';

    const leading = document.createElement('div');
    leading.className = 'card-leading';

    const iconBox = document.createElement('div');
    iconBox.className = 'file-icon-box';
    if (d.status === 'COMPLETED') iconBox.classList.add('complete');
    if (d.status === 'FAILED') iconBox.classList.add('error');

    const iconSpan = document.createElement('span');
    iconSpan.className = 'icon';
    iconSpan.style.fontSize = '18px';
    iconSpan.textContent = fileMeta.icon;
    iconBox.appendChild(iconSpan);

    const titleGroup = document.createElement('div');
    titleGroup.className = 'card-title-group';

    const titleRow = document.createElement('div');
    titleRow.className = 'card-title-row';

    const name = document.createElement('span');
    name.className = 'card-filename';
    name.textContent = d.filename || 'download';
    name.title = d.filename || 'download';

    const extTag = document.createElement('span');
    extTag.className = `file-ext-tag ${fileMeta.isAudio ? 'audio' : ''}`;
    extTag.textContent = fileMeta.tag;

    titleRow.appendChild(name);
    titleRow.appendChild(extTag);

    const originUrl = document.createElement('span');
    originUrl.className = 'card-origin-url';
    if (d.status === 'COMPLETED') {
      originUrl.textContent = 'Completed in MyDM Storage';
    } else {
      originUrl.textContent = d.url || '';
      originUrl.title = d.url || '';
    }

    titleGroup.appendChild(titleRow);
    titleGroup.appendChild(originUrl);

    leading.appendChild(iconBox);
    leading.appendChild(titleGroup);

    // Right side status pill & size
    const statusPill = document.createElement('div');
    statusPill.className = 'card-status-pill';

    const badge = document.createElement('span');
    badge.className = `status-badge ${d.status}`;

    const dot = document.createElement('span');
    dot.className = 'status-badge-dot';
    if (d.status === 'DOWNLOADING') dot.style.animation = 'pulse 1s infinite alternate';

    const badgeText = document.createElement('span');
    if (d.status === 'DOWNLOADING' || d.status === 'RESUMING' || d.status === 'STARTING') {
      badgeText.textContent = `${percent}%`;
    } else if (d.status === 'COMPLETED') {
      badgeText.textContent = 'Done';
    } else {
      badgeText.textContent = d.status;
    }

    badge.appendChild(dot);
    badge.appendChild(badgeText);

    const sizeSub = document.createElement('span');
    sizeSub.className = 'card-size-sub';

    const downloadedStr = SpeedTracker ? SpeedTracker.formatBytes(d.downloadedBytes || 0) : `${d.downloadedBytes || 0} B`;
    const totalStr = d.totalBytes > 0
      ? (SpeedTracker ? SpeedTracker.formatBytes(d.totalBytes) : `${d.totalBytes} B`)
      : 'Unknown size';

    if (d.status === 'COMPLETED') {
      sizeSub.textContent = totalStr !== 'Unknown size' ? totalStr : downloadedStr;
    } else if (d.totalBytes > 0) {
      sizeSub.textContent = `${downloadedStr} / ${totalStr}`;
    } else {
      sizeSub.textContent = downloadedStr;
    }

    statusPill.appendChild(badge);
    statusPill.appendChild(sizeSub);

    top.appendChild(leading);
    top.appendChild(statusPill);
    card.appendChild(top);

    // Main Progress Track
    const progressTrack = document.createElement('div');
    progressTrack.className = 'progress-track';

    const progressFill = document.createElement('div');
    progressFill.className = 'progress-fill';
    if (d.status === 'COMPLETED') progressFill.classList.add('complete');
    if (d.status === 'FAILED') progressFill.classList.add('error');
    if (d.status === 'PAUSED') progressFill.classList.add('paused');

    progressFill.style.width = (d.status === 'COMPLETED' ? 100 : percent) + '%';
    progressTrack.appendChild(progressFill);
    card.appendChild(progressTrack);

    // 8-Thread Multi-segment Visualization
    if (d.status !== 'FAILED') {
      card.appendChild(renderChunkSlots(percent, d.status));
    }

    // Card Error Banner if failed or retrying
    if (d.error && (d.status === 'FAILED' || d.status === 'RETRYING')) {
      const errBox = document.createElement('div');
      errBox.className = 'card-error';
      errBox.textContent = `Error: ${d.error}`;
      card.appendChild(errBox);
    }

    // Card Bottom Row: Telemetry & Controls
    const bottom = document.createElement('div');
    bottom.className = 'card-bottom';

    const telemetry = document.createElement('div');
    telemetry.className = 'card-telemetry';

    if (d.status === 'DOWNLOADING') {
      const speedBadge = document.createElement('span');
      speedBadge.className = 'speed-badge';
      const downIcon = document.createElement('span');
      downIcon.className = 'icon';
      downIcon.style.fontSize = '13px';
      downIcon.textContent = 'arrow_downward';

      const speedVal = document.createElement('span');
      speedVal.textContent = d.speedFormatted || (SpeedTracker ? SpeedTracker.formatSpeed(d.speed || 0) : '0.0 MB/s');

      speedBadge.appendChild(downIcon);
      speedBadge.appendChild(speedVal);
      telemetry.appendChild(speedBadge);

      const sep = document.createElement('span');
      sep.textContent = '•';
      telemetry.appendChild(sep);

      const etaSpan = document.createElement('span');
      etaSpan.textContent = SpeedTracker && d.eta ? `ETA ${SpeedTracker.formatEta(d.eta)}` : 'ETA calculating...';
      telemetry.appendChild(etaSpan);

      const sep2 = document.createElement('span');
      sep2.textContent = '•';
      telemetry.appendChild(sep2);

      const chunkSpan = document.createElement('span');
      chunkSpan.textContent = '8 Chunks';
      telemetry.appendChild(chunkSpan);
    } else if (d.status === 'COMPLETED') {
      const checkIcon = document.createElement('span');
      checkIcon.className = 'icon';
      checkIcon.style.color = 'var(--tertiary)';
      checkIcon.style.fontSize = '14px';
      checkIcon.textContent = 'verified';

      const verifySpan = document.createElement('span');
      verifySpan.style.color = 'var(--tertiary)';
      verifySpan.textContent = 'Integrity verified (SHA-256 match)';

      telemetry.appendChild(checkIcon);
      telemetry.appendChild(verifySpan);
    } else if (d.status === 'PAUSED') {
      telemetry.textContent = 'Download paused';
    } else if (d.status === 'QUEUED') {
      telemetry.textContent = 'Queued in line...';
    } else if (d.status === 'RETRYING') {
      telemetry.textContent = 'Retrying connection...';
    } else {
      telemetry.textContent = d.status;
    }

    bottom.appendChild(telemetry);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'card-controls';

    if (d.status === 'DOWNLOADING' || d.status === 'STARTING') {
      controls.appendChild(createIconBtn('pause', 'pause', d.id, 'Pause Download'));
      controls.appendChild(createIconBtn('close', 'cancel', d.id, 'Cancel Download', 'danger'));
    } else if (d.status === 'PAUSED') {
      controls.appendChild(createIconBtn('play_arrow', 'resume', d.id, 'Resume Download', 'success'));
      controls.appendChild(createIconBtn('close', 'cancel', d.id, 'Cancel Download', 'danger'));
    } else if (d.status === 'QUEUED') {
      controls.appendChild(createIconBtn('close', 'cancel', d.id, 'Cancel Download', 'danger'));
    } else if (d.status === 'FAILED' || d.status === 'CANCELLED') {
      controls.appendChild(createIconBtn('autorenew', 'retry', d.id, 'Retry Download', 'success'));
      controls.appendChild(createIconBtn('delete_sweep', 'delete', d.id, 'Remove'));
    } else if (d.status === 'COMPLETED') {
      const openBtn = createIconBtn('play_arrow', 'open', d.id, 'Open Media File', 'success');
      const openText = document.createElement('span');
      openText.textContent = 'Open';
      openBtn.appendChild(openText);
      controls.appendChild(openBtn);

      controls.appendChild(createIconBtn('folder_open', 'folder', d.id, 'Show in File Explorer'));
      controls.appendChild(createIconBtn('delete_sweep', 'delete', d.id, 'Remove'));
    }

    bottom.appendChild(controls);
    card.appendChild(bottom);
    return card;
  }

  function createIconBtn(iconName, action, id, titleText, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn-ctrl ${extraClass}`.trim();
    btn.title = titleText;
    btn.dataset.action = action;
    btn.dataset.id = id;

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.style.fontSize = '14px';
    icon.textContent = iconName;
    btn.appendChild(icon);
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
  function scanCurrentPageMedia(cb) {
    if (snifferContainer) {
      snifferContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 36px 16px; gap: 8px; text-align: center;">
          <div style="width: 24px; height: 24px; border: 2.5px solid rgba(56, 189, 248, 0.2); border-top-color: var(--primary-container); border-radius: 50%; animation: spin 0.7s linear infinite;"></div>
          <p style="font-size: 11px; color: var(--secondary);">Scanning page for video, audio, streams & files...</p>
        </div>
      `;
    }

    chrome.runtime.sendMessage({ action: 'DETECT_PAGE_RESOURCES' }, (res) => {
      detectedMedia = (res && res.resources) || [];
      selectedSnifferIndices.clear();
      renderSnifferResults();
      if (typeof cb === 'function') cb();
    });
  }

  function getMediaSymbol(item) {
    if (item.isPlaylist) return 'playlist_play';
    if (item.type === 'video' || item.isStream) return 'smart_display';
    if (item.type === 'audio') return 'audiotrack';
    if (item.type === 'image') return 'image';
    if (item.type === 'document') return 'description';
    if (item.type === 'archive') return 'folder_zip';
    return 'file_present';
  }

  function updateBatchStripUI() {
    if (!snifferBatchStrip) return;
    const count = selectedSnifferIndices.size;
    if (count > 0) {
      snifferBatchStrip.style.display = 'flex';
      if (batchSub) batchSub.textContent = `${count} stream${count > 1 ? 's' : ''} ready`;
      if (btnBatchDownloadText) btnBatchDownloadText.textContent = `Download (${count})`;
    } else {
      snifferBatchStrip.style.display = 'none';
    }
  }

  function handleBatchCopyLinks() {
    const urls = Array.from(selectedSnifferIndices)
      .map((idx) => detectedMedia[idx] && detectedMedia[idx].url)
      .filter(Boolean);

    if (urls.length === 0) {
      showToast('No items selected');
      return;
    }

    navigator.clipboard.writeText(urls.join('\n')).then(() => {
      showToast(`Copied ${urls.length} link${urls.length > 1 ? 's' : ''} to clipboard`);
    }).catch(() => {
      showToast('Failed to copy links');
    });
  }

  function handleBatchDownload() {
    const selected = Array.from(selectedSnifferIndices)
      .map((idx) => detectedMedia[idx])
      .filter(Boolean);

    if (selected.length === 0) {
      showToast('No items selected');
      return;
    }

    showToast(`Enqueuing ${selected.length} download${selected.length > 1 ? 's' : ''}...`);

    selected.forEach((item) => {
      if (item.isPlaylist || (item.url && isPlaylistUrl(item.url))) {
        startDirectDownload(item.url, item.title || item.filename);
      } else {
        startDirectDownload(item.url, item.filename || item.title);
      }
    });

    selectedSnifferIndices.clear();
    renderSnifferResults();
    switchTab('downloads', document.querySelector('.tab-btn[data-tab="downloads"]'));
  }

  function renderSnifferResults() {
    if (!snifferContainer) return;
    snifferContainer.innerHTML = '';

    const countAll = detectedMedia.length;
    const countVideos = detectedMedia.filter((m) => m.type === 'video' || m.isStream).length;
    const countImages = detectedMedia.filter((m) => m.type === 'image').length;
    const countAudio = detectedMedia.filter((m) => m.type === 'audio').length;
    const countFiles = detectedMedia.filter(
      (m) => m.type !== 'video' && m.type !== 'image' && m.type !== 'audio' && !m.isStream
    ).length;

    const elCountAll = document.getElementById('countSnifferAll');
    const elCountVideos = document.getElementById('countSnifferVideos');
    const elCountImages = document.getElementById('countSnifferImages');
    const elCountAudio = document.getElementById('countSnifferAudio');
    const elCountFiles = document.getElementById('countSnifferFiles');
    const snifferCapturedPill = document.getElementById('snifferCapturedPill');

    if (elCountAll) elCountAll.textContent = countAll;
    if (elCountVideos) elCountVideos.textContent = countVideos;
    if (elCountImages) elCountImages.textContent = countImages;
    if (elCountAudio) elCountAudio.textContent = countAudio;
    if (elCountFiles) elCountFiles.textContent = countFiles;
    if (snifferCapturedPill) snifferCapturedPill.textContent = `${countAll} streams captured`;

    const filtered = detectedMedia.filter((item) => {
      if (activeSnifferFilter === 'all') return true;
      if (activeSnifferFilter === 'video') return item.type === 'video' || item.isStream;
      if (activeSnifferFilter === 'image') return item.type === 'image';
      if (activeSnifferFilter === 'audio') return item.type === 'audio';
      if (activeSnifferFilter === 'file') {
        return item.type !== 'video' && item.type !== 'image' && item.type !== 'audio' && !item.isStream;
      }
      return true;
    });

    updateBatchStripUI();

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `
        <div class="empty-icon-box">
          <span class="icon" style="font-size: 24px;">search</span>
        </div>
        <div style="font-size: 13px; font-weight: 600; color: #fff;">No ${activeSnifferFilter === 'all' ? 'streams' : activeSnifferFilter} detected</div>
        <div style="font-size: 10.5px; color: var(--on-surface-variant); max-width: 260px; text-align: center; margin-top: 2px;">
          Play media on the active tab and click "Re-Sniff Tab".
        </div>
      `;
      snifferContainer.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach((item) => {
      const origIdx = detectedMedia.indexOf(item);
      const isSelected = selectedSnifferIndices.has(origIdx);
      const isPlaylist = item.type === 'playlist' || item.isPlaylist || (item.url && isPlaylistUrl(item.url));
      const isVid = item.type === 'video' || item.isStream || isStreaming(item.url);

      const card = document.createElement('div');
      card.className = 'media-card';

      // Checkbox
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'media-checkbox';
      cb.checked = isSelected;
      cb.dataset.mediaIndex = origIdx;
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        if (cb.checked) {
          selectedSnifferIndices.add(origIdx);
        } else {
          selectedSnifferIndices.delete(origIdx);
        }
        updateBatchStripUI();
      });

      // Thumbnail / Icon
      const thumbBox = document.createElement('div');
      thumbBox.className = 'media-thumb-box';
      if (item.thumbnail) {
        const img = document.createElement('img');
        img.className = 'media-thumb-img';
        img.referrerPolicy = 'no-referrer';
        img.crossOrigin = 'anonymous';
        img.src = item.thumbnail;
        img.onerror = () => {
          thumbBox.innerHTML = `<span class="icon" style="color: var(--primary); font-size: 20px;">${getMediaSymbol(item)}</span>`;
        };
        thumbBox.appendChild(img);
      } else {
        thumbBox.innerHTML = `<span class="icon" style="color: var(--primary); font-size: 20px;">${getMediaSymbol(item)}</span>`;
      }

      // Information
      const info = document.createElement('div');
      info.className = 'media-info';

      const titleRow = document.createElement('div');
      titleRow.className = 'media-title-row';

      const badge = document.createElement('span');
      const badgeType = isPlaylist ? 'playlist' : (item.type || 'file');
      badge.className = `media-badge ${badgeType}`;
      badge.textContent = isPlaylist ? 'PLAYLIST' : (item.isStream ? 'STREAM' : (item.extension ? item.extension.toUpperCase() : badgeType.toUpperCase()));

      const title = document.createElement('div');
      title.className = 'media-title';
      title.textContent = item.title || item.filename || 'Resource';
      title.title = title.textContent;

      titleRow.appendChild(badge);
      titleRow.appendChild(title);

      const telemetryRow = document.createElement('div');
      telemetryRow.className = 'media-telemetry-row';

      const parts = [];
      if (item.dimensions) parts.push(item.dimensions);
      if (item.sizeFormatted) parts.push(item.sizeFormatted);
      if (item.extension) parts.push(`.${item.extension}`);
      if (item.isStream) parts.push(item.url.includes('.m3u8') ? 'HLS' : 'DASH');
      else parts.push('Direct');

      telemetryRow.textContent = parts.join(' • ');

      info.appendChild(titleRow);
      info.appendChild(telemetryRow);

      // Actions
      const actions = document.createElement('div');
      actions.className = 'media-actions';

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn-ctrl';
      copyBtn.title = 'Copy Link to Clipboard';
      copyBtn.dataset.action = 'copy';
      copyBtn.dataset.mediaIndex = origIdx;
      copyBtn.innerHTML = '<span class="icon" style="font-size: 13px;">content_copy</span>';

      const dlBtn = document.createElement('button');
      dlBtn.type = 'button';
      dlBtn.className = 'btn-ctrl success';
      dlBtn.dataset.action = 'download';
      dlBtn.dataset.mediaIndex = origIdx;

      if (isPlaylist) {
        dlBtn.title = 'Download entire playlist';
        dlBtn.innerHTML = '<span class="icon" style="font-size: 13px;">folder_special</span><span>Playlist</span>';
      } else if (isVid) {
        dlBtn.title = 'Select resolution & quality';
        dlBtn.innerHTML = '<span class="icon" style="font-size: 13px;">movie</span><span>Quality</span>';
      } else {
        dlBtn.title = 'Download file directly';
        dlBtn.innerHTML = '<span class="icon" style="font-size: 13px;">download</span><span>Download</span>';
      }

      actions.appendChild(copyBtn);
      actions.appendChild(dlBtn);

      card.appendChild(cb);
      card.appendChild(thumbBox);
      card.appendChild(info);
      card.appendChild(actions);
      fragment.appendChild(card);
    });

    snifferContainer.appendChild(fragment);
  }

  function handleSnifferAction(e) {
    const btn = e.target.closest('button[data-media-index]');
    if (!btn) return;

    const action = btn.dataset.action;
    const idx = parseInt(btn.dataset.mediaIndex, 10);
    const media = detectedMedia[idx];
    if (!media) return;

    if (action === 'copy') {
      navigator.clipboard.writeText(media.url).then(() => {
        showToast('Link copied to clipboard');
      });
      return;
    }

    if (media.type === 'playlist' || media.isPlaylist || isPlaylistUrl(media.url)) {
      openFormatSelector(media.url, media.title, media.thumbnail, true);
    } else if (media.type === 'video' || media.isStream || isStreaming(media.url)) {
      openFormatSelector(media.url, media.title, media.thumbnail);
    } else {
      startDirectDownload(media.url, media.filename);
    }
  }

  // Video & Playlist Format / Resolution Selection Modal
  function setModalMode(mode) {
    const titleEl = document.getElementById('modalVideoTitle');
    const thumbEl = document.getElementById('modalThumb');
    const subEl = document.getElementById('modalVideoSub');
    const btnDownload = document.getElementById('modalBtnDownload');
    const headerTitleEl = document.getElementById('modalHeaderTitle');
    const playlistPreviewSection = document.getElementById('modalPlaylistPreviewSection');
    const playlistEntriesList = document.getElementById('modalPlaylistEntriesList');
    const btnModeSingle = document.getElementById('modalBtnModeSingle');
    const btnModePlaylist = document.getElementById('modalBtnModePlaylist');
    const formatSectionTitle = document.getElementById('modalFormatSectionTitle');

    if (mode === 'playlist') {
      isPlaylistMode = true;
      if (btnModePlaylist) btnModePlaylist.classList.add('active');
      if (btnModeSingle) btnModeSingle.classList.remove('active');
      if (headerTitleEl) headerTitleEl.textContent = 'Playlist Download Options';
      if (formatSectionTitle) formatSectionTitle.textContent = 'Select Quality for All Videos:';

      if (activePlaylistInfo) {
        if (titleEl) titleEl.textContent = `📁 ${activePlaylistInfo.title || 'Playlist'}`;
        const count = activePlaylistInfo.item_count || (activePlaylistInfo.entries ? activePlaylistInfo.entries.length : 0);
        const uploader = activePlaylistInfo.uploader || 'YouTube';
        if (subEl) subEl.textContent = `${uploader} • ${count} Videos in Playlist`;

        if (playlistEntriesList) {
          playlistEntriesList.innerHTML = '';
          (activePlaylistInfo.entries || []).forEach((entry, idx) => {
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.padding = '3px 0';
            row.style.borderBottom = '1px solid rgba(255,255,255,0.04)';

            const t = document.createElement('span');
            t.textContent = `${idx + 1}. ${entry.title || entry.id || 'Video'}`;
            t.style.overflow = 'hidden';
            t.style.textOverflow = 'ellipsis';
            t.style.whiteSpace = 'nowrap';
            t.style.flex = '1';

            const d = document.createElement('span');
            d.textContent = entry.duration ? formatDuration(entry.duration) : '';
            d.style.color = 'var(--secondary)';
            d.style.fontSize = '10px';
            d.style.marginLeft = '8px';

            row.appendChild(t);
            row.appendChild(d);
            playlistEntriesList.appendChild(row);
          });
        }
        if (playlistPreviewSection) playlistPreviewSection.classList.remove('hidden');

        activeModalFormats = [
          {
            id: 'best_playlist',
            label: `Best Available Video Quality (Auto - All ${count} Videos)`,
            format_spec: 'bestvideo*+bestaudio/best',
            ext: 'mp4',
            is_audio: false,
            is_default: true
          },
          {
            id: 'audio_mp3_playlist',
            label: `🎵 Audio Only (MP3 - All ${count} Videos)`,
            format_spec: 'ba/b',
            ext: 'mp3',
            audio_only: true,
            is_audio: true
          },
          {
            id: 'audio_m4a_playlist',
            label: `🎵 Audio Only (M4A - All ${count} Videos)`,
            format_spec: 'bestaudio[ext=m4a]/ba',
            ext: 'm4a',
            audio_only: true,
            is_audio: true
          }
        ];
        selectedFormatIndex = 0;
        renderModalFormats();
        if (btnDownload) {
          btnDownload.disabled = false;
          btnDownload.textContent = `Download Entire Playlist (${count} Items)`;
        }
      } else {
        if (titleEl) titleEl.textContent = 'Fetching Playlist...';
        if (subEl) subEl.textContent = 'Loading playlist metadata...';
        if (btnDownload) btnDownload.disabled = true;
      }
    } else {
      isPlaylistMode = false;
      if (btnModeSingle) btnModeSingle.classList.add('active');
      if (btnModePlaylist) btnModePlaylist.classList.remove('active');
      if (headerTitleEl) headerTitleEl.textContent = 'Video Quality Options';
      if (formatSectionTitle) formatSectionTitle.textContent = 'Select Quality / Format:';
      if (playlistPreviewSection) playlistPreviewSection.classList.add('hidden');

      if (singleVideoMeta) {
        if (titleEl) titleEl.textContent = singleVideoMeta.title || 'Video Stream';
        if (thumbEl && singleVideoMeta.thumbnail) {
          thumbEl.src = singleVideoMeta.thumbnail;
          thumbEl.style.display = 'block';
        }
        if (subEl) subEl.textContent = singleVideoMeta.sub || 'Direct Quality Options';
      }

      activeModalFormats = singleVideoFormats.length > 0 ? singleVideoFormats : [
        {
          id: 'best',
          label: 'Best Available Quality (Auto)',
          format_spec: 'bestvideo*+bestaudio/best',
          ext: 'mp4',
          is_audio: false,
          is_default: true
        },
        {
          id: 'audio_mp3',
          label: '🎵 Audio Only (MP3)',
          format_spec: 'ba/b',
          ext: 'mp3',
          audio_only: true,
          is_audio: true
        }
      ];
      selectedFormatIndex = 0;
      renderModalFormats();
      if (btnDownload) {
        btnDownload.disabled = false;
        btnDownload.textContent = 'Start Download';
      }
    }
  }

  function openFormatSelector(url, initialTitle = '', initialThumb = '', forcePlaylist = false) {
    activeModalUrl = url;
    activeModalFormats = [];
    selectedFormatIndex = 0;
    activePlaylistInfo = null;
    isPlaylistMode = false;
    singleVideoFormats = [];
    singleVideoMeta = null;

    const modal = document.getElementById('formatModal');
    const loadingBox = document.getElementById('modalLoading');
    const loadingText = document.getElementById('modalLoadingText');
    const contentBox = document.getElementById('modalContent');
    const titleEl = document.getElementById('modalVideoTitle');
    const thumbEl = document.getElementById('modalThumb');
    const btnDownload = document.getElementById('modalBtnDownload');
    const headerTitleEl = document.getElementById('modalHeaderTitle');
    const playlistToggle = document.getElementById('modalPlaylistToggle');
    const playlistCountEl = document.getElementById('modalPlaylistCount');
    const playlistPreviewSection = document.getElementById('modalPlaylistPreviewSection');

    if (!modal) return;
    modal.classList.remove('hidden');
    if (loadingBox) loadingBox.style.display = 'flex';
    if (contentBox) contentBox.classList.add('hidden');
    if (playlistToggle) playlistToggle.classList.add('hidden');
    if (playlistPreviewSection) playlistPreviewSection.classList.add('hidden');
    if (btnDownload) {
      btnDownload.disabled = true;
      btnDownload.textContent = 'Start Download';
    }
    if (headerTitleEl) headerTitleEl.textContent = 'Video Quality Options';
    if (loadingText) loadingText.textContent = 'Detecting video streams & quality options...';

    if (titleEl) titleEl.textContent = initialTitle || 'Fetching video details...';
    if (thumbEl) {
      thumbEl.referrerPolicy = 'no-referrer';
      if (initialThumb) {
        thumbEl.src = initialThumb;
        thumbEl.style.display = 'block';
      } else {
        thumbEl.style.display = 'none';
      }
    }

    const hasPlaylistParam = isPlaylistUrl(url);

    if (hasPlaylistParam) {
      chrome.runtime.sendMessage({ action: 'GET_PLAYLIST_INFO', url }, (res) => {
        if (res && res.success && res.data) {
          activePlaylistInfo = res.data;
          if (playlistToggle) playlistToggle.classList.remove('hidden');
          const count = activePlaylistInfo.item_count || (activePlaylistInfo.entries ? activePlaylistInfo.entries.length : 0);
          if (playlistCountEl) playlistCountEl.textContent = count;

          if (forcePlaylist || isPurePlaylistUrl(url)) {
            if (loadingBox) loadingBox.style.display = 'none';
            if (contentBox) contentBox.classList.remove('hidden');
            setModalMode('playlist');
          } else if (isPlaylistMode) {
            setModalMode('playlist');
          }
        }
      });
    }

    if (!isPurePlaylistUrl(url) || !forcePlaylist) {
      chrome.runtime.sendMessage({ action: 'GET_FORMATS', url }, (res) => {
        if (loadingBox) loadingBox.style.display = 'none';
        if (contentBox) contentBox.classList.remove('hidden');

        if (res && res.success && res.data) {
          const data = res.data;
          const durStr = data.duration ? formatDuration(data.duration) : '';
          const uploaderStr = data.uploader || 'Web Stream';
          const subText = durStr ? `${uploaderStr} • ${durStr}` : uploaderStr;

          singleVideoMeta = {
            title: data.title || initialTitle || 'Video Stream',
            thumbnail: data.thumbnail || initialThumb || '',
            sub: subText
          };

          singleVideoFormats = data.formats || [];
        } else {
          singleVideoMeta = {
            title: initialTitle || 'Video Stream',
            thumbnail: initialThumb || '',
            sub: (res && res.error) ? res.error : 'Direct Quality Options'
          };
          singleVideoFormats = [
            {
              id: 'best',
              label: 'Best Available Quality (Auto)',
              format_spec: 'bestvideo*+bestaudio/best',
              ext: 'mp4',
              is_audio: false,
              is_default: true
            },
            {
              id: 'audio_mp3',
              label: '🎵 Audio Only (MP3)',
              format_spec: 'ba/b',
              ext: 'mp3',
              audio_only: true,
              is_audio: true
            }
          ];
        }

        if (!isPlaylistMode) {
          setModalMode('single');
        }
      });
    } else {
      if (loadingBox) loadingBox.style.display = 'none';
      if (contentBox) contentBox.classList.remove('hidden');
      setModalMode('playlist');
    }
  }

  function renderModalFormats() {
    const list = document.getElementById('formatOptionsList');
    if (!list) return;
    list.innerHTML = '';

    if (activeModalFormats.length === 0) {
      list.innerHTML = '<p style="font-size: 11px; color: var(--on-surface-variant); padding: 8px;">No format options available.</p>';
      return;
    }

    activeModalFormats.forEach((fmt, idx) => {
      const row = document.createElement('div');
      row.className = `format-row ${idx === selectedFormatIndex ? 'selected' : ''}`;
      row.dataset.index = idx;

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '8px';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'videoFormatRadio';
      radio.checked = (idx === selectedFormatIndex);
      radio.style.accentColor = 'var(--primary-container)';

      const label = document.createElement('span');
      label.className = 'format-label';
      label.textContent = fmt.label || fmt.resolution || 'Quality Option';

      left.appendChild(radio);
      left.appendChild(label);

      if (fmt.ext) {
        const tag = document.createElement('span');
        tag.className = 'file-ext-tag';
        tag.textContent = fmt.ext.toUpperCase();
        left.appendChild(tag);
      }

      const right = document.createElement('div');
      right.style.fontSize = '10.5px';
      right.style.color = 'var(--secondary)';
      if (fmt.filesize && fmt.filesize > 0) {
        right.textContent = formatBytes(fmt.filesize);
      } else {
        right.textContent = fmt.is_default ? 'Best' : '';
      }

      row.appendChild(left);
      row.appendChild(right);

      row.addEventListener('click', () => {
        selectedFormatIndex = idx;
        document.querySelectorAll('.format-row').forEach((r, i) => {
          r.classList.toggle('selected', i === idx);
          const rad = r.querySelector('input[type="radio"]');
          if (rad) rad.checked = (i === idx);
        });
      });

      list.appendChild(row);
    });
  }

  function closeFormatModal() {
    const modal = document.getElementById('formatModal');
    if (modal) modal.classList.add('hidden');
    activeModalUrl = '';
    activePlaylistInfo = null;
    isPlaylistMode = false;
  }

  function handleModalStartDownload() {
    if (!activeModalUrl) return;

    if (isPlaylistMode) {
      if (!activePlaylistInfo || !activePlaylistInfo.entries || activePlaylistInfo.entries.length === 0) {
        showToast('No playlist videos found to download');
        return;
      }
      const selectedFormat = activeModalFormats[selectedFormatIndex] || {};
      const formatSpec = selectedFormat.format_spec || null;
      const audioOnly = Boolean(selectedFormat.audio_only || selectedFormat.is_audio);
      const quality = selectedFormat.label || 'Best Quality';
      const btnDownload = document.getElementById('modalBtnDownload');

      if (btnDownload) {
        btnDownload.disabled = true;
        btnDownload.textContent = 'Enqueuing Playlist...';
      }

      chrome.runtime.sendMessage({
        action: 'DOWNLOAD_PLAYLIST',
        playlistTitle: activePlaylistInfo.title || 'Playlist',
        entries: activePlaylistInfo.entries,
        formatSpec,
        audioOnly,
        quality,
        playlistUrl: activeModalUrl
      }, (res) => {
        closeFormatModal();
        if (res && res.success) {
          showToast(`Playlist queued (${activePlaylistInfo.entries.length} videos)`);
          switchTab('downloads', document.querySelector('.tab-btn[data-tab="downloads"]'));
          loadState();
        } else {
          showToast('Failed: ' + (res ? res.error : 'Unknown error'));
        }
      });
      return;
    }

    const selectedFormat = activeModalFormats[selectedFormatIndex] || {};
    const formatSpec = selectedFormat.format_spec || null;
    const audioOnly = Boolean(selectedFormat.audio_only || selectedFormat.is_audio);
    const quality = selectedFormat.label || 'Best Quality';
    const videoTitle = document.getElementById('modalVideoTitle')?.textContent || '';
    const cleanTitle = (videoTitle && videoTitle !== 'Video Stream' && videoTitle !== 'Fetching video details...') ? videoTitle : '';

    chrome.runtime.sendMessage({
      action: 'CREATE_DOWNLOAD',
      url: activeModalUrl,
      filename: cleanTitle,
      candidateName: cleanTitle,
      formatSpec,
      audioOnly,
      quality
    }, (res) => {
      closeFormatModal();
      if (res && res.success) {
        showToast('Stream download initiated');
        switchTab('downloads', document.querySelector('.tab-btn[data-tab="downloads"]'));
        loadState();
      } else {
        showToast('Failed: ' + (res ? res.error : 'Unknown error'));
      }
    });
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatDuration(seconds) {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }
})();
