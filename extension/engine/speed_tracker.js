/**
 * MyDM Speed & ETA Tracker
 * Rolling-window speed measurement and accurate ETA calculations.
 */

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    const exportsObj = factory();
    root.MyDMSpeedTracker = exportsObj;
    root.SpeedTracker = exportsObj;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  class SpeedTracker {
    constructor(windowMs = 3000) {
      this.windowMs = windowMs;
      this.samples = new Map(); // downloadId -> Array<{ time: number, bytes: number }>
    }

    recordSample(downloadId, bytesDownloaded, now = Date.now()) {
      if (!this.samples.has(downloadId)) {
        this.samples.set(downloadId, []);
      }
      const list = this.samples.get(downloadId);
      list.push({ time: now, bytes: bytesDownloaded });

      // Prune samples older than rolling window
      const cutoff = now - this.windowMs;
      while (list.length > 2 && list[0].time < cutoff) {
        list.shift();
      }
    }

    getSpeed(downloadId) {
      const list = this.samples.get(downloadId);
      if (!list || list.length < 2) return 0;

      const oldest = list[0];
      const newest = list[list.length - 1];
      const elapsedSec = (newest.time - oldest.time) / 1000;
      if (elapsedSec <= 0) return 0;

      const deltaBytes = newest.bytes - oldest.bytes;
      if (deltaBytes <= 0) return 0;

      return deltaBytes / elapsedSec;
    }

    getEta(downloadId, totalBytes, currentBytes) {
      if (!totalBytes || totalBytes <= currentBytes) return 0;
      const speed = this.getSpeed(downloadId);
      if (speed <= 0) return null;
      const remainingBytes = totalBytes - currentBytes;
      return Math.round(remainingBytes / speed);
    }

    clear(downloadId) {
      if (downloadId) {
        this.samples.delete(downloadId);
      } else {
        this.samples.clear();
      }
    }

    static formatSpeed(bytesPerSec) {
      if (!bytesPerSec || bytesPerSec <= 0) return '0 B/s';
      const k = 1024;
      const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
      const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
      const val = (bytesPerSec / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);
      return `${val} ${sizes[i] || 'B/s'}`;
    }

    static formatBytes(bytes) {
      if (!bytes || bytes <= 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      const val = (bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1);
      return `${val} ${sizes[i] || 'B'}`;
    }

    static formatEta(seconds) {
      if (seconds === null || seconds === undefined) return 'Calculating ETA...';
      if (seconds <= 0) return '0s';
      if (seconds < 60) return `${seconds}s`;
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      if (mins < 60) {
        return `${mins}m ${secs}s`;
      }
      const hours = Math.floor(mins / 60);
      const remMins = mins % 60;
      return `${hours}h ${remMins}m`;
    }
  }

  return SpeedTracker;
});
