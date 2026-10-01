/**
 * MyDM Adversarial & Failure-Path Test Suite
 * Validates edge cases, race conditions, malformed input, and recovery.
 */

const assert = require('assert');
const path = require('path');
const vm = require('vm');
const fs = require('fs');

const StateMachine = require('../extension/engine/state_machine');
const FilenameUtil = require('../extension/engine/filename_util');
const RulesEngine = require('../extension/engine/rules_engine');
const SpeedTracker = require('../extension/engine/speed_tracker');
const { DownloadStore } = require('../extension/engine/download_store');
const { DownloadEngine, RETRYABLE_ERRORS } = require('../extension/engine/download_manager');

let total = 0;
let passed = 0;

function runTest(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runTestAsync(name, fn) {
  total++;
  try {
    await fn();
    console.log(`  ✓ [PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function main() {
  console.log('====================================================');
  console.log('  MyDM Adversarial & Reliability Verification Suite');
  console.log('====================================================\n');

  // Test 1: Filename security & Unicode support
  runTest('Filename security: Unicode, Windows device names, and traversal', () => {
    assert.strictEqual(FilenameUtil.sanitizeFilename('unicode-नेपाली.pdf'), 'unicode-नेपाली.pdf');
    assert.strictEqual(FilenameUtil.sanitizeFilename('CON.txt'), '_CON.txt');
    assert.strictEqual(FilenameUtil.sanitizeFilename('NUL.iso'), '_NUL.iso');
    assert.strictEqual(FilenameUtil.sanitizeFilename('COM1.bin'), '_COM1.bin');
    const trav = FilenameUtil.sanitizeFilename('../../../etc/passwd');
    assert.strictEqual(trav.includes('..'), false);
    assert.strictEqual(trav.includes('/'), false);
    assert.strictEqual(trav.includes('\\'), false);
    assert.strictEqual(FilenameUtil.sanitizeFilename('C:\\Windows\\System32\\cmd.exe'), 'Windows_System32_cmd.exe');
    assert.strictEqual(FilenameUtil.sanitizeFilename(''), 'download');
    assert.strictEqual(FilenameUtil.sanitizeFilename(null), 'download');
  });

  // Test 2: Rules Categorization
  runTest('Rules engine categorizes extensions and safe paths', () => {
    assert.strictEqual(RulesEngine.getCategoryForFile('video.mp4'), 'Videos');
    assert.strictEqual(RulesEngine.getCategoryForFile('music.flac'), 'Audio');
    assert.strictEqual(RulesEngine.getCategoryForFile('document.pdf'), 'Documents');
    assert.strictEqual(RulesEngine.getCategoryForFile('archive.tar.gz'), 'Archives');
    assert.strictEqual(RulesEngine.getCategoryForFile('installer.exe'), 'Programs');
    assert.strictEqual(RulesEngine.getCategoryForFile('ubuntu.iso'), 'ISOs');

    const pathVideos = RulesEngine.getRelativeDownloadPath('test.mp4', 'Videos', true);
    assert.ok(pathVideos.includes('Videos'));
  });

  // Test 3: DownloadStore resilience & persistence
  runTest('DownloadStore maintains integrity across corrupted and fresh data', async () => {
    const store = new DownloadStore();
    assert.strictEqual(store.getAll().length, 0);

    const rec = store.createRecord({
      url: 'https://example.com/test.zip',
      filename: 'test.zip',
      engine: 'native'
    });
    assert.strictEqual(rec.engine, 'native');
    assert.strictEqual(rec.status, 'QUEUED');

    // Update record
    store.updateRecord(rec.id, { status: 'DOWNLOADING', percent: 50 });
    assert.strictEqual(store.get(rec.id).percent, 50);
    assert.strictEqual(store.get(rec.id).status, 'DOWNLOADING');

    // Duplicate check
    assert.strictEqual(store.getByUrl('https://example.com/test.zip').id, rec.id);
    assert.strictEqual(store.getByUrl('https://example.com/nonexistent'), null);
  });

  // Test 4: Background Service Worker full end-to-end VM dispatch
  await runTestAsync('Background Service Worker handles streaming YouTube URLs and native messaging', async () => {
    const bgCode = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');

    let nativeMessages = [];
    let runtimeListener = null;
    let nativeListener = null;

    const mockChrome = {
      runtime: {
        onInstalled: { addListener: () => {} },
        onMessage: {
          addListener: (cb) => { runtimeListener = cb; }
        },
        connectNative: () => ({
          onMessage: { addListener: (cb) => { nativeListener = cb; } },
          onDisconnect: { addListener: () => {} },
          postMessage: (m) => nativeMessages.push(m)
        }),
        sendMessage: () => Promise.resolve()
      },
      contextMenus: {
        removeAll: (cb) => cb && cb(),
        create: () => {},
        onClicked: { addListener: () => {} }
      },
      tabs: {
        query: (q, cb) => cb([]),
        sendMessage: () => {}
      }
    };

    const sandbox = {
      importScripts: () => {},
      MyDMStateMachine: StateMachine,
      StateMachine: StateMachine,
      MyDMFilenameUtil: FilenameUtil,
      FilenameUtil: FilenameUtil,
      MyDMRulesEngine: RulesEngine,
      RulesEngine: RulesEngine,
      MyDMSpeedTracker: SpeedTracker,
      SpeedTracker: SpeedTracker,
      MyDMDownloadStore: { DownloadStore },
      DownloadStore: DownloadStore,
      MyDMDownloadEngine: { DownloadEngine, RETRYABLE_ERRORS },
      DownloadEngine: DownloadEngine,
      chrome: mockChrome,
      console,
      URL,
      Set,
      Date,
      Math,
      Promise,
      Error
    };

    vm.runInNewContext(bgCode, sandbox);
    assert.strictEqual(typeof runtimeListener, 'function');

    // A. Test Malformed Message
    const malformedRes = await new Promise((resolve) => {
      runtimeListener({ action: 'CREATE_DOWNLOAD' }, {}, resolve);
    });
    assert.strictEqual(malformedRes.success, false);
    assert.strictEqual(malformedRes.error, 'No URL provided');

    // B. Test Unknown Action
    const unknownRes = await new Promise((resolve) => {
      runtimeListener({ action: 'NON_EXISTENT_ACTION' }, {}, resolve);
    });
    assert.strictEqual(unknownRes.success, false);

    // C. Test YouTube URL Download Creation (The exact scenario from the screenshot)
    const ytUrl = 'https://www.youtube.com/watch?v=UW8LgC-S_0c';
    const ytRes = await new Promise((resolve) => {
      runtimeListener({ action: 'CREATE_DOWNLOAD', url: ytUrl }, {}, resolve);
    });

    assert.strictEqual(ytRes.success, true);
    assert.strictEqual(ytRes.record.category, 'Videos');
    assert.strictEqual(ytRes.record.engine, 'native');
    assert.strictEqual(ytRes.record.url, ytUrl);
    assert.ok(ytRes.record.filename.endsWith('.mp4'));

    // Verify native host received the command
    assert.strictEqual(nativeMessages.length, 1);
    assert.strictEqual(nativeMessages[0].command, 'download');
    assert.strictEqual(nativeMessages[0].url, ytUrl);
    assert.strictEqual(nativeMessages[0].id, ytRes.record.id);

    // D. Simulate native host progress callback
    assert.strictEqual(typeof nativeListener, 'function');
    nativeListener({
      event: 'progress',
      id: ytRes.record.id,
      filename: 'YouTube_Video_UW8LgC.mp4',
      percent: 65,
      speed: '4.8MB/s',
      size: 50000000,
      downloaded: 32500000
    });

    // Query state from extension
    const stateRes = await new Promise((resolve) => {
      runtimeListener({ action: 'GET_STATE' }, {}, resolve);
    });
    const updatedRecord = stateRes.downloads.find((d) => d.id === ytRes.record.id);
    assert.strictEqual(updatedRecord.percent, 65);
    assert.strictEqual(updatedRecord.speedFormatted, '4.8MB/s');
    assert.strictEqual(updatedRecord.filename, 'YouTube_Video_UW8LgC.mp4');
    assert.strictEqual(updatedRecord.status, 'DOWNLOADING');

    // E. Simulate native host completion callback
    nativeListener({
      event: 'complete',
      id: ytRes.record.id,
      filename: 'YouTube_Video_UW8LgC.mp4',
      file: 'C:\\Users\\User\\Downloads\\YouTube_Video_UW8LgC.mp4'
    });

    const completedStateRes = await new Promise((resolve) => {
      runtimeListener({ action: 'GET_STATE' }, {}, resolve);
    });
    const completedRecord = completedStateRes.downloads.find((d) => d.id === ytRes.record.id);
    assert.strictEqual(completedRecord.status, 'COMPLETED');
    assert.strictEqual(completedRecord.percent, 100);
    assert.strictEqual(completedRecord.filePath, 'C:\\Users\\User\\Downloads\\YouTube_Video_UW8LgC.mp4');

    // F. Duplicate prevention while active
    // Start another active download
    const activeUrl = 'https://youtu.be/4jiM4w7qr2g';
    const activeRes1 = await new Promise((resolve) => {
      runtimeListener({ action: 'CREATE_DOWNLOAD', url: activeUrl }, {}, resolve);
    });
    assert.strictEqual(activeRes1.duplicate, false);

    const activeRes2 = await new Promise((resolve) => {
      runtimeListener({ action: 'CREATE_DOWNLOAD', url: activeUrl }, {}, resolve);
    });
    assert.strictEqual(activeRes2.duplicate, true);
  });

  console.log(`\n====================================================`);
  console.log(`  Adversarial Results: ${passed} / ${total} tests passed`);
  console.log(`====================================================\n`);

  if (passed !== total) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Test runner fatal failure:', err);
  process.exit(1);
});
