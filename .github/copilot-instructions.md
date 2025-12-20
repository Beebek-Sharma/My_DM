# Copilot Instructions for MyDM

## Overview
MyDM is a Chrome extension integrated with a Python backend for multi-threaded, segmented downloads. The architecture consists of:
- **extension/**: Chrome extension (Manifest V3) with UI and background logic
- **python_app/**: Python native messaging host and download manager

## Architecture & Data Flow
- Chrome extension sends download requests to Python via native messaging (see `com.mydm.native.json` for config)
- Python backend (`mydm_host.py`, `downloader.py`) manages downloads, splitting files into segments (default: 8 threads)
- Progress and completion events are sent back to the extension as JSON

## Key Files & Patterns
- `extension/background.js`: Handles context menu, messaging, and download triggers
- `extension/popup.js` & `popup.html`: UI for download progress and controls
- `python_app/mydm_host.py`: Entry point for native messaging, manages download lifecycle
- `python_app/downloader.py`: Implements segmented download logic
- `python_app/com.mydm.native.json`: Native messaging manifest (update path and extension ID for local setup)

## Developer Workflows
- **Setup**: Follow README for registry and manifest configuration
- **Run Python Host**: `python python_app/mydm_host.py` (ensure `requests` is installed)
- **Extension Dev**: Load `extension/` as unpacked in Chrome/Edge
- **Debugging**: Logs at `C:\Users\<username>\AppData\Local\MyDM\host.log`
- **Change Download Directory**: Edit `downloads_dir` in `mydm_host.py`
- **Change Threads**: Edit `num_threads` in `mydm_host.py`
- **Change Segment Threshold**: Edit file size check in `downloader.py`

## Conventions & Integration
- All cross-component communication uses JSON (see README for message formats)
- Registry setup is required for native messaging (see README)
- Only the specified extension ID can communicate with the Python host
- DownloadManager uses ThreadPoolExecutor for concurrency

## Troubleshooting
- See README for common issues and solutions
- Check registry and manifest paths if native messaging fails
- Use Chrome DevTools for extension debugging

## Examples
- Download request:
  ```json
  { "command": "download", "url": "https://example.com/file.zip" }
  ```
- Progress event:
  ```json
  { "event": "progress", "percent": 45 }
  ```

## Security
- No external APIs; all downloads are local
- File paths validated before use

---
For more details, see `README.md` and referenced source files.
