/**
 * MyDM Core Download Manager
 * Orchestrates browser-native downloads, queue scheduling, retries, and events.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(
      require('./state_machine'),
      require('./filename_util'),
      require('./rules_engine'),
      require('./speed_tracker')
    );
  } else {
    const exportsObj = factory(
      root.MyDMStateMachine || root.StateMachine,
      root.MyDMFilenameUtil || root.FilenameUtil,
      root.MyDMRulesEngine || root.RulesEngine,
      root.MyDMSpeedTracker || root.SpeedTracker
    );
    root.MyDMDownloadEngine = exportsObj;
    root.DownloadEngine = exportsObj.DownloadEngine;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (
  StateMachine,
  FilenameUtil,
  RulesEngine,
  SpeedTracker
) {
  'use strict';

  const { STATES, validateTransition, isActive } = StateMachine;

  // Error Classification
  const RETRYABLE_ERRORS = new Set([
    'NETWORK_FAILED',
    'NETWORK_TIMEOUT',
    'NETWORK_DISCONNECTED',
    'SERVER_FAILED',
    'SERVER_BAD_CONTENT',
    'CRASH'
  ]);

  class DownloadEngine {
    constructor(store) {
      this.store = store;
      this.speedTracker = new SpeedTracker();
      this.activeDrivers = new Map(); // internalId -> driver state
      this.retryTimers = new Map();   // internalId -> timerId
      this.isScheduling = false;
    }

    async init() {
      await this.store.init();
      this._bindBrowserEvents();
      await this.reconcileWithBrowser();
      this.scheduleNext();
    }

    _bindBrowserEvents() {
      if (typeof chrome === 'undefined' || !chrome.downloads) return;

      chrome.downloads.onCreated.addListener((item) => {
        this._handleBrowserCreated(item);
      });

      chrome.downloads.onChanged.addListener((delta) => {
        this._handleBrowserChanged(delta);
      });

      chrome.downloads.onErased.addListener((browserId) => {
        this._handleBrowserErased(browserId);
      });
    }

    /**
     * Add a download to the queue
     */
    async addDownload({ url, filename, referer, candidateName }) {
      if (!url || typeof url !== 'string' || !url.startsWith('http')) {
        throw new Error('Invalid download URL. Must start with http:// or https://');
      }

      // Check duplicates
      const existing = this.store.getByUrl(url);
      if (existing && isActive(existing.status)) {
        return { duplicate: true, record: existing };
      }

      // Resolve filename and category
      const resolvedFilename = FilenameUtil.resolveFilename(candidateName || filename, url);
      const category = RulesEngine.getCategoryForFile(resolvedFilename);
      const relativePath = RulesEngine.getRelativeDownloadPath(
        resolvedFilename,
        category,
        this.store.settings.categoryFolders
      );

      const record = this.store.createRecord({
        url,
        referer: referer || '',
        filename: resolvedFilename,
        category,
        relativePath,
        status: STATES.QUEUED
      });

      this.scheduleNext();
      return { duplicate: false, record };
    }

    /**
     * Schedule next queued download within concurrency limits
     */
    async scheduleNext() {
      if (this.isScheduling) return;
      this.isScheduling = true;

      try {
        const all = this.store.getAll();
        const activeCount = all.filter(
          (d) => d.status === STATES.DOWNLOADING || d.status === STATES.STARTING || d.status === STATES.RESUMING
        ).length;

        const maxConcurrent = this.store.settings.maxConcurrentDownloads || 3;
        const availableSlots = Math.max(0, maxConcurrent - activeCount);

        if (availableSlots <= 0) return;

        const queued = all.filter((d) => d.status === STATES.QUEUED);
        for (let i = 0; i < Math.min(availableSlots, queued.length); i++) {
          this._startDownloadItem(queued[i]);
        }
      } finally {
        this.isScheduling = false;
      }
    }

    /**
     * Start executing a single download via chrome.downloads
     */
    async _startDownloadItem(record) {
      if (!record) return;

      try {
        this.store.updateRecord(record.id, {
          status: validateTransition(record.status, STATES.STARTING),
          startedAt: record.startedAt || Date.now()
        });

        if (typeof chrome === 'undefined' || !chrome.downloads) {
          throw new Error('Browser downloads API unavailable');
        }

        const downloadOptions = {
          url: record.url,
          filename: record.relativePath,
          conflictAction: this.store.settings.conflictAction || 'uniquify',
          saveAs: false
        };

        const browserId = await new Promise((resolve, reject) => {
          chrome.downloads.download(downloadOptions, (id) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else if (id === undefined) {
              reject(new Error('Browser failed to start download.'));
            } else {
              resolve(id);
            }
          });
        });

        this.store.updateRecord(record.id, {
          browserDownloadId: browserId,
          status: validateTransition(record.status, STATES.DOWNLOADING)
        });
      } catch (err) {
        this._handleDownloadError(record.id, err.message || 'Failed to start download');
      }
    }

    async pauseDownload(id) {
      const record = this.store.get(id);
      if (!record) return;

      try {
        this.store.updateRecord(id, {
          status: validateTransition(record.status, STATES.PAUSING)
        });

        if (record.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
          await new Promise((resolve) => {
            chrome.downloads.pause(record.browserDownloadId, () => resolve());
          });
        }

        this.store.updateRecord(id, {
          status: validateTransition(STATES.PAUSING, STATES.PAUSED),
          speed: 0,
          eta: null
        });
        this.speedTracker.clear(id);
        this.scheduleNext();
      } catch (err) {
        this._handleDownloadError(id, err.message);
      }
    }

    async resumeDownload(id) {
      const record = this.store.get(id);
      if (!record) return;

      try {
        this.store.updateRecord(id, {
          status: validateTransition(record.status, STATES.RESUMING)
        });

        if (record.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
          await new Promise((resolve) => {
            chrome.downloads.resume(record.browserDownloadId, () => resolve());
          });
        }

        this.store.updateRecord(id, {
          status: validateTransition(STATES.RESUMING, STATES.DOWNLOADING)
        });
      } catch (err) {
        this._handleDownloadError(id, err.message);
      }
    }

    async cancelDownload(id) {
      const record = this.store.get(id);
      if (!record) return;

      try {
        if (this.retryTimers.has(id)) {
          clearTimeout(this.retryTimers.get(id));
          this.retryTimers.delete(id);
        }

        this.store.updateRecord(id, {
          status: validateTransition(record.status, STATES.CANCELLING)
        });

        if (record.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
          await new Promise((resolve) => {
            chrome.downloads.cancel(record.browserDownloadId, () => resolve());
          });
        }

        this.store.updateRecord(id, {
          status: validateTransition(STATES.CANCELLING, STATES.CANCELLED),
          speed: 0,
          eta: null
        });
        this.speedTracker.clear(id);
        this.scheduleNext();
      } catch (err) {
        this.store.updateRecord(id, { status: STATES.CANCELLED });
      }
    }

    async retryDownload(id) {
      const record = this.store.get(id);
      if (!record) return;

      if (this.retryTimers.has(id)) {
        clearTimeout(this.retryTimers.get(id));
        this.retryTimers.delete(id);
      }

      this.store.updateRecord(id, {
        status: validateTransition(record.status, STATES.QUEUED),
        error: null,
        errorCode: null,
        browserDownloadId: null,
        retryCount: 0
      });

      this.scheduleNext();
    }

    showInFolder(id) {
      const record = this.store.get(id);
      if (record && record.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
        chrome.downloads.show(record.browserDownloadId);
        return true;
      }
      return false;
    }

    openFile(id) {
      const record = this.store.get(id);
      if (record && record.browserDownloadId !== null && typeof chrome !== 'undefined' && chrome.downloads) {
        chrome.downloads.open(record.browserDownloadId);
        return true;
      }
      return false;
    }

    _handleBrowserCreated(item) {
      if (!item || !item.url) return;

      // Check if this item is tracked by MyDM
      let record = this.store.getByBrowserId(item.id);
      if (!record && item.url) {
        record = this.store.getByUrl(item.url);
        if (record && !record.browserDownloadId) {
          this.store.updateRecord(record.id, {
            browserDownloadId: item.id,
            totalBytes: item.totalBytes || record.totalBytes,
            downloadedBytes: item.bytesReceived || 0
          });
          return;
        }
      }

      // Auto-capture downloads initiated directly through browser
      if (!record && (item.url.startsWith('http://') || item.url.startsWith('https://'))) {
        const autoCapture = this.store.settings && this.store.settings.autoCaptureBrowserDownloads !== false;
        if (autoCapture) {
          const rawName = item.filename ? item.filename.split(/[/\\]/).pop() : '';
          const resolvedFilename = FilenameUtil.resolveFilename(rawName, item.url);
          const category = RulesEngine.getCategoryForFile(resolvedFilename);
          const relativePath = RulesEngine.getRelativeDownloadPath(
            resolvedFilename,
            category,
            this.store.settings && this.store.settings.categoryFolders !== false
          );

          record = this.store.createRecord({
            url: item.url,
            referer: item.referrer || '',
            filename: resolvedFilename,
            category: category,
            relativePath: relativePath,
            status: item.state === 'complete' ? STATES.COMPLETED : STATES.DOWNLOADING,
            engine: 'browser',
            browserDownloadId: item.id,
            totalBytes: item.totalBytes > 0 ? item.totalBytes : 0,
            downloadedBytes: item.bytesReceived || 0,
            startedAt: item.startTime ? new Date(item.startTime).getTime() : Date.now()
          });
        }
      }
    }

    _handleBrowserChanged(delta) {
      const record = this.store.getByBrowserId(delta.id);
      if (!record) return;

      const updates = {};

      if (delta.filename && delta.filename.current) {
        const cleanName = FilenameUtil.sanitizeFilename(delta.filename.current.split(/[/\\]/).pop());
        updates.filename = cleanName;
        updates.relativePath = delta.filename.current;
        updates.category = RulesEngine.getCategoryForFile(cleanName);
      }

      if (delta.totalBytes && typeof delta.totalBytes.current === 'number') {
        updates.totalBytes = delta.totalBytes.current;
      }

      if (delta.bytesReceived && typeof delta.bytesReceived.current === 'number') {
        updates.downloadedBytes = delta.bytesReceived.current;
        this.speedTracker.recordSample(record.id, delta.bytesReceived.current);
        const speed = this.speedTracker.getSpeed(record.id);
        const total = updates.totalBytes || record.totalBytes;
        const eta = this.speedTracker.getEta(record.id, total, delta.bytesReceived.current);
        updates.speed = speed;
        updates.eta = eta;
      }

      if (delta.paused) {
        if (delta.paused.current && record.status !== STATES.PAUSED) {
          updates.status = STATES.PAUSED;
          updates.speed = 0;
          updates.eta = null;
        } else if (!delta.paused.current && record.status === STATES.PAUSED) {
          updates.status = STATES.DOWNLOADING;
        }
      }

      if (delta.state) {
        const browserState = delta.state.current;
        if (browserState === 'complete') {
          updates.status = STATES.COMPLETED;
          updates.completedAt = Date.now();
          updates.percent = 100;
          updates.speed = 0;
          updates.eta = 0;
          this.speedTracker.clear(record.id);
        } else if (browserState === 'interrupted') {
          const errorMsg = delta.error ? delta.error.current : 'Download interrupted';
          this._handleDownloadError(record.id, errorMsg);
          return;
        }
      }

      this.store.updateRecord(record.id, updates);

      if (updates.status === STATES.COMPLETED) {
        this.scheduleNext();
      }
    }

    _handleBrowserErased(browserId) {
      const record = this.store.getByBrowserId(browserId);
      if (record) {
        this.store.updateRecord(record.id, {
          browserDownloadId: null
        });
      }
    }

    _handleDownloadError(id, errorMessage) {
      const record = this.store.get(id);
      if (!record) return;

      const isRetryable = RETRYABLE_ERRORS.has(errorMessage) || errorMessage.includes('NETWORK');
      const maxRetries = this.store.settings.maxRetries || 3;

      if (isRetryable && record.retryCount < maxRetries) {
        const nextRetry = record.retryCount + 1;
        const baseDelay = this.store.settings.retryBaseDelayMs || 1500;
        // Bounded exponential backoff + jitter
        const jitter = Math.floor(Math.random() * 500);
        const delayMs = Math.min(30000, baseDelay * Math.pow(2, nextRetry - 1)) + jitter;

        this.store.updateRecord(id, {
          status: STATES.RETRYING,
          retryCount: nextRetry,
          error: `${errorMessage} (Retry ${nextRetry}/${maxRetries} in ${(delayMs / 1000).toFixed(1)}s)`,
          speed: 0,
          eta: null
        });

        const timerId = setTimeout(() => {
          this.retryTimers.delete(id);
          this._startDownloadItem(this.store.get(id));
        }, delayMs);
        this.retryTimers.set(id, timerId);
      } else {
        this.store.updateRecord(id, {
          status: STATES.FAILED,
          error: errorMessage,
          errorCode: errorMessage,
          speed: 0,
          eta: null
        });
        this.speedTracker.clear(id);
        this.scheduleNext();
      }
    }

    /**
     * Reconcile download state with browser on startup
     */
    async reconcileWithBrowser() {
      if (typeof chrome === 'undefined' || !chrome.downloads) return;

      try {
        const items = await new Promise((resolve) => {
          chrome.downloads.search({}, (res) => resolve(res || []));
        });

        const browserMap = new Map(items.map((i) => [i.id, i]));
        for (const record of this.store.getAll()) {
          if (record.browserDownloadId && browserMap.has(record.browserDownloadId)) {
            const browserItem = browserMap.get(record.browserDownloadId);
            if (browserItem.state === 'complete' && record.status !== STATES.COMPLETED) {
              this.store.updateRecord(record.id, {
                status: STATES.COMPLETED,
                percent: 100,
                completedAt: Date.now()
              });
            } else if (browserItem.state === 'interrupted' && record.status === STATES.DOWNLOADING) {
              this.store.updateRecord(record.id, {
                status: STATES.FAILED,
                error: browserItem.error || 'Interrupted'
              });
            }
          }
        }
      } catch (_) {}
    }

    /**
     * Reveal completed browser download in file explorer
     */
    showInFolder(id) {
      const record = this.store.get(id);
      if (!record || record.browserDownloadId === null || record.browserDownloadId === undefined) {
        return false;
      }
      if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.show === 'function') {
        chrome.downloads.show(record.browserDownloadId);
        return true;
      }
      return false;
    }

    /**
     * Open completed browser download with default application
     */
    openFile(id) {
      const record = this.store.get(id);
      if (!record || record.browserDownloadId === null || record.browserDownloadId === undefined) {
        return false;
      }
      if (typeof chrome !== 'undefined' && chrome.downloads && typeof chrome.downloads.open === 'function') {
        chrome.downloads.open(record.browserDownloadId);
        return true;
      }
      return false;
    }
  }

  return {
    DownloadEngine,
    RETRYABLE_ERRORS
  };
});
