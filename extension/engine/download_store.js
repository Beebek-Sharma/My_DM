/**
 * MyDM Download Store - Single Source of Truth
 * Manages persistent download records and configuration in chrome.storage.local.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.MyDMDownloadStore = exportsObj;
    root.DownloadStore = exportsObj.DownloadStore;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_KEY_DOWNLOADS = 'mydm_downloads';
  const STORAGE_KEY_SETTINGS = 'mydm_settings';

  const DEFAULT_SETTINGS = Object.freeze({
    maxConcurrentDownloads: 3,
    maxRetries: 3,
    retryBaseDelayMs: 1500,
    autoCategorize: true,
    categoryFolders: true,
    conflictAction: 'uniquify', // 'uniquify' | 'overwrite' | 'prompt'
    theme: 'auto'
  });

  function generateId() {
    return 'mydm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
  }

  class DownloadStore {
    constructor() {
      this.downloads = new Map(); // id -> DownloadRecord
      this.settings = { ...DEFAULT_SETTINGS };
      this.listeners = new Set();
      this.persistTimer = null;
      this.initialized = false;
    }

    async init() {
      if (this.initialized) return;

      const data = await this._storageGet([STORAGE_KEY_DOWNLOADS, STORAGE_KEY_SETTINGS]);
      if (data && Array.isArray(data[STORAGE_KEY_DOWNLOADS])) {
        this.downloads.clear();
        for (const item of data[STORAGE_KEY_DOWNLOADS]) {
          if (item && item.id) {
            this.downloads.set(item.id, item);
          }
        }
      }

      if (data && data[STORAGE_KEY_SETTINGS]) {
        this.settings = { ...DEFAULT_SETTINGS, ...data[STORAGE_KEY_SETTINGS] };
      }

      this.initialized = true;
    }

    _storageGet(keys) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.get(keys, (res) => resolve(res || {}));
        } else {
          // Fallback for tests/node environment
          resolve({});
        }
      });
    }

    _storageSet(obj) {
      return new Promise((resolve) => {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set(obj, () => resolve());
        } else {
          resolve();
        }
      });
    }

    queuePersist() {
      if (this.persistTimer) clearTimeout(this.persistTimer);
      this.persistTimer = setTimeout(() => {
        this.persistNow();
        this.persistTimer = null;
      }, 150);
    }

    async persistNow() {
      const array = Array.from(this.downloads.values());
      await this._storageSet({
        [STORAGE_KEY_DOWNLOADS]: array,
        [STORAGE_KEY_SETTINGS]: this.settings
      });
    }

    get(id) {
      return this.downloads.get(id) || null;
    }

    getByBrowserId(browserDownloadId) {
      if (browserDownloadId === undefined || browserDownloadId === null) return null;
      for (const record of this.downloads.values()) {
        if (record.browserDownloadId === browserDownloadId) {
          return record;
        }
      }
      return null;
    }

    getByUrl(url) {
      if (!url) return null;
      const cleanUrl = url.split('#')[0];
      for (const record of this.downloads.values()) {
        if (record.url && record.url.split('#')[0] === cleanUrl) {
          return record;
        }
      }
      return null;
    }

    getAll() {
      return Array.from(this.downloads.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }

    createRecord(opts) {
      const id = opts.id || generateId();
      const now = Date.now();

      const record = {
        id,
        url: opts.url || '',
        referer: opts.referer || '',
        filename: opts.filename || 'download',
        category: opts.category || 'Other',
        relativePath: opts.relativePath || opts.filename || 'download',
        totalBytes: typeof opts.totalBytes === 'number' ? opts.totalBytes : 0,
        downloadedBytes: typeof opts.downloadedBytes === 'number' ? opts.downloadedBytes : 0,
        percent: typeof opts.percent === 'number' ? opts.percent : 0,
        speed: 0,
        eta: null,
        status: opts.status || 'QUEUED',
        browserDownloadId: opts.browserDownloadId || null,
        error: null,
        errorCode: null,
        retryCount: 0,
        maxRetries: this.settings.maxRetries,
        resumable: opts.resumable !== false,
        engine: opts.engine || 'browser',
        quality: opts.quality || null,
        formatSpec: opts.formatSpec || null,
        audioOnly: Boolean(opts.audioOnly),
        filePath: opts.filePath || null,
        createdAt: now,
        startedAt: null,
        completedAt: null
      };

      this.downloads.set(id, record);
      this.queuePersist();
      this._notifyListeners('created', record);
      return record;
    }

    updateRecord(id, updates) {
      const record = this.downloads.get(id);
      if (!record) return null;

      Object.assign(record, updates);

      if (record.status === 'COMPLETED') {
        record.percent = 100;
        if (record.totalBytes > 0 && record.downloadedBytes < record.totalBytes) {
          record.downloadedBytes = record.totalBytes;
        }
      } else if (updates.percent === undefined && record.totalBytes > 0 && typeof record.downloadedBytes === 'number') {
        record.percent = Math.min(100, Math.max(0, Math.round((record.downloadedBytes / record.totalBytes) * 100)));
      }

      this.queuePersist();
      this._notifyListeners('updated', record);
      return record;
    }

    removeRecord(id) {
      const record = this.downloads.get(id);
      if (record) {
        this.downloads.delete(id);
        this.queuePersist();
        this._notifyListeners('deleted', record);
        return true;
      }
      return false;
    }

    clearCompleted() {
      let count = 0;
      for (const [id, record] of this.downloads.entries()) {
        if (record.status === 'COMPLETED' || record.status === 'CANCELLED' || record.status === 'FAILED') {
          this.downloads.delete(id);
          count++;
        }
      }
      if (count > 0) {
        this.queuePersist();
        this._notifyListeners('cleared', { count });
      }
      return count;
    }

    clearAll() {
      const count = this.downloads.size;
      this.downloads.clear();
      this.queuePersist();
      this._notifyListeners('cleared_all', { count });
      return count;
    }

    updateSettings(newSettings) {
      this.settings = { ...this.settings, ...newSettings };
      this.queuePersist();
      this._notifyListeners('settings_updated', this.settings);
      return this.settings;
    }

    getSettings() {
      return { ...this.settings };
    }

    subscribe(listener) {
      this.listeners.add(listener);
      return () => this.listeners.delete(listener);
    }

    _notifyListeners(event, data) {
      for (const fn of this.listeners) {
        try {
          fn(event, data);
        } catch (_) {}
      }
    }
  }

  return {
    DownloadStore,
    DEFAULT_SETTINGS,
    generateId
  };
});
