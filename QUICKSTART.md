# MyDM - Quick Start Guide

## 🚀 Get Started in 5 Minutes

### Prerequisites
- Windows 10/11
- Python 3.7+ (check: `python --version`)
- Chrome or Edge browser

### Installation

#### 1️⃣ Install Python Dependencies
```powershell
pip install requests
```

#### 2️⃣ Load the Extension
1. Go to `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension` folder
5. **Copy the Extension ID** shown (you'll need this)

#### 3️⃣ Configure Native Messaging

**Edit** `python_app/com.mydm.native.json`:
```json
{
  "name": "com.mydm.native",
  "description": "MyDM Python Native Host for Chrome Extension",
  "path": "C:\\Users\\YourUsername\\MyDM\\python_app\\mydm_host.py",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID_HERE/"
  ]
}
```

Replace:
- `C:\Users\YourUsername\MyDM\python_app\mydm_host.py` with actual path (use `\\`)
- `YOUR_EXTENSION_ID_HERE` with Extension ID from step 2

#### 4️⃣ Register in Windows Registry

1. Press `Win + R`, type `regedit`, press Enter
2. Navigate to: `HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts`
   - (For Edge: use `Microsoft\Edge\NativeMessagingHosts`)
3. Right-click → New → Key → Name: `com.mydm.native`
4. Right-click the key → New → String Value
5. Set value to: `C:\Users\YourUsername\MyDM\python_app\com.mydm.native.json`
6. Click OK, restart Chrome

#### 5️⃣ Test Connection

1. Go to `chrome://extensions/`
2. Find MyDM, click **Details** → **Inspect views** → **service_worker**
3. In console, paste:
   ```javascript
   chrome.runtime.connectNative('com.mydm.native')
   ```
4. No errors = ✅ Success!

### 🎯 Usage

1. Right-click any file link, image, video, or audio
2. Select **"Download with MyDM"**
3. Click the MyDM icon to view progress
4. Use Pause/Resume/Cancel buttons

## 📍 File Locations

| Item | Location |
|------|----------|
| Downloads saved | `C:\Users\YourUsername\Downloads` |
| Debug logs | `C:\Users\YourUsername\AppData\Local\MyDM\host.log` |
| Python script | `python_app/mydm_host.py` |
| Chrome Extension | `extension/` folder |

## 🛠️ Common Issues

| Problem | Solution |
|---------|----------|
| "Native host not available" | Restart Chrome, check Registry settings |
| Python not found | Add Python to PATH, restart PowerShell |
| Extension won't load | Check manifest.json syntax |
| No context menu | Reload extension from `chrome://extensions/` |
| 0% download stuck | Server doesn't support ranges (will complete as single file) |

## 📝 Edit Paths (Optional)

### Change Download Directory
Edit `python_app/mydm_host.py` line 28:
```python
downloads_dir = str(Path.home() / 'Downloads')  # Change 'Downloads' to desired folder
```

### Change Number of Threads
Edit `python_app/mydm_host.py` line 32:
```python
self.download_manager = DownloadManager(
    download_dir=downloads_dir,
    num_threads=16  # Change 8 to your preferred number
)
```

## 🔍 Debug

View logs to troubleshoot:
```powershell
# Windows PowerShell
cat "$env:APPDATA\Local\MyDM\host.log"

# Or use Notepad
notepad "$env:APPDATA\Local\MyDM\host.log"
```

## ✅ Verify Everything Works

**Test download:**
1. Find a test file online
2. Right-click → Download with MyDM
3. Watch progress in MyDM popup
4. Check Downloads folder when complete

**Expected flow:**
- Download starts → Shows 0%
- Progress increases → Shows speed
- Reaches 100% → File appears in Downloads

## 🎓 How It Works

```
User right-clicks link
    ↓
Chrome Extension detects click
    ↓
Sends URL to Python via native messaging
    ↓
Python app downloads file in 8 parallel segments
    ↓
Segments merge into final file
    ↓
Progress updates sent back to extension
    ↓
UI shows real-time status
```

## 📞 Need Help?

1. Check the full README.md for detailed setup
2. Review debug logs in `AppData\Local\MyDM\host.log`
3. Verify all Registry entries match config
4. Ensure Python can run: `python mydm_host.py`

---

**Ready?** Start downloading! 🚀
