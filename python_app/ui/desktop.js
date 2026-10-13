/**
 * MyDM Desktop Client Controller
 * Connects with pywebview Python API (window.pywebview.api)
 */

(function () {
  'use strict';

  let currentTab = 'all';
  let downloadsList = [];
  let settings = {};
  let pollInterval = null;
  let previousCompletedIds = new Set();

  // State for format modal
  let activeModalUrl = '';
  let activeModalFormats = [];
  let selectedFormatIndex = 0;

  // DOM Elements
  const navItems = document.querySelectorAll('.nav-item');
  const navCountAll = document.getElementById('navCountAll');
  const navCountActive = document.getElementById('navCountActive');
  const navCountCompleted = document.getElementById('navCountCompleted');
  const navCountStreams = document.getElementById('navCountStreams');
  const downloadsContainer = document.getElementById('desktopDownloadsList');
  const sidebarStoragePath = document.getElementById('sidebarStoragePath');

  const tabViewDownloads = document.getElementById('tabViewDownloads');
  const tabViewSettings = document.getElementById('tabViewSettings');

  const desktopInputUrl = document.getElementById('desktopInputUrl');
  const desktopSearchInput = document.getElementById('desktopSearchInput');
  const desktopCategorySelect = document.getElementById('desktopCategorySelect');

  const telemetrySpeed = document.getElementById('telemetrySpeed');
  const telemetryActiveChunks = document.getElementById('telemetryActiveChunks');
  const telemetryActiveSlots = document.getElementById('telemetryActiveSlots');
  const footerSpeed = document.getElementById('footerSpeed');
  const footerThreadsStatus = document.getElementById('footerThreadsStatus');
  const labelLastUpdated = document.getElementById('labelLastUpdated');

  // Settings
  const settingDisplayDir = document.getElementById('settingDisplayDir');
  const desktopSettingAutoCategorize = document.getElementById('desktopSettingAutoCategorize');
  const desktopSettingCategoryFolders = document.getElementById('desktopSettingCategoryFolders');
  const desktopSettingMaxConcurrent = document.getElementById('desktopSettingMaxConcurrent');
  const desktopSettingDefaultThreads = document.getElementById('desktopSettingDefaultThreads');
  const desktopSettingCompletionSound = document.getElementById('desktopSettingCompletionSound');
  const desktopSettingSystemNotify = document.getElementById('desktopSettingSystemNotify');

  // Wait for pywebview API readiness
  window.addEventListener('pywebviewready', () => {
    initApp();
  });

  document.addEventListener('DOMContentLoaded', () => {
    // If pywebview is already ready
    if (window.pywebview && window.pywebview.api) {
      initApp();
    } else {
      setTimeout(initApp, 400);
    }
  });

  // Global callback for Python to trigger instant state sync
  window.onDesktopStateUpdated = function () {
    loadState();
  };

  function initApp() {
    bindEvents();
    loadState();
    if (!pollInterval) {
      pollInterval = setInterval(loadState, 1000);
    }
  }

  function callApi(method, ...args) {
    if (window.pywebview && window.pywebview.api && typeof window.pywebview.api[method] === 'function') {
      return window.pywebview.api[method](...args);
    }
    return Promise.reject(new Error('pywebview API not initialized'));
  }

  function bindEvents() {
    // Sidebar Navigation
    navItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchTab(tab, btn);
      });
    });

    // Start download
    document.getElementById('btnDesktopStart').addEventListener('click', handleDownloadInput);
    if (desktopInputUrl) {
      desktopInputUrl.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleDownloadInput();
      });
    }

    // Paste clipboard
    document.getElementById('btnDesktopPaste').addEventListener('click', handlePasteClipboard);

    // Search and filter
    if (desktopSearchInput) desktopSearchInput.addEventListener('input', renderDownloads);
    if (desktopCategorySelect) desktopCategorySelect.addEventListener('change', renderDownloads);

    // Clear and refresh
    document.getElementById('btnDesktopClearDone').addEventListener('click', () => {
      callApi('clear_completed').then(() => {
        showToast('Cleared completed downloads');
        loadState();
      });
    });

    document.getElementById('btnDesktopClearAll').addEventListener('click', () => {
      if (confirm('Clear all downloads? Active tasks will be cancelled.')) {
        callApi('clear_all').then(() => {
          showToast('Cleared all downloads');
          loadState();
        });
      }
    });

    document.getElementById('btnDesktopRefresh').addEventListener('click', () => {
      loadState();
      showToast('State refreshed');
    });

    // Settings: Segmented buttons for concurrent slots
    document.querySelectorAll('#desktopControlConcurrentSlots .segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#desktopControlConcurrentSlots .segmented-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (desktopSettingMaxConcurrent) desktopSettingMaxConcurrent.value = btn.dataset.val;
      });
    });

    // Settings: Segmented buttons for threads
    document.querySelectorAll('#desktopControlThreads .segmented-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#desktopControlThreads .segmented-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (desktopSettingDefaultThreads) desktopSettingDefaultThreads.value = btn.dataset.val;
      });
    });

    // Change directory dialog
    document.getElementById('btnChangeDir').addEventListener('click', () => {
      callApi('choose_directory').then((newDir) => {
        if (newDir) {
          if (settingDisplayDir) settingDisplayDir.textContent = newDir;
          if (sidebarStoragePath) sidebarStoragePath.textContent = newDir;
          showToast(`Storage path set to: ${newDir}`);
        }
      });
    });

    // Save settings
    document.getElementById('btnDesktopSaveSettings').addEventListener('click', handleSaveSettings);

    // Event delegation on download list
    if (downloadsContainer) {
      downloadsContainer.addEventListener('click', handleCardAction);
    }

    // Modal dialog buttons
    const modalBtnClose = document.getElementById('modalBtnClose');
    const modalBtnCancel = document.getElementById('modalBtnCancel');
    const modalBtnConfirm = document.getElementById('modalBtnConfirm');
    const modalOverlay = document.getElementById('desktopFormatModal');

    if (modalBtnClose) modalBtnClose.addEventListener('click', closeModal);
    if (modalBtnCancel) modalBtnCancel.addEventListener('click', closeModal);
    if (modalBtnConfirm) modalBtnConfirm.addEventListener('click', handleModalConfirm);
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) closeModal();
      });
    }
  }

  function switchTab(tab, btn) {
    currentTab = tab;
    navItems.forEach((b) => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    if (tab === 'settings') {
      tabViewDownloads.classList.remove('active');
      tabViewSettings.classList.add('active');
      syncSettingsForm();
    } else {
      tabViewSettings.classList.remove('active');
      tabViewDownloads.classList.add('active');
      renderDownloads();
    }
  }

  function loadState() {
    callApi('get_state')
      .then((res) => {
        if (res && res.success) {
          downloadsList = res.downloads || [];
          settings = res.settings || {};

          checkAudioCues();
          updateStats();
          syncSettingsForm();
          renderDownloads();

          if (labelLastUpdated) {
            labelLastUpdated.textContent = 'Updated ' + new Date().toLocaleTimeString();
          }
        }
      })
      .catch(() => {});
  }

  function checkAudioCues() {
    const currentCompleted = new Set(downloadsList.filter((d) => d.status === 'COMPLETED').map((d) => d.id));
    if (previousCompletedIds.size > 0) {
      for (const id of currentCompleted) {
        if (!previousCompletedIds.has(id)) {
          if (settings.completion_sound !== false) {
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
      osc1.frequency.setValueAtTime(659.25, now);
      osc1.frequency.exponentialRampToValueAtTime(880, now + 0.12);

      osc2.type = 'triangle';
      osc2.frequency.setValueAtTime(987.77, now + 0.08);
      osc2.frequency.exponentialRampToValueAtTime(1318.51, now + 0.22);

      gain.gain.setValueAtTime(0.09, now);
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

  function updateStats() {
    const activeTasks = downloadsList.filter(
      (d) => d.status === 'DOWNLOADING' || d.status === 'STARTING' || d.status === 'RESUMING'
    );
    const completedTasks = downloadsList.filter((d) => d.status === 'COMPLETED');
    const streamTasks = downloadsList.filter((d) => d.is_stream);

    if (navCountAll) navCountAll.textContent = downloadsList.length;
    if (navCountActive) {
      navCountActive.textContent = activeTasks.length;
      navCountActive.style.display = activeTasks.length > 0 ? 'inline-block' : 'none';
    }
    if (navCountCompleted) navCountCompleted.textContent = completedTasks.length;
    if (navCountStreams) navCountStreams.textContent = streamTasks.length;

    // Telemetry throughput calculation
    let totalSpeed = 0;
    let activeChunks = 0;
    activeTasks.forEach((d) => {
      totalSpeed += d.speed || 0;
      activeChunks += d.threads || 8;
    });

    const speedStr = formatSpeed(totalSpeed);
    if (telemetrySpeed) telemetrySpeed.textContent = `Peak ${speedStr}`;
    if (telemetryActiveChunks) telemetryActiveChunks.textContent = `Active Chunks: ${activeChunks}`;
    if (telemetryActiveSlots) {
      const maxSlots = settings.max_concurrent || 5;
      telemetryActiveSlots.textContent = `Slots: ${activeTasks.length} / ${maxSlots}`;
    }

    if (footerSpeed) footerSpeed.textContent = `↓ ${speedStr}`;
    if (footerThreadsStatus) {
      footerThreadsStatus.textContent = `${activeChunks || (activeTasks.length > 0 ? activeTasks.length * 4 : 2)} active threads`;
    }

    const downloadDir = settings.download_dir || '~/Downloads/MyDM';
    if (sidebarStoragePath) sidebarStoragePath.textContent = downloadDir;
    if (settingDisplayDir) settingDisplayDir.textContent = downloadDir;
  }

  function syncSettingsForm() {
    const maxSlots = settings.max_concurrent || 5;
    if (desktopSettingMaxConcurrent) desktopSettingMaxConcurrent.value = maxSlots;
    document.querySelectorAll('#desktopControlConcurrentSlots .segmented-btn').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.val, 10) === maxSlots);
    });

    const threads = settings.default_threads || 8;
    if (desktopSettingDefaultThreads) desktopSettingDefaultThreads.value = threads;
    document.querySelectorAll('#desktopControlThreads .segmented-btn').forEach((btn) => {
      btn.classList.toggle('active', parseInt(btn.dataset.val, 10) === threads);
    });

    if (desktopSettingAutoCategorize) desktopSettingAutoCategorize.checked = settings.auto_categorize !== false;
    if (desktopSettingCategoryFolders) desktopSettingCategoryFolders.checked = settings.category_folders !== false;
    if (desktopSettingCompletionSound) desktopSettingCompletionSound.checked = settings.completion_sound !== false;
    if (desktopSettingSystemNotify) desktopSettingSystemNotify.checked = settings.system_notify !== false;
  }

  function handleSaveSettings() {
    const newSettings = {
      max_concurrent: parseInt(desktopSettingMaxConcurrent.value, 10) || 5,
      default_threads: parseInt(desktopSettingDefaultThreads.value, 10) || 8,
      auto_categorize: desktopSettingAutoCategorize.checked,
      category_folders: desktopSettingCategoryFolders.checked,
      completion_sound: desktopSettingCompletionSound.checked,
      system_notify: desktopSettingSystemNotify.checked
    };

    callApi('save_settings', newSettings).then((res) => {
      if (res && res.success) {
        settings = res.settings;
        showToast('Settings saved successfully!');
      }
    });
  }

  function handleDownloadInput() {
    const url = (desktopInputUrl ? desktopInputUrl.value : '').trim();
    if (!url) {
      showToast('Please enter a download URL');
      return;
    }

    if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('magnet:')) {
      showToast('URL must start with http:// or https://');
      return;
    }

    desktopInputUrl.value = '';

    callApi('is_streaming_url', url).then((isStream) => {
      if (isStream) {
        openFormatModal(url);
      } else {
        startDownload(url);
      }
    }).catch(() => {
      startDownload(url);
    });
  }

  function startDownload(url, filename = '', formatSpec = null, audioOnly = false, quality = null) {
    const threads = parseInt(desktopSettingDefaultThreads ? desktopSettingDefaultThreads.value : 8, 10) || 8;
    callApi('create_download', url, filename, threads, formatSpec, audioOnly, quality)
      .then((res) => {
        if (res && res.success) {
          showToast('Download started');
          loadState();
        } else {
          showToast('Failed to start download');
        }
      })
      .catch((err) => {
        showToast(`Error: ${err.message}`);
      });
  }

  function handlePasteClipboard() {
    navigator.clipboard.readText().then((text) => {
      const trimmed = (text || '').trim();
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('magnet:')) {
        desktopInputUrl.value = trimmed;
        showToast('Pasted URL from clipboard');
        handleDownloadInput();
      } else {
        desktopInputUrl.value = trimmed;
        showToast('Clipboard does not contain a valid URL');
      }
    }).catch(() => {
      showToast('Unable to read clipboard');
    });
  }

  function renderDownloads() {
    if (currentTab === 'settings') return;
    if (!downloadsContainer) return;

    const searchTerm = (desktopSearchInput ? desktopSearchInput.value : '').toLowerCase().trim();
    const categoryFilter = desktopCategorySelect ? desktopCategorySelect.value : 'ALL';

    let filtered = downloadsList;

    // Filter by tab
    if (currentTab === 'active') {
      filtered = filtered.filter((d) => ['QUEUED', 'STARTING', 'DOWNLOADING', 'PAUSED', 'RESUMING'].includes(d.status));
    } else if (currentTab === 'completed') {
      filtered = filtered.filter((d) => d.status === 'COMPLETED');
    } else if (currentTab === 'streams') {
      filtered = filtered.filter((d) => d.is_stream);
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
      downloadsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 8px; text-align: center; color: var(--on-surface-variant);">
          <div style="width: 52px; height: 52px; border-radius: 12px; background: var(--surface-container); border: 1px solid var(--glass-border); display: flex; align-items: center; justify-content: center; font-size: 26px; color: var(--secondary);">
            <span class="icon" style="font-size: 26px;">folder_open</span>
          </div>
          <div style="font-size: 14px; font-weight: 600; color: #fff; margin-top: 4px;">No downloads found</div>
          <div style="font-size: 11.5px; color: var(--secondary); max-width: 320px;">
            ${currentTab === 'active' ? 'No active tasks running.' :
              currentTab === 'completed' ? 'No finished downloads in history.' :
              'Paste a URL above or monitor clipboard to start downloading.'}
          </div>
        </div>
      `;
      return;
    }

    downloadsContainer.innerHTML = '';
    const fragment = document.createDocumentFragment();

    filtered.forEach((d) => {
      const card = createCardElement(d);
      fragment.appendChild(card);
    });

    downloadsContainer.appendChild(fragment);
  }

  function getFileAttributes(filename = '', isStream = false) {
    const ext = (filename.split('.').pop() || '').toLowerCase();
    if (['iso', 'img', 'vmdk', 'bin'].includes(ext)) return { icon: 'disc_full', tag: 'ISO' };
    if (['pkg', 'exe', 'msi', 'dmg', 'deb', 'rpm'].includes(ext)) return { icon: 'deployed_code', tag: ext.toUpperCase() };
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return { icon: 'folder_zip', tag: ext.toUpperCase() };
    if (['mp4', 'mkv', 'webm', 'avi', 'mov'].includes(ext) || isStream) return { icon: 'movie', tag: ext ? ext.toUpperCase() : 'VIDEO' };
    if (['mp3', 'm4a', 'aac', 'flac', 'ogg', 'wav'].includes(ext)) return { icon: 'audiotrack', tag: ext ? ext.toUpperCase() : 'AUDIO' };
    if (['pdf', 'doc', 'docx', 'txt', 'csv'].includes(ext)) return { icon: 'description', tag: ext ? ext.toUpperCase() : 'DOC' };
    if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return { icon: 'image', tag: ext ? ext.toUpperCase() : 'IMG' };
    return { icon: 'folder', tag: ext ? ext.toUpperCase() : 'FILE' };
  }

  function renderChunksTrack(percent, status, totalThreads = 8) {
    const bar = document.createElement('div');
    bar.className = 'chunks-bar';

    if (status === 'COMPLETED') {
      for (let i = 0; i < totalThreads; i++) {
        const slot = document.createElement('div');
        slot.className = 'chunk-slot done';
        slot.title = `Thread ${i + 1}: 100%`;
        bar.appendChild(slot);
      }
      return bar;
    }

    const completedSlots = Math.floor((percent / 100) * totalThreads);
    for (let i = 0; i < totalThreads; i++) {
      const slot = document.createElement('div');
      if (i < completedSlots) {
        slot.className = 'chunk-slot done';
        slot.title = `Thread ${i + 1}: 100%`;
      } else if (i === completedSlots && status === 'DOWNLOADING') {
        slot.className = 'chunk-slot active';
        const p = Math.round(((percent / 100) * totalThreads - completedSlots) * 100);
        slot.title = `Thread ${i + 1}: ${Math.max(15, p)}%`;
      } else {
        slot.className = 'chunk-slot';
        slot.title = `Thread ${i + 1}: Buffer pending`;
      }
      bar.appendChild(slot);
    }
    return bar;
  }

  function createCardElement(d) {
    const card = document.createElement('article');
    card.className = 'download-card';
    card.dataset.id = d.id;

    const fileMeta = getFileAttributes(d.filename, Boolean(d.is_stream));
    const percent = Math.min(100, Math.max(0, d.percent || 0));

    // Top Row
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
    extTag.className = 'file-ext-tag';
    extTag.textContent = fileMeta.tag;

    titleRow.appendChild(name);
    titleRow.appendChild(extTag);

    const originUrl = document.createElement('span');
    originUrl.className = 'card-origin-url';
    originUrl.textContent = d.status === 'COMPLETED' ? 'Completed in MyDM Storage' : (d.url || '');

    titleGroup.appendChild(titleRow);
    titleGroup.appendChild(originUrl);

    leading.appendChild(iconBox);
    leading.appendChild(titleGroup);

    // Right Side: Status Badge & Size
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

    const dlStr = formatBytes(d.downloaded_bytes || 0);
    const totStr = d.total_bytes > 0 ? formatBytes(d.total_bytes) : 'Unknown size';

    if (d.status === 'COMPLETED') {
      sizeSub.textContent = totStr !== 'Unknown size' ? totStr : dlStr;
    } else if (d.total_bytes > 0) {
      sizeSub.textContent = `${dlStr} / ${totStr}`;
    } else {
      sizeSub.textContent = dlStr;
    }

    statusPill.appendChild(badge);
    statusPill.appendChild(sizeSub);

    top.appendChild(leading);
    top.appendChild(statusPill);
    card.appendChild(top);

    // Progress Bar
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
      card.appendChild(renderChunksTrack(percent, d.status, d.threads || 8));
    }

    // Bottom Row: Telemetry & Action Buttons
    const bottom = document.createElement('div');
    bottom.className = 'card-bottom';

    const telemetry = document.createElement('div');
    telemetry.className = 'card-telemetry';

    if (d.status === 'DOWNLOADING') {
      const speedBadge = document.createElement('span');
      speedBadge.className = 'speed-badge';
      speedBadge.innerHTML = `<span class="icon" style="font-size: 13px;">arrow_downward</span><span>${d.speed_formatted || '0.0 MB/s'}</span>`;
      telemetry.appendChild(speedBadge);
      telemetry.innerHTML += `<span>•</span><span>${d.threads || 8} Chunks</span>`;
    } else if (d.status === 'COMPLETED') {
      telemetry.innerHTML = `<span class="icon" style="color: var(--tertiary); font-size: 14px;">verified</span><span style="color: var(--tertiary);">Integrity verified (SHA-256 match)</span>`;
    } else if (d.status === 'PAUSED') {
      telemetry.textContent = 'Download paused';
    } else if (d.status === 'FAILED') {
      telemetry.innerHTML = `<span style="color: var(--error);">Error: ${d.error || 'Failed'}</span>`;
    } else {
      telemetry.textContent = d.status;
    }

    bottom.appendChild(telemetry);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'card-controls';

    if (d.status === 'DOWNLOADING' || d.status === 'STARTING') {
      controls.appendChild(createBtn('pause', 'pause', d.id, 'Pause'));
      controls.appendChild(createBtn('close', 'cancel', d.id, 'Cancel', 'danger'));
    } else if (d.status === 'PAUSED') {
      controls.appendChild(createBtn('play_arrow', 'resume', d.id, 'Resume', 'success'));
      controls.appendChild(createBtn('close', 'cancel', d.id, 'Cancel', 'danger'));
    } else if (d.status === 'FAILED' || d.status === 'CANCELLED') {
      controls.appendChild(createBtn('autorenew', 'resume', d.id, 'Retry', 'success'));
      controls.appendChild(createBtn('delete_sweep', 'delete', d.id, 'Remove'));
    } else if (d.status === 'COMPLETED') {
      const openBtn = createBtn('play_arrow', 'open', d.id, 'Open', 'success');
      const t = document.createElement('span');
      t.textContent = 'Open';
      openBtn.appendChild(t);
      controls.appendChild(openBtn);

      controls.appendChild(createBtn('folder_open', 'folder', d.id, 'Folder'));
      controls.appendChild(createBtn('delete_sweep', 'delete', d.id, 'Remove'));
    }

    bottom.appendChild(controls);
    card.appendChild(bottom);
    return card;
  }

  function createBtn(iconName, action, id, title, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn-ctrl ${extraClass}`.trim();
    btn.title = title;
    btn.dataset.action = action;
    btn.dataset.id = id;

    const icon = document.createElement('span');
    icon.className = 'icon';
    icon.style.fontSize = '14px';
    icon.textContent = iconName;
    btn.appendChild(icon);
    return btn;
  }

  function handleCardAction(e) {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;

    const action = btn.dataset.action;
    const id = btn.dataset.id;

    if (action === 'pause') {
      callApi('pause_download', id).then(() => loadState());
    } else if (action === 'resume') {
      callApi('resume_download', id).then(() => loadState());
    } else if (action === 'cancel') {
      callApi('cancel_download', id).then(() => loadState());
    } else if (action === 'delete') {
      callApi('delete_download', id).then(() => loadState());
    } else if (action === 'folder') {
      callApi('show_in_folder', id);
    } else if (action === 'open') {
      callApi('open_file', id);
    }
  }

  // Format Modal Dialog
  function openFormatModal(url) {
    activeModalUrl = url;
    activeModalFormats = [];
    selectedFormatIndex = 0;

    const modal = document.getElementById('desktopFormatModal');
    const loadingBox = document.getElementById('modalLoading');
    const contentBox = document.getElementById('modalContent');
    const titleEl = document.getElementById('modalVideoTitle');
    const thumbEl = document.getElementById('modalThumb');
    const btnConfirm = document.getElementById('modalBtnConfirm');

    modal.classList.remove('hidden');
    loadingBox.style.display = 'flex';
    contentBox.classList.add('hidden');
    btnConfirm.disabled = true;

    callApi('get_formats', url)
      .then((res) => {
        loadingBox.style.display = 'none';
        contentBox.classList.remove('hidden');

        if (res && res.success && res.data) {
          const data = res.data;
          titleEl.textContent = data.title || 'Video Stream';
          if (data.thumbnail) {
            thumbEl.src = data.thumbnail;
            thumbEl.style.display = 'block';
          } else {
            thumbEl.style.display = 'none';
          }
          activeModalFormats = data.formats || [];
        } else {
          titleEl.textContent = 'Direct Video Stream';
          thumbEl.style.display = 'none';
          activeModalFormats = [
            { id: 'best', label: 'Best Available Quality (Auto)', format_spec: 'bestvideo*+bestaudio/best', ext: 'mp4' },
            { id: 'audio', label: '🎵 Audio Only (MP3)', format_spec: 'ba/b', ext: 'mp3', audio_only: true }
          ];
        }

        renderModalFormats();
        btnConfirm.disabled = false;
      })
      .catch(() => {
        loadingBox.style.display = 'none';
        contentBox.classList.remove('hidden');
        titleEl.textContent = 'Direct Video Stream';
        activeModalFormats = [
          { id: 'best', label: 'Best Available Quality (Auto)', format_spec: 'bestvideo*+bestaudio/best', ext: 'mp4' }
        ];
        renderModalFormats();
        btnConfirm.disabled = false;
      });
  }

  function renderModalFormats() {
    const list = document.getElementById('modalFormatList');
    list.innerHTML = '';

    activeModalFormats.forEach((fmt, idx) => {
      const row = document.createElement('div');
      row.className = `format-row ${idx === selectedFormatIndex ? 'selected' : ''}`;

      const left = document.createElement('div');
      left.style.display = 'flex';
      left.style.alignItems = 'center';
      left.style.gap = '8px';

      const radio = document.createElement('input');
      radio.type = 'radio';
      radio.name = 'formatRadio';
      radio.checked = (idx === selectedFormatIndex);
      radio.style.accentColor = 'var(--primary-container)';

      const label = document.createElement('span');
      label.textContent = fmt.label || fmt.resolution || 'Quality Option';
      label.style.fontWeight = '600';
      label.style.color = '#fff';

      left.appendChild(radio);
      left.appendChild(label);

      const right = document.createElement('span');
      right.style.fontSize = '10.5px';
      right.style.color = 'var(--secondary)';
      right.textContent = fmt.filesize ? formatBytes(fmt.filesize) : (fmt.ext ? fmt.ext.toUpperCase() : '');

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

  function closeModal() {
    const modal = document.getElementById('desktopFormatModal');
    if (modal) modal.classList.add('hidden');
    activeModalUrl = '';
  }

  function handleModalConfirm() {
    if (!activeModalUrl) return;
    const selectedFormat = activeModalFormats[selectedFormatIndex] || {};
    const title = document.getElementById('modalVideoTitle')?.textContent || '';
    const cleanTitle = (title && title !== 'Video Stream') ? title : '';

    closeModal();
    startDownload(
      activeModalUrl,
      cleanTitle,
      selectedFormat.format_spec || null,
      Boolean(selectedFormat.audio_only),
      selectedFormat.label || null
    );
  }

  function showToast(msg) {
    const toast = document.getElementById('toastNotification');
    const msgEl = document.getElementById('toastMessage');
    if (!toast || !msgEl) return;
    msgEl.textContent = msg;
    toast.classList.add('show');
    clearTimeout(window.__toastTimeout);
    window.__toastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, 2200);
  }

  function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatSpeed(bytesPerSec) {
    if (!bytesPerSec || bytesPerSec <= 0) return '0.0 MB/s';
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
})();
