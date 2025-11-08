# MyDM Testing & Validation Guide

## ✅ Pre-Launch Checklist

Before using MyDM for real downloads, verify everything works correctly.

## 🧪 Unit Tests

### Test 1: Python Script Execution
**Verify the Python host can start without errors.**

```powershell
cd "C:\Users\YourUsername\MyDM\python_app"
python mydm_host.py
```

**Expected Result:**
- Script starts
- No immediate errors
- Logs written to `C:\Users\YourUsername\AppData\Local\MyDM\host.log`
- Press `Ctrl+C` to stop

**Troubleshoot if:**
- "ModuleNotFoundError: No module named 'requests'" → Run `pip install requests`
- "SyntaxError" → Check Python version is 3.7+ with `python --version`

### Test 2: Downloader Module Import
**Verify the download manager module loads correctly.**

```powershell
cd "C:\Users\YourUsername\MyDM\python_app"
python -c "from downloader import DownloadManager; print('✓ DownloadManager loaded')"
```

**Expected Result:**
```
✓ DownloadManager loaded
```

### Test 3: Extension Manifest Validation
**Verify extension manifest is valid JSON.**

```powershell
cd "C:\Users\YourUsername\MyDM\extension"
python -c "import json; json.load(open('manifest.json')); print('✓ Manifest valid')"
```

**Expected Result:**
```
✓ Manifest valid
```

## 🔌 Integration Tests

### Test 4: Chrome Extension Loading
**Verify the extension loads in Chrome without errors.**

1. Go to `chrome://extensions/`
2. Check MyDM extension is listed
3. Click **Details** → **Inspect views** → **service_worker**
4. Console should show no red errors
5. Check for message: `Connected to MyDM native host`

**Expected Result:**
- Extension appears enabled
- No error messages in console
- Background script logs appear

**Troubleshoot if:**
- Extension shows warning icon → Check manifest.json for syntax errors
- "Parsing error" → manifest.json has invalid JSON

### Test 5: Native Messaging Connection
**Verify Chrome can communicate with Python host.**

1. Open Chrome DevTools on MyDM extension service worker
2. Paste in console:
```javascript
chrome.runtime.connectNative('com.mydm.native')
```

**Expected Result:**
- No error thrown
- Connection established
- Check `host.log` for: "MyDM Native Host Started"

**Troubleshoot if:**
- Error: "Application com.mydm.native not found" → Registry not set or path incorrect
- Host doesn't start → Check `host.log` for errors

### Test 6: Context Menu Appearance
**Verify right-click context menu shows MyDM option.**

1. Go to any website
2. Right-click on a link
3. Scroll down to find "Download with MyDM"

**Expected Result:**
- Context menu item appears for links, images, videos
- Clicking it sends message to native host
- Check service worker logs for confirmation

**Troubleshoot if:**
- Menu item missing → Reload extension from `chrome://extensions/`
- Menu item present but inactive → Native host not running

## 📥 Download Tests

### Test 7: Small File Download (< 1MB)
**Test downloading a small file.**

1. Find a small file online (e.g., favicon, small image)
2. Right-click → Download with MyDM
3. Monitor popup for progress

**Expected Result:**
- Download starts
- Progress shows 0% → 100%
- File appears in Downloads folder
- Status changes to "Complete" (green)

**Logs should show:**
- "Starting download: [URL]"
- "Progress: filename - X% (XXX KB/s)"
- "Complete: filename"

### Test 8: Medium File Download (1MB - 50MB)
**Test downloading a medium file with multiple segments.**

1. Find a file of 1-50MB (e.g., video, compressed file)
2. Right-click → Download with MyDM
3. Observe 8 parallel segments downloading

**Expected Result:**
- Download uses multiple threads (visible in task manager)
- Progress updates frequently
- Speed shows as KB/s or MB/s
- File downloads correctly

**Verify with:**
```powershell
# Check downloads folder
ls "$env:USERPROFILE\Downloads" | Sort-Object LastWriteTime -Descending | Select-Object Name, Length
```

### Test 9: Pause/Resume Functionality
**Test pausing and resuming downloads.**

1. Start a large download
2. Click **Pause** button when progress is 20-50%
3. Status should change to "PAUSED"
4. Click **Resume** button
5. Download continues from where it stopped

**Expected Result:**
- Download pauses immediately
- No disk activity when paused
- Resume continues download
- Final file is valid

**Logs should show:**
- "Paused: [download_id]"
- "Resumed: [download_id]"

### Test 10: Cancel Functionality
**Test canceling a download.**

1. Start a download
2. Click **Cancel** button
3. Confirm cancellation in dialog

**Expected Result:**
- Download stops immediately
- Status changes to "CANCELLED"
- Temporary files cleaned up (no .part files remain)
- Download removed from list after a while

**Verify cleanup:**
```powershell
# Check for orphaned .part files
ls "$env:USERPROFILE\Downloads" | Where-Object Name -Like "*.part*"
```

## 🔄 State Management Tests

### Test 11: Multiple Concurrent Downloads
**Test downloading multiple files simultaneously.**

1. Start 3 different downloads at once
2. Pause one, continue others
3. Cancel one, let others complete

**Expected Result:**
- All download streams work independently
- No interference between downloads
- Each has its own progress bar
- Status changes reflect each file's state

### Test 12: Extension Popup Updates
**Test real-time UI updates.**

1. Start a download
2. Click MyDM icon to open popup
3. Close and reopen popup multiple times
4. Verify progress updates in real-time

**Expected Result:**
- Popup refreshes every 500ms
- Progress percentages update smoothly
- Speed shows current rate
- Status reflects actual download state

## ⚠️ Error Handling Tests

### Test 13: Invalid URL
**Test handling of invalid URLs.**

1. Get a non-existent URL from a website
2. Try to download with MyDM
3. Observe error handling

**Expected Result:**
- Error message appears in popup
- Status shows "ERROR"
- Error message is descriptive
- Extension remains stable

**Check logs for:**
```
Failed to get file info: [reason]
```

### Test 14: Network Interruption
**Test behavior when network fails during download.**

*Option 1: Disable WiFi*
1. Start a download
2. Immediately disconnect network
3. Observe timeout behavior

*Option 2: Server failure*
1. Start downloading from a test server
2. Stop the server during download

**Expected Result:**
- Download times out gracefully
- Error message displayed
- No crash or hang
- Logs show timeout error

### Test 15: Disk Space Issues
**Test handling of insufficient disk space.**

1. Fill Downloads folder until ~100MB free
2. Try to download a 200MB file
3. Observe error handling

**Expected Result:**
- Download fails gracefully
- Error message explains disk space
- Status shows "ERROR"
- Application remains responsive

## 📊 Performance Tests

### Test 16: Download Speed Verification
**Verify multi-threaded downloads are faster than single-thread.**

Download same file twice:
1. With 8 threads (MyDM default)
2. With 1 thread (edit downloader.py)

Compare times:
- 8 threads should be noticeably faster
- Speed should increase by 3-6x on good connections

### Test 17: CPU Usage Check
**Monitor CPU during downloads.**

1. Open Task Manager
2. Start a large MyDM download
3. Check Python.exe CPU usage

**Expected Result:**
- CPU usage 20-40% for multi-threaded download
- Not maxed out at 100%
- System remains responsive

### Test 18: Memory Stability
**Check for memory leaks during long downloads.**

1. Download a very large file (500MB+)
2. Monitor Memory column in Task Manager
3. Watch for continuous growth

**Expected Result:**
- Memory usage stable
- No continuous increase over time
- Memory released after completion

## 🔒 Security Tests

### Test 19: Extension Isolation
**Verify extension can't access arbitrary files.**

Try to download:
1. Local file paths (file://)
2. system32 paths
3. Other user profiles

**Expected Result:**
- Only HTTP/HTTPS URLs work
- Local files rejected
- System files protected

### Test 20: Native Messaging Security
**Verify only authorized extension can communicate.**

1. Note the Extension ID
2. Change Extension ID in manifest to wrong value
3. Try to use context menu

**Expected Result:**
- Native host refuses connection
- Error in logs: "Unauthorized origin"
- Connection rejected

## 📋 Browser Compatibility Tests

### Test 21: Chrome Browser
```
Chrome Version: [Check Help → About]
Status: [ ] Pass [ ] Fail
Notes: _______________________________
```

### Test 22: Edge Browser
```
Edge Version: [Check ... → About Microsoft Edge]
Status: [ ] Pass [ ] Fail
Notes: _______________________________
```

## 📝 Logging & Debugging

### Enable Verbose Logging
Edit `mydm_host.py` and `downloader.py` to add print statements:

```python
import sys
def debug_log(msg):
    print(f"[DEBUG] {msg}", file=sys.stderr)
```

View logs:
```powershell
# Real-time log viewing
Get-Content "$env:APPDATA\Local\MyDM\host.log" -Wait
```

## 🎯 Final Acceptance Tests

| Test | Result | Notes |
|------|--------|-------|
| Context menu appears | ✓ / ✗ | |
| Small file downloads | ✓ / ✗ | |
| Large file multi-threaded | ✓ / ✗ | |
| Pause/Resume works | ✓ / ✗ | |
| Cancel works | ✓ / ✗ | |
| Multiple downloads | ✓ / ✗ | |
| UI updates in real-time | ✓ / ✗ | |
| Errors handled gracefully | ✓ / ✗ | |
| Speed ~6x faster than single | ✓ / ✗ | |
| No memory leaks | ✓ / ✗ | |

## ✅ Ready for Production?

Once all tests pass, MyDM is ready to use!

**Create a backup:**
```powershell
Copy-Item -Path "C:\Users\YourUsername\MyDM" -Destination "C:\Users\YourUsername\MyDM_backup" -Recurse
```

**Monitor first week:**
- Check host.log weekly for errors
- Report any issues
- Disable and restart if problems occur

## 🐛 Bug Reporting Template

```
**Environment:**
- Windows Version: 
- Python Version: 
- Chrome/Edge Version: 
- MyDM Version: 1.0

**Issue:**
[Description of problem]

**Steps to Reproduce:**
1. 
2. 
3. 

**Expected Result:**
[What should happen]

**Actual Result:**
[What actually happened]

**Logs:**
[Contents of host.log]

**Screenshots:**
[If applicable]
```

---

**All tests passing? You're ready to download!** 🚀
