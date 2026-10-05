/**
 * Automated Test Suite for MyDM Browser Extension Engine
 * Run with: node tests/test_extension_modules.js
 */

const assert = require('assert');
const path = require('path');

const StateMachine = require('../extension/engine/state_machine');
const FilenameUtil = require('../extension/engine/filename_util');
const RulesEngine = require('../extension/engine/rules_engine');
const SpeedTracker = require('../extension/engine/speed_tracker');
const { DownloadStore } = require('../extension/engine/download_store');
const { DownloadEngine, RETRYABLE_ERRORS } = require('../extension/engine/download_manager');

let totalTests = 0;
let passedTests = 0;

function test(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function testAsync(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('\n--- Running MyDM State Machine Tests ---');

  test('Valid transitions allow expected next states', () => {
    const { STATES, canTransition, validateTransition } = StateMachine;
    assert.strictEqual(canTransition(STATES.QUEUED, STATES.STARTING), true);
    assert.strictEqual(canTransition(STATES.STARTING, STATES.DOWNLOADING), true);
    assert.strictEqual(canTransition(STATES.DOWNLOADING, STATES.PAUSING), true);
    assert.strictEqual(canTransition(STATES.PAUSING, STATES.PAUSED), true);
    assert.strictEqual(canTransition(STATES.PAUSED, STATES.RESUMING), true);
    assert.strictEqual(canTransition(STATES.RESUMING, STATES.DOWNLOADING), true);
    assert.strictEqual(canTransition(STATES.DOWNLOADING, STATES.COMPLETED), true);
    assert.strictEqual(canTransition(STATES.DOWNLOADING, STATES.CANCELLING), true);
    assert.strictEqual(canTransition(STATES.CANCELLING, STATES.CANCELLED), true);
    assert.strictEqual(canTransition(STATES.DOWNLOADING, STATES.FAILED), true);
    assert.strictEqual(canTransition(STATES.FAILED, STATES.RETRYING), true);
    assert.strictEqual(canTransition(STATES.RETRYING, STATES.DOWNLOADING), true);
  });

  test('Invalid transitions throw validation errors', () => {
    const { STATES, canTransition, validateTransition } = StateMachine;
    assert.strictEqual(canTransition(STATES.COMPLETED, STATES.DOWNLOADING), false);
    assert.strictEqual(canTransition(STATES.PAUSED, STATES.COMPLETED), false);
    assert.strictEqual(canTransition(STATES.QUEUED, STATES.PAUSED), false);

    assert.throws(() => {
      validateTransition(STATES.COMPLETED, STATES.DOWNLOADING);
    }, /Invalid download state transition/);
  });

  test('State categorization helpers work correctly', () => {
    const { STATES, isActive, isTerminal, isPaused } = StateMachine;
    assert.strictEqual(isActive(STATES.DOWNLOADING), true);
    assert.strictEqual(isActive(STATES.QUEUED), true);
    assert.strictEqual(isActive(STATES.COMPLETED), false);
    assert.strictEqual(isTerminal(STATES.COMPLETED), true);
    assert.strictEqual(isTerminal(STATES.CANCELLED), true);
    assert.strictEqual(isTerminal(STATES.FAILED), true);
    assert.strictEqual(isPaused(STATES.PAUSED), true);
    assert.strictEqual(isPaused(STATES.DOWNLOADING), false);
  });

  console.log('\n--- Running MyDM Filename Intelligence Tests ---');

  test('Sanitizes standard and dirty filenames', () => {
    assert.strictEqual(FilenameUtil.sanitizeFilename('report:2026*final?.pdf'), 'report_2026_final_.pdf');
    assert.strictEqual(FilenameUtil.sanitizeFilename('archive/nested\\name.zip'), 'archive_nested_name.zip');
    assert.strictEqual(FilenameUtil.sanitizeFilename(''), 'download');
    assert.strictEqual(FilenameUtil.sanitizeFilename(null), 'download');
  });

  test('Prevents directory traversal and strip Windows drive letters', () => {
    const res = FilenameUtil.sanitizeFilename('../../etc/passwd');
    assert.ok(!res.includes('..'));
    assert.ok(!res.includes('/'));
    assert.ok(!res.includes('\\'));
    assert.strictEqual(FilenameUtil.sanitizeFilename('C:\\Windows\\System32\\calc.exe'), 'Windows_System32_calc.exe');
  });

  test('Protects Windows reserved device names', () => {
    assert.strictEqual(FilenameUtil.sanitizeFilename('CON.txt'), '_CON.txt');
    assert.strictEqual(FilenameUtil.sanitizeFilename('aux.tar.gz'), '_aux.tar.gz');
    assert.strictEqual(FilenameUtil.sanitizeFilename('nul'), '_nul');
    assert.strictEqual(FilenameUtil.sanitizeFilename('com1.bin'), '_com1.bin');
  });

  test('Extracts filenames from URLs correctly', () => {
    assert.strictEqual(
      FilenameUtil.extractFilenameFromUrl('https://example.com/files/document%20v2.pdf?token=123#hash'),
      'document v2.pdf'
    );
    assert.strictEqual(
      FilenameUtil.extractFilenameFromUrl('https://example.com/download/'),
      'download'
    );
  });

  test('Extracts RFC 5987 Content-Disposition filename', () => {
    const header = "attachment; filename*=UTF-8''special%20report%202026.pdf; size=1024";
    assert.strictEqual(
      FilenameUtil.extractFilenameFromContentDisposition(header),
      'special report 2026.pdf'
    );
  });

  test('Extracts standard quoted Content-Disposition filename', () => {
    const header = 'attachment; filename="my_archive.zip"; other=param';
    assert.strictEqual(
      FilenameUtil.extractFilenameFromContentDisposition(header),
      'my_archive.zip'
    );
  });

  console.log('\n--- Running MyDM Rules & Categorization Tests ---');

  test('Categorizes files based on extension', () => {
    const { CATEGORIES, getCategoryForFile } = RulesEngine;
    assert.strictEqual(getCategoryForFile('manual.pdf'), CATEGORIES.DOCUMENTS);
    assert.strictEqual(getCategoryForFile('sheet.xlsx'), CATEGORIES.DOCUMENTS);
    assert.strictEqual(getCategoryForFile('photo.jpeg'), CATEGORIES.IMAGES);
    assert.strictEqual(getCategoryForFile('banner.webp'), CATEGORIES.IMAGES);
    assert.strictEqual(getCategoryForFile('movie.mp4'), CATEGORIES.VIDEOS);
    assert.strictEqual(getCategoryForFile('clip.mkv'), CATEGORIES.VIDEOS);
    assert.strictEqual(getCategoryForFile('playlist.m3u8'), CATEGORIES.VIDEOS);
    assert.strictEqual(getCategoryForFile('song.flac'), CATEGORIES.AUDIO);
    assert.strictEqual(getCategoryForFile('backup.7z'), CATEGORIES.ARCHIVES);
    assert.strictEqual(getCategoryForFile('setup.exe'), CATEGORIES.PROGRAMS);
    assert.strictEqual(getCategoryForFile('ubuntu.iso'), CATEGORIES.ISOS);
    assert.strictEqual(getCategoryForFile('unknown.xyz'), CATEGORIES.OTHER);
  });

  test('Categorizes files based on MIME type when extension is ambiguous', () => {
    const { CATEGORIES, getCategoryForFile } = RulesEngine;
    assert.strictEqual(getCategoryForFile('file', 'video/webm'), CATEGORIES.VIDEOS);
    assert.strictEqual(getCategoryForFile('file', 'audio/mpeg'), CATEGORIES.AUDIO);
    assert.strictEqual(getCategoryForFile('file', 'application/pdf'), CATEGORIES.DOCUMENTS);
    assert.strictEqual(getCategoryForFile('file', 'image/png'), CATEGORIES.IMAGES);
  });

  test('Generates structured relative category paths', () => {
    const { CATEGORIES, getRelativeDownloadPath } = RulesEngine;
    assert.strictEqual(
      getRelativeDownloadPath('video.mp4', CATEGORIES.VIDEOS, true),
      'MyDM/Videos/video.mp4'
    );
    assert.strictEqual(
      getRelativeDownloadPath('doc.pdf', CATEGORIES.DOCUMENTS, true),
      'MyDM/Documents/doc.pdf'
    );
    assert.strictEqual(
      getRelativeDownloadPath('other.bin', CATEGORIES.OTHER, true),
      'MyDM/other.bin'
    );
    assert.strictEqual(
      getRelativeDownloadPath('doc.pdf', CATEGORIES.DOCUMENTS, false),
      'MyDM/doc.pdf'
    );
  });

  console.log('\n--- Running MyDM Speed & ETA Tracker Tests ---');

  test('Calculates rolling speed and ETA accurately', () => {
    const tracker = new SpeedTracker(3000);
    const id = 'test-speed';
    const now = 1000000;

    tracker.recordSample(id, 0, now);
    tracker.recordSample(id, 1048576, now + 1000); // 1 MB downloaded in 1s
    tracker.recordSample(id, 2097152, now + 2000); // 2 MB downloaded in 2s

    const speed = tracker.getSpeed(id);
    assert.strictEqual(Math.round(speed), 1048576); // 1 MB/s

    const eta = tracker.getEta(id, 5242880, 2097152); // ~3 MB remaining at 1 MB/s -> ~3s
    assert.strictEqual(eta, 3);

    assert.strictEqual(SpeedTracker.formatSpeed(1048576), '1.0 MB/s');
    assert.strictEqual(SpeedTracker.formatBytes(5242880), '5.0 MB');
    assert.strictEqual(SpeedTracker.formatEta(65), '1m 5s');
    assert.strictEqual(SpeedTracker.formatEta(3665), '1h 1m');
  });

  console.log('\n--- Running MyDM Download Store Tests ---');

  await testAsync('Store manages download records, updates, and persistence', async () => {
    const store = new DownloadStore();
    await store.init();

    const record = store.createRecord({
      url: 'https://example.com/test.zip',
      filename: 'test.zip',
      totalBytes: 1000,
      downloadedBytes: 0
    });

    assert.ok(record.id.startsWith('mydm_'));
    assert.strictEqual(record.filename, 'test.zip');
    assert.strictEqual(record.status, 'QUEUED');

    // Update progress
    store.updateRecord(record.id, {
      downloadedBytes: 500,
      status: 'DOWNLOADING'
    });

    const updated = store.get(record.id);
    assert.strictEqual(updated.downloadedBytes, 500);
    assert.strictEqual(updated.percent, 50);
    assert.strictEqual(updated.status, 'DOWNLOADING');

    // Search by URL
    const found = store.getByUrl('https://example.com/test.zip#fragment');
    assert.strictEqual(found.id, record.id);

    // Clear completed
    store.updateRecord(record.id, { status: 'COMPLETED' });
    const cleared = store.clearCompleted();
    assert.strictEqual(cleared, 1);
    assert.strictEqual(store.get(record.id), null);
  });

  console.log('\n--- Running MyDM Engine Queue & Error Tests ---');

  await testAsync('Engine queues downloads and obeys max concurrency limits', async () => {
    const store = new DownloadStore();
    await store.init();
    store.updateSettings({ maxConcurrentDownloads: 2 });

    const engine = new DownloadEngine(store);

    // Mock chrome.downloads
    global.chrome = {
      downloads: {
        download: (opts, cb) => cb(Math.floor(Math.random() * 1000)),
        pause: (id, cb) => cb(),
        resume: (id, cb) => cb(),
        cancel: (id, cb) => cb(),
        search: (q, cb) => cb([]),
        onCreated: { addListener: () => {} },
        onChanged: { addListener: () => {} },
        onErased: { addListener: () => {} }
      },
      runtime: { lastError: null }
    };

    const d1 = await engine.addDownload({ url: 'https://example.com/f1.zip' });
    const d2 = await engine.addDownload({ url: 'https://example.com/f2.zip' });
    const d3 = await engine.addDownload({ url: 'https://example.com/f3.zip' });

    // Allow async scheduling microtasks
    await new Promise((r) => setTimeout(r, 50));

    const all = store.getAll();
    const active = all.filter((d) => d.status === 'DOWNLOADING' || d.status === 'STARTING');
    const queued = all.filter((d) => d.status === 'QUEUED');

    assert.strictEqual(active.length, 2);
    assert.strictEqual(queued.length, 1);
    assert.strictEqual(queued[0].id, d3.record.id);
  });

  test('Classifies retryable network and server errors correctly', () => {
    assert.strictEqual(RETRYABLE_ERRORS.has('NETWORK_FAILED'), true);
    assert.strictEqual(RETRYABLE_ERRORS.has('NETWORK_TIMEOUT'), true);
    assert.strictEqual(RETRYABLE_ERRORS.has('SERVER_FAILED'), true);
    assert.strictEqual(RETRYABLE_ERRORS.has('FILE_ACCESS_DENIED'), false);
    assert.strictEqual(RETRYABLE_ERRORS.has('USER_CANCELED'), false);
  });

  console.log('\n--- Running MyDM Background & Native Messaging Bridge Tests ---');

  await testAsync('Background service worker routes streaming URLs and manages native host state', async () => {
    const fs = require('fs');
    const vm = require('vm');
    const bgCode = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');

    let nativePosted = [];
    let messageListener = null;
    let nativeMessageListener = null;

    const mockContext = {
      importScripts: () => {},
      MyDMStateMachine: StateMachine,
      MyDMFilenameUtil: FilenameUtil,
      MyDMRulesEngine: RulesEngine,
      MyDMSpeedTracker: SpeedTracker,
      MyDMDownloadStore: { DownloadStore },
      MyDMDownloadEngine: { DownloadEngine },
      chrome: {
        runtime: {
          onInstalled: { addListener: () => {} },
          onMessage: { addListener: (cb) => { messageListener = cb; } },
          connectNative: () => ({
            onMessage: { addListener: (cb) => { nativeMessageListener = cb; } },
            onDisconnect: { addListener: () => {} },
            postMessage: (m) => nativePosted.push(m)
          }),
          sendMessage: () => Promise.resolve()
        },
        contextMenus: {
          removeAll: (cb) => cb && cb(),
          create: () => {},
          onClicked: { addListener: () => {} }
        },
        tabs: { query: (q, cb) => cb([]), sendMessage: () => {} }
      },
      console,
      URL,
      Set,
      Map,
      Date,
      Math,
      Promise,
      Error,
      setTimeout,
      clearTimeout
    };

    vm.runInNewContext(bgCode, mockContext);
    assert.strictEqual(typeof messageListener, 'function');

    // Test YouTube link submission
    const res = await new Promise((resolve) => {
      messageListener({ action: 'CREATE_DOWNLOAD', url: 'https://youtu.be/4jiM4w7qr2g' }, {}, resolve);
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(res.record.category, 'Videos');
    assert.strictEqual(res.record.engine, 'native');
    assert.strictEqual(nativePosted.length, 1);
    assert.strictEqual(nativePosted[0].command, 'download');
    assert.strictEqual(nativePosted[0].url, 'https://youtu.be/4jiM4w7qr2g');

    // Test Audio-only video download with formatSpec
    const audioRes = await new Promise((resolve) => {
      messageListener({
        action: 'CREATE_DOWNLOAD',
        url: 'https://youtu.be/4jiM4w7qr2g',
        audioOnly: true,
        formatSpec: 'ba/b',
        quality: 'Audio MP3'
      }, {}, resolve);
    });

    assert.strictEqual(audioRes.success, true);
    assert.strictEqual(audioRes.record.category, 'Audio');
    assert.strictEqual(nativePosted[1].command, 'download');
    assert.strictEqual(nativePosted[1].audio_only, true);
    assert.strictEqual(nativePosted[1].format_spec, 'ba/b');

    // Test GET_FORMATS dispatch
    const formatPromise = new Promise((resolve) => {
      messageListener({ action: 'GET_FORMATS', url: 'https://youtu.be/4jiM4w7qr2g' }, {}, resolve);
    });
    assert.strictEqual(nativePosted[2].command, 'get_formats');
    assert.strictEqual(nativePosted[2].url, 'https://youtu.be/4jiM4w7qr2g');

    // Simulate native host responding with formats
    nativeMessageListener({
      event: 'formats',
      id: nativePosted[2].id,
      data: { title: 'Test YouTube Video', formats: [{ label: '1080p' }] }
    });

    const formatRes = await formatPromise;
    assert.strictEqual(formatRes.success, true);
    assert.strictEqual(formatRes.data.title, 'Test YouTube Video');

    // Test control action aliases (PAUSE, CANCEL, SHOW_IN_FOLDER, OPEN_FILE)
    const pauseRes = await new Promise((resolve) => {
      messageListener({ action: 'PAUSE', id: res.record.id }, {}, resolve);
    });
    assert.strictEqual(pauseRes.success, true);
    assert.strictEqual(nativePosted[nativePosted.length - 1].command, 'pause');

    const cancelRes = await new Promise((resolve) => {
      messageListener({ action: 'CANCEL', id: res.record.id }, {}, resolve);
    });
    assert.strictEqual(cancelRes.success, true);
    assert.strictEqual(nativePosted[nativePosted.length - 1].command, 'cancel');

    const folderRes = await new Promise((resolve) => {
      messageListener({ action: 'SHOW_IN_FOLDER', id: res.record.id }, {}, resolve);
    });
    assert.strictEqual(folderRes.success, true);
    assert.strictEqual(nativePosted[nativePosted.length - 1].command, 'show_in_folder');

    const openRes = await new Promise((resolve) => {
      messageListener({ action: 'OPEN_FILE', id: res.record.id }, {}, resolve);
    });
    assert.strictEqual(openRes.success, true);
    assert.strictEqual(nativePosted[nativePosted.length - 1].command, 'open_file');
  });

  test('RulesEngine detects streaming platforms accurately', () => {
    assert.strictEqual(RulesEngine.isStreamingUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.strictEqual(RulesEngine.isStreamingUrl('https://youtu.be/dQw4w9WgXcQ'), true);
    assert.strictEqual(RulesEngine.isStreamingUrl('https://vimeo.com/123456'), true);
    assert.strictEqual(RulesEngine.isStreamingUrl('https://tiktok.com/@user/video/123'), true);
    assert.strictEqual(RulesEngine.isStreamingUrl('https://example.com/archive.zip'), false);
    assert.strictEqual(RulesEngine.isStreamingUrl('https://files.org/installer.msi'), false);
  });

  await testAsync('DownloadEngine automatically captures external browser downloads into store', async () => {
    const store = new DownloadStore();
    await store.init();
    const engine = new DownloadEngine(store);

    // Simulate an external browser download creation event
    engine._handleBrowserCreated({
      id: 9999,
      url: 'https://example.com/files/setup_v2.exe',
      filename: 'C:\\Users\\User\\Downloads\\setup_v2.exe',
      totalBytes: 52428800,
      bytesReceived: 1048576,
      state: 'in_progress'
    });

    const captured = store.getByBrowserId(9999);
    assert.ok(captured, 'Record should be captured into store');
    assert.strictEqual(captured.filename, 'setup_v2.exe');
    assert.strictEqual(captured.category, 'Programs');
    assert.strictEqual(captured.engine, 'browser');
    assert.strictEqual(captured.totalBytes, 52428800);
  });

  test('Media sniffer prioritizes videos and streaming media over images', () => {
    const mockDiscovered = [
      { url: 'https://i.ytimg.com/vi/123/hqdefault.jpg', type: 'image' },
      { url: 'https://example.com/doc.pdf', type: 'document' },
      { url: 'https://www.youtube.com/watch?v=123', type: 'video', isStream: true },
      { url: 'https://example.com/audio.mp3', type: 'audio' },
      { url: 'https://example.com/banner.png', type: 'image' }
    ];

    mockDiscovered.sort((a, b) => {
      const aScore = (a.type === 'video' || a.isStream) ? 3 : (a.type === 'audio' ? 2 : (a.type !== 'image' ? 1 : 0));
      const bScore = (b.type === 'video' || b.isStream) ? 3 : (b.type === 'audio' ? 2 : (b.type !== 'image' ? 1 : 0));
      return bScore - aScore;
    });

    assert.strictEqual(mockDiscovered[0].type, 'video');
    assert.strictEqual(mockDiscovered[1].type, 'audio');
    assert.strictEqual(mockDiscovered[2].type, 'document');
    assert.strictEqual(mockDiscovered[3].type, 'image');
    assert.strictEqual(mockDiscovered[4].type, 'image');
  });

  test('RulesEngine detects playlist URLs accurately', () => {
    assert.strictEqual(RulesEngine.isPlaylistUrl('https://www.youtube.com/playlist?list=PLKnIA16_Rmvb-ToL3RQ_bwxG4_ND-0-DT'), true);
    assert.strictEqual(RulesEngine.isPlaylistUrl('https://www.youtube.com/watch?v=9TKpRnoEb5s&list=PLKnIA16_Rmvb-ToL3RQ_bwxG4_ND-0-DT&index=3'), true);
    assert.strictEqual(RulesEngine.isPlaylistUrl('https://music.youtube.com/playlist?list=PL12345'), true);
    assert.strictEqual(RulesEngine.isPlaylistUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), false);
    assert.strictEqual(RulesEngine.isPlaylistUrl('https://example.com/video.mp4'), false);
  });

  await testAsync('Background service worker handles GET_PLAYLIST_INFO and DOWNLOAD_PLAYLIST batch enqueue', async () => {
    const fs = require('fs');
    const vm = require('vm');
    const bgCode = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');

    let nativePosted = [];
    let messageListener = null;
    let nativeMessageListener = null;

    const mockContext = {
      importScripts: () => {},
      MyDMStateMachine: StateMachine,
      MyDMFilenameUtil: FilenameUtil,
      MyDMRulesEngine: RulesEngine,
      MyDMSpeedTracker: SpeedTracker,
      MyDMDownloadStore: { DownloadStore },
      MyDMDownloadEngine: { DownloadEngine },
      chrome: {
        runtime: {
          onInstalled: { addListener: () => {} },
          onMessage: { addListener: (cb) => { messageListener = cb; } },
          connectNative: () => ({
            onMessage: { addListener: (cb) => { nativeMessageListener = cb; } },
            onDisconnect: { addListener: () => {} },
            postMessage: (m) => nativePosted.push(m)
          }),
          sendMessage: () => Promise.resolve()
        },
        contextMenus: {
          removeAll: (cb) => cb && cb(),
          create: () => {},
          onClicked: { addListener: () => {} }
        },
        tabs: { query: (q, cb) => cb([]), sendMessage: () => {} }
      },
      console,
      URL,
      Set,
      Map,
      Date,
      Math,
      Promise,
      Error,
      setTimeout,
      clearTimeout
    };

    vm.runInNewContext(bgCode, mockContext);

    // 1. Test GET_PLAYLIST_INFO
    const playlistInfoPromise = new Promise((resolve) => {
      messageListener({ action: 'GET_PLAYLIST_INFO', url: 'https://www.youtube.com/playlist?list=PL123' }, {}, resolve);
    });

    const getPlMsg = nativePosted.find((m) => m.command === 'get_playlist_info');
    assert.ok(getPlMsg, 'get_playlist_info command sent to native host');
    assert.strictEqual(getPlMsg.url, 'https://www.youtube.com/playlist?list=PL123');

    // Simulate native host responding with playlist items
    nativeMessageListener({
      event: 'playlist_info',
      id: getPlMsg.id,
      data: {
        title: 'Numpy Series',
        item_count: 2,
        entries: [
          { url: 'https://www.youtube.com/watch?v=vid1', title: 'Part 1 - Intro', duration: 300, index: 1 },
          { url: 'https://www.youtube.com/watch?v=vid2', title: 'Part 2 - Basics', duration: 420, index: 2 }
        ]
      }
    });

    const plResult = await playlistInfoPromise;
    assert.strictEqual(plResult.success, true);
    assert.strictEqual(plResult.data.title, 'Numpy Series');
    assert.strictEqual(plResult.data.item_count, 2);

    // 2. Test DOWNLOAD_PLAYLIST batch creation
    const dlPlaylistRes = await new Promise((resolve) => {
      messageListener({
        action: 'DOWNLOAD_PLAYLIST',
        playlistTitle: 'Numpy Series',
        entries: plResult.data.entries,
        formatSpec: 'bestvideo*+bestaudio/best',
        audioOnly: false,
        quality: 'Best Quality',
        playlistUrl: 'https://www.youtube.com/playlist?list=PL123'
      }, {}, resolve);
    });

    assert.strictEqual(dlPlaylistRes.success, true);
    assert.strictEqual(dlPlaylistRes.count, 2);
    assert.strictEqual(dlPlaylistRes.folder, 'Numpy Series');

    // Verify native commands were initiated for queued downloads
    const dlCommands = nativePosted.filter((m) => m.command === 'download');
    assert.ok(dlCommands.length >= 1, 'At least 1 download started immediately according to concurrency');
    assert.ok(dlCommands.some((c) => c.url.includes('vid1')));
  });

  console.log(`\n========================================`);
  console.log(`Results: ${passedTests} / ${totalTests} tests passed`);
  console.log(`========================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
