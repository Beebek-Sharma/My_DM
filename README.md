# MyDM - My Download Manager

A Chrome extension that integrates with a local Python application to provide IDM-like multi-threaded, segmented downloads with pause/resume capabilities.

## 🚀 Features

- **Multi-threaded Downloads**: Split files into segments and download concurrently (8 threads by default)
- **Pause/Resume**: Pause downloads and resume them later
- **Cancel Downloads**: Stop any active download
- **Progress Tracking**: Real-time speed, percentage, and size information
- **Context Menu Integration**: Right-click any file to download with MyDM
- **Smart Filename Detection**: Automatically extracts filenames from Content-Disposition headers
- **Range Request Support**: Downloads only resume if the server supports range requests

## 📋 Project Structure

```
MyDM/
├─ extension/
│  ├─ manifest.json           # Chrome extension manifest (Manifest V3)
│  ├─ background.js           # Background service worker
│  ├─ popup.html              # Popup UI
│  ├─ popup.js                # Popup JavaScript logic
│  └─ icon48.png              # Extension icon
├─ python_app/
│  ├─ mydm_host.py            # Native messaging host
│  ├─ downloader.py           # Download manager logic
│  └─ com.mydm.native.json    # Native messaging configuration
└─ README.md                  # This file
```

## ⚙️ Prerequisites

### For Windows

- **Python 3.7 or higher** (with pip)
- **Chrome or Edge browser** (must support Manifest V3)
- **Python packages** from `requirements.txt` (includes `requests` and `yt-dlp`)

### Installation

1. **Install Python** (if not already installed)
   - Download from https://www.python.org/downloads/
   - During installation, check "Add Python to PATH"

2. **Install required Python packages:**

```powershell
python -m pip install -r requirements.txt
```

## 🔧 Setup Instructions

### Step 1: Get the Full Path to mydm_host.py

1. Extract the MyDM project to a permanent location (e.g., `C:\Users\YourUsername\MyDM`)
2. Open PowerShell and navigate to the python_app folder:
   ```powershell
   cd "C:\Users\YourUsername\MyDM"
   python_app\start_host.bat
   ```
3. If there's no error, note the full path to `python_app\\start_host.bat`. Press `Ctrl+C` to stop.

### Step 2: Load the Chrome Extension

1. Open Chrome or Edge
2. Go to: `chrome://extensions/` (or `edge://extensions/`)
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Navigate to the `extension/` folder inside your MyDM project
6. The extension should appear in your list

**⚠️ Important:** Note the **Extension ID** shown (e.g., `pbcdefghijklmnopqrstuvwxyz123456`)

### Step 3: Configure the Native Messaging Manifest

1. Open the file: `python_app/com.mydm.native.json`
2. Replace `C:\Path\To\MyDM\python_app\start_host.bat` with your actual path (use backslashes: `\\`)
3. Replace `REPLACE_WITH_YOUR_EXTENSION_ID` with the Extension ID from Step 2

**Example:**
```json
{
  "name": "com.mydm.native",
  "description": "MyDM Python Native Host for Chrome Extension",
   "path": "C:\\Users\\YourUsername\\MyDM\\python_app\\start_host.bat",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://pbcdefghijklmnopqrstuvwxyz123456/"
  ]
}
```

### Step 4: Register the Native Messaging Manifest in Windows Registry

1. **Open Registry Editor** (press `Win + R`, type `regedit`, press Enter)

2. Navigate to:
   ```
   HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts
   ```
   (For Edge, use: `HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts`)

3. Right-click in the empty space → **New** → **Key**

4. Name the key: `com.mydm.native`

5. Right-click the new key → **New** → **String Value**

6. Name it: `(Default)` (or just leave empty for default)

7. Double-click the value and paste the full path to `com.mydm.native.json`:
   ```
   C:\Users\YourUsername\MyDM\python_app\com.mydm.native.json
   ```

8. Click OK and close Registry Editor

### Step 5: Test the Connection

1. Go back to `chrome://extensions/`
2. Find the MyDM extension
3. Click **Details** → **Inspect views** → **service_worker**
4. In the DevTools console, type:
   ```javascript
   chrome.runtime.connectNative('com.mydm.native')
   ```
5. If successful, you should see a connection with no errors
6. Close the DevTools

### Step 6: Start Using MyDM

1. Right-click any link, image, video, or audio file on a webpage
2. Select **"Download with MyDM"**
3. Click the MyDM icon in Chrome to see the download progress
4. Use Pause, Resume, or Cancel buttons as needed

## 📊 How It Works

### Architecture

1. **Chrome Extension (frontend)**
   - Adds context menu option
   - Communicates with Python via native messaging
   - Shows real-time download progress in a popup

2. **Python Native Host (backend)**
   - Listens for messages from Chrome
   - Manages downloads using the DownloadManager
   - Sends progress updates back to Chrome via JSON

3. **DownloadManager (core logic)**
   - Splits files into segments (8 by default)
   - Uses ThreadPoolExecutor for parallel downloads
   - Handles pause/resume by monitoring shared state
   - Merges segments after completion

### Message Protocol

All communication uses JSON via Chrome's native messaging protocol:

**Download Request:**
```json
{
  "command": "download",
  "url": "https://example.com/file.zip",
  "referer": "https://example.com/"
}
```

**Progress Update:**
```json
{
  "event": "progress",
  "id": "abc123def456",
  "filename": "file.zip",
  "percent": 45,
  "speed": "2.4 MB/s",
  "size": 104857600,
  "downloaded": 47185920
}
```

**Completion:**
```json
{
  "event": "complete",
  "id": "abc123def456",
  "filename": "file.zip",
  "file": "C:\\Users\\YourUsername\\Downloads\\file.zip",
  "percent": 100
}
```

**Error:**
```json
{
  "event": "error",
  "id": "abc123def456",
  "error": "Connection timeout"
}
```

## 🔍 Troubleshooting

### Extension not showing context menu
- Ensure the extension is enabled in `chrome://extensions/`
- Reload the page (Ctrl+Shift+R)

### "Native host not available" error
- Check that `com.mydm.native.json` is registered in Registry
- Verify the path in the Registry matches the actual file location
- Restart Chrome after Registry changes

### Python script not starting
- Make sure Python is in your PATH: `python --version` in PowerShell
- Check that `requests` library is installed: `pip list | grep requests`
- Look for error logs in: `C:\Users\YourUsername\AppData\Local\MyDM\host.log`

### Downloads not appearing
- Open Chrome DevTools (F12) → Console
- Check for any error messages
- Ensure the Downloads folder exists and is writable

### Files are saved to the wrong location
- Edit `mydm_host.py` line 28 to change the download directory:
  ```python
  downloads_dir = str(Path.home() / 'Downloads')  # Change this path
  ```

## 🛠️ Advanced Configuration

### Change Number of Download Threads

Edit `python_app/mydm_host.py` line 32:
```python
self.download_manager = DownloadManager(
    download_dir=downloads_dir,
    num_threads=16  # Change from 8 to your desired number
)
```

### Change Minimum File Size for Segmented Downloads

Edit `python_app/downloader.py` line 210:
```python
if file_size < 1024 * 1024:  # 1MB - change this value
```

### View Debug Logs

Logs are saved to: `C:\Users\YourUsername\AppData\Local\MyDM\host.log`

## 🚨 Common Issues & Solutions

| Issue | Cause | Solution |
|-------|-------|----------|
| "Unknown command: download" | Native host not running | Restart Chrome |
| Download stops at 0% | Server doesn't support ranges | File will download as single segment |
| "Failed to get file info" | URL is invalid or server unreachable | Check URL in browser |
| Registry key not found | Using wrong registry path | Use `HKEY_CURRENT_USER` not `HKEY_LOCAL_MACHINE` |
| Extension crashes after download | Python process crashed | Check `host.log` for errors |

## 📦 Dependencies

- **Python 3.7+**: Core runtime
- **requests**: HTTP library for downloads
- **concurrent.futures**: Multi-threading (built-in)
- **threading**: Thread management (built-in)
- **struct**: Binary protocol handling (built-in)
- **json**: JSON parsing (built-in)

## 🔐 Security Notes

- Downloads are stored locally only
- No internet APIs are used
- Native messaging only communicates with allowed Chrome extension
- File paths are validated before use
- User agent is set to identify as MyDM client

## 📝 License

This project is provided as-is for local use.

## 🎯 Future Enhancements

- [ ] Download history/queue
- [ ] Configurable download location via UI
- [ ] Bandwidth throttling
- [ ] Download scheduling
- [ ] Integration with more browsers
- [ ] Improved error recovery

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review debug logs in `C:\Users\YourUsername\AppData\Local\MyDM\host.log`
3. Ensure all steps in the setup guide were followed correctly
4. Check that file permissions allow write access to Downloads folder

---

**MyDM v1.0** - Build your own IDM-like downloader! 🚀
