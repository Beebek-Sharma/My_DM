"""
MyDM Standalone Desktop Application
Powered by pywebview (Edge WebView2) and the Python Multi-Segment & Streaming Engine
"""

import os
import sys
import json
import time
import uuid
import threading
import subprocess
from pathlib import Path
from typing import Dict, Any, List, Optional

try:
    import webview
except ImportError:
    print("pywebview is required to run the desktop application. Install via: pip install pywebview")
    sys.exit(1)

from python_app.downloader import DownloadManager, StreamingDownloadManager, sanitize_filename

# Paths
APP_DIR = Path(__file__).resolve().parent
UI_DIR = APP_DIR / "ui"
STATE_FILE = Path(os.path.expanduser("~/.mydm/desktop_state.json"))
STATE_FILE.parent.mkdir(parents=True, exist_ok=True)


class DesktopApi:
    """Python API exposed to the JavaScript Cyber Telemetry frontend"""

    def __init__(self):
        self.downloads: Dict[str, Dict[str, Any]] = {}
        self.settings: Dict[str, Any] = {
            "download_dir": str(Path(os.path.expanduser("~/Downloads/MyDM")).resolve()),
            "max_concurrent": 5,
            "default_threads": 8,
            "auto_categorize": True,
            "category_folders": True,
            "completion_sound": True,
            "system_notify": True,
            "conflict_action": "uniquify"
        }
        self.load_state()

        # Initialize engines
        self.download_dir = Path(self.settings.get("download_dir", os.path.expanduser("~/Downloads/MyDM")))
        self.download_dir.mkdir(parents=True, exist_ok=True)

        self.seg_manager = DownloadManager(
            download_dir=str(self.download_dir),
            num_threads=self.settings.get("default_threads", 8)
        )
        self.stream_manager = StreamingDownloadManager(download_dir=str(self.download_dir))
        self.active_threads = {}
        self.lock = threading.Lock()

    def load_state(self):
        """Load persistent downloads and settings from disk"""
        if STATE_FILE.exists():
            try:
                with open(STATE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    self.downloads = data.get("downloads", {})
                    self.settings.update(data.get("settings", {}))
            except Exception as e:
                print(f"[MyDM Desktop] Failed to load state: {e}")

    def save_state(self):
        """Persist state to disk"""
        try:
            with open(STATE_FILE, "w", encoding="utf-8") as f:
                json.dump({
                    "downloads": self.downloads,
                    "settings": self.settings
                }, f, indent=2)
        except Exception as e:
            print(f"[MyDM Desktop] Failed to save state: {e}")

    def get_state(self) -> Dict[str, Any]:
        """Return current downloads list and engine settings to UI"""
        with self.lock:
            items = list(self.downloads.values())
            # Sort newest first
            items.sort(key=lambda x: x.get("created_at", 0), reverse=True)
            return {
                "success": True,
                "downloads": items,
                "settings": self.settings
            }

    def choose_directory(self) -> Optional[str]:
        """Open native OS folder picker dialog"""
        try:
            window = webview.active_window()
            if window:
                result = window.create_file_dialog(webview.FOLDER_DIALOG)
                if result and len(result) > 0:
                    selected = result[0]
                    self.settings["download_dir"] = selected
                    self.save_state()
                    return selected
        except Exception as e:
            print(f"[MyDM Desktop] Folder dialog error: {e}")
        return None

    def save_settings(self, new_settings: Dict[str, Any]) -> Dict[str, Any]:
        """Update desktop application settings"""
        with self.lock:
            self.settings.update(new_settings)
            self.save_state()
        return {"success": True, "settings": self.settings}

    def is_streaming_url(self, url: str) -> bool:
        """Check if URL belongs to a streaming service"""
        return self.stream_manager.is_streaming_url(url)

    def get_formats(self, url: str) -> Dict[str, Any]:
        """Query streaming formats via yt-dlp"""
        return self.stream_manager.get_formats(url)

    def get_playlist_info(self, url: str) -> Dict[str, Any]:
        """Extract playlist entries via yt-dlp"""
        return self.stream_manager.get_playlist_info(url)

    def create_download(
        self,
        url: str,
        filename: str = "",
        threads: int = 8,
        format_spec: Optional[str] = None,
        audio_only: bool = False,
        quality: Optional[str] = None
    ) -> Dict[str, Any]:
        """Create and start a new download"""
        url = (url or "").strip()
        if not url:
            return {"success": False, "error": "URL cannot be empty"}

        download_id = f"dl_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}"
        is_stream = self.is_streaming_url(url)

        item = {
            "id": download_id,
            "url": url,
            "filename": filename or "Detecting...",
            "status": "STARTING",
            "percent": 0.0,
            "downloaded_bytes": 0,
            "total_bytes": 0,
            "speed": 0,
            "speed_formatted": "0.0 MB/s",
            "eta": None,
            "is_stream": is_stream,
            "threads": threads or 8,
            "format_spec": format_spec,
            "audio_only": audio_only,
            "quality": quality,
            "category": "Other",
            "created_at": time.time(),
            "completed_at": None,
            "file_path": None,
            "error": None
        }

        with self.lock:
            self.downloads[download_id] = item
            self.save_state()

        # Launch download in background thread
        t = threading.Thread(
            target=self._execute_download,
            args=(download_id,),
            daemon=True
        )
        t.start()
        self.active_threads[download_id] = t

        return {"success": True, "download": item}

    def _execute_download(self, download_id: str):
        """Worker thread to run direct or streaming download"""
        item = self.downloads.get(download_id)
        if not item:
            return

        url = item["url"]
        is_stream = item.get("is_stream", False)
        target_dir = Path(self.settings.get("download_dir", os.path.expanduser("~/Downloads/MyDM")))
        target_dir.mkdir(parents=True, exist_ok=True)

        def progress_cb(dl_id, fname, percent, speed_str, total_sz, dl_sz):
            with self.lock:
                rec = self.downloads.get(dl_id)
                if rec:
                    if fname and rec["filename"] == "Detecting...":
                        rec["filename"] = fname
                    rec["status"] = "DOWNLOADING"
                    rec["percent"] = round(percent, 1)
                    rec["speed_formatted"] = speed_str
                    rec["total_bytes"] = total_sz
                    rec["downloaded_bytes"] = dl_sz
            self._notify_ui()

        def complete_cb(dl_id, fname, final_path):
            with self.lock:
                rec = self.downloads.get(dl_id)
                if rec:
                    rec["status"] = "COMPLETED"
                    rec["percent"] = 100.0
                    rec["filename"] = fname
                    rec["file_path"] = str(final_path)
                    rec["completed_at"] = time.time()
                    rec["speed_formatted"] = "✓ Complete"
                    rec["error"] = None
                self.save_state()
            self._notify_ui()

        def error_cb(dl_id, err_msg):
            with self.lock:
                rec = self.downloads.get(dl_id)
                if rec:
                    rec["status"] = "FAILED"
                    rec["error"] = str(err_msg)
                self.save_state()
            self._notify_ui()

        try:
            if is_stream:
                self.stream_manager.download(
                    url=url,
                    download_id=download_id,
                    audio_only=item.get("audio_only", False),
                    format_spec=item.get("format_spec"),
                    output_template=f"{item.get('filename')}" if item.get('filename') != "Detecting..." else None,
                    on_progress=progress_cb,
                    on_complete=complete_cb,
                    on_error=error_cb
                )
            else:
                # Segmented HTTP download
                try:
                    file_info = self.seg_manager.get_file_info(url)
                    real_filename = file_info.get("filename") or sanitize_filename(item.get("filename") or "download")
                    with self.lock:
                        item["filename"] = real_filename
                        item["total_bytes"] = file_info.get("size", 0)

                    out_file = str(target_dir / real_filename)
                    self.seg_manager.download(
                        url=url,
                        output_file=out_file,
                        download_id=download_id,
                        on_progress=progress_cb,
                        on_complete=complete_cb,
                        on_error=error_cb
                    )
                except Exception as ex:
                    error_cb(download_id, str(ex))

        except Exception as e:
            error_cb(download_id, str(e))

    def _notify_ui(self):
        """Optionally push state update to frontend"""
        try:
            window = webview.active_window()
            if window:
                # Trigger frontend refresh
                window.evaluate_js("if (window.onDesktopStateUpdated) window.onDesktopStateUpdated();")
        except Exception:
            pass

    def pause_download(self, download_id: str) -> Dict[str, Any]:
        """Pause an active download"""
        with self.lock:
            rec = self.downloads.get(download_id)
            if rec:
                rec["status"] = "PAUSED"
                self.save_state()
        if hasattr(self.seg_manager, "pause_download"):
            self.seg_manager.pause_download(download_id)
        self._notify_ui()
        return {"success": True}

    def resume_download(self, download_id: str) -> Dict[str, Any]:
        """Resume a paused download"""
        with self.lock:
            rec = self.downloads.get(download_id)
            if rec:
                rec["status"] = "RESUMING"
                self.save_state()

        t = threading.Thread(target=self._execute_download, args=(download_id,), daemon=True)
        t.start()
        self.active_threads[download_id] = t
        return {"success": True}

    def cancel_download(self, download_id: str) -> Dict[str, Any]:
        """Cancel an ongoing download"""
        with self.lock:
            rec = self.downloads.get(download_id)
            if rec:
                rec["status"] = "CANCELLED"
                self.save_state()

        if hasattr(self.stream_manager, "cancel_download"):
            self.stream_manager.cancel_download(download_id)
        if hasattr(self.seg_manager, "cancel_download"):
            self.seg_manager.cancel_download(download_id)

        self._notify_ui()
        return {"success": True}

    def delete_download(self, download_id: str) -> Dict[str, Any]:
        """Delete download from history"""
        self.cancel_download(download_id)
        with self.lock:
            self.downloads.pop(download_id, None)
            self.save_state()
        self._notify_ui()
        return {"success": True}

    def show_in_folder(self, download_id: str) -> Dict[str, Any]:
        """Reveal downloaded file in Windows File Explorer"""
        rec = self.downloads.get(download_id)
        if rec and rec.get("file_path") and os.path.exists(rec["file_path"]):
            target = os.path.normpath(rec["file_path"])
            subprocess.Popen(f'explorer /select,"{target}"')
            return {"success": True}
        else:
            folder = self.settings.get("download_dir", os.path.expanduser("~/Downloads/MyDM"))
            if os.path.exists(folder):
                subprocess.Popen(f'explorer "{folder}"')
                return {"success": True}
        return {"success": False, "error": "File or folder not found"}

    def open_file(self, download_id: str) -> Dict[str, Any]:
        """Open downloaded file with default application"""
        rec = self.downloads.get(download_id)
        if rec and rec.get("file_path") and os.path.exists(rec["file_path"]):
            os.startfile(os.path.normpath(rec["file_path"]))
            return {"success": True}
        return {"success": False, "error": "File does not exist"}

    def clear_completed(self) -> Dict[str, Any]:
        """Remove completed entries from view"""
        with self.lock:
            self.downloads = {k: v for k, v in self.downloads.items() if v.get("status") != "COMPLETED"}
            self.save_state()
        self._notify_ui()
        return {"success": True}

    def clear_all(self) -> Dict[str, Any]:
        """Clear all entries"""
        with self.lock:
            for dl_id in list(self.downloads.keys()):
                self.cancel_download(dl_id)
            self.downloads.clear()
            self.save_state()
        self._notify_ui()
        return {"success": True}


def main():
    """Launch MyDM Desktop Window"""
    api = DesktopApi()
    index_file = (UI_DIR / "desktop.html").resolve()

    if not index_file.exists():
        print(f"Error: UI file not found at {index_file}")
        sys.exit(1)

    window = webview.create_window(
        title="MyDM - Cyber Telemetry Download Manager",
        url=f"file:///{str(index_file).replace('\\', '/')}",
        js_api=api,
        width=1040,
        height=720,
        min_size=(760, 520),
        background_color="#0d1320"
    )

    webview.start(debug=False)


if __name__ == "__main__":
    main()
