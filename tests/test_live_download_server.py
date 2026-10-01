import hashlib
import http.server
import re
import socketserver
import threading
import time
from pathlib import Path
import pytest

from downloader import DownloadManager

TEST_DATA = b"MyDM-Test-Payload-" * 100000  # ~1.8 MB to trigger multi-segment downloading (> 1MB)
TEST_SHA256 = hashlib.sha256(TEST_DATA).hexdigest()

class RangeRequestHandler(http.server.BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        pass  # Suppress server logs during tests

    def do_HEAD(self):
        if self.path == '/non-resumable':
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(TEST_DATA)))
            self.send_header('Content-Disposition', 'attachment; filename="non_resumable.dat"')
            self.end_headers()
            return

        self.send_response(200)
        self.send_header('Content-Type', 'application/octet-stream')
        self.send_header('Content-Length', str(len(TEST_DATA)))
        self.send_header('Accept-Ranges', 'bytes')
        self.send_header('Content-Disposition', 'attachment; filename="test_large.dat"')
        self.end_headers()

    def do_GET(self):
        range_header = self.headers.get('Range')
        
        if self.path == '/non-resumable' or not range_header:
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(TEST_DATA)))
            if self.path != '/non-resumable':
                self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()
            self.wfile.write(TEST_DATA)
            return

        # Parse range header: Range: bytes=start-end
        match = re.match(r'bytes=(\d+)-(\d*)', range_header)
        if match:
            start = int(match.group(1))
            end = int(match.group(2)) if match.group(2) else len(TEST_DATA) - 1
            end = min(end, len(TEST_DATA) - 1)
            chunk = TEST_DATA[start:end + 1]

            self.send_response(206)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Range', f'bytes {start}-{end}/{len(TEST_DATA)}')
            self.send_header('Content-Length', str(len(chunk)))
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()
            self.wfile.write(chunk)
        else:
            self.send_response(400)
            self.end_headers()

@pytest.fixture(scope="module")
def local_http_server():
    server = socketserver.ThreadingTCPServer(('127.0.0.1', 0), RangeRequestHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    server.server_close()

def test_live_multi_segment_download(local_http_server, tmp_path):
    dm = DownloadManager(download_dir=str(tmp_path), num_threads=4)
    completed_event = threading.Event()
    completed_info = {}

    def on_complete(dl_id, filename, file_path):
        completed_info['file_path'] = file_path
        completed_event.set()

    def on_error(dl_id, error):
        completed_info['error'] = error
        completed_event.set()

    url = f"{local_http_server}/test_large.dat"
    dl_id = dm.start_download(url=url, on_complete=on_complete, on_error=on_error)
    
    assert completed_event.wait(timeout=10), "Download timed out"
    assert 'error' not in completed_info, f"Download failed: {completed_info.get('error')}"
    
    downloaded_file = Path(completed_info['file_path'])
    assert downloaded_file.exists()
    assert downloaded_file.stat().st_size == len(TEST_DATA)
    
    downloaded_hash = hashlib.sha256(downloaded_file.read_bytes()).hexdigest()
    assert downloaded_hash == TEST_SHA256

def test_live_non_resumable_fallback(local_http_server, tmp_path):
    dm = DownloadManager(download_dir=str(tmp_path), num_threads=4)
    completed_event = threading.Event()
    completed_info = {}

    def on_complete(dl_id, filename, file_path):
        completed_info['file_path'] = file_path
        completed_event.set()

    url = f"{local_http_server}/non-resumable"
    dl_id = dm.start_download(url=url, on_complete=on_complete)

    assert completed_event.wait(timeout=10), "Download timed out"
    downloaded_file = Path(completed_info['file_path'])
    assert downloaded_file.exists()
    assert downloaded_file.stat().st_size == len(TEST_DATA)
    assert hashlib.sha256(downloaded_file.read_bytes()).hexdigest() == TEST_SHA256

def test_live_cancel_download(local_http_server, tmp_path):
    dm = DownloadManager(download_dir=str(tmp_path), num_threads=2)
    error_event = threading.Event()
    error_info = {}

    def on_error(dl_id, error):
        error_info['error'] = error
        error_event.set()

    url = f"{local_http_server}/test_large.dat"
    dl_id = dm.start_download(url=url, on_error=on_error)
    # Cancel download immediately
    dm.cancel_download(dl_id)

    assert error_event.wait(timeout=5), "Error callback not called on cancel"
    assert "cancel" in error_info.get('error', '').lower()

