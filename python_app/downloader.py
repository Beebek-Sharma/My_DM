"""
MyDM Downloader Module
Handles multi-threaded segmented downloads with pause/resume support
Also supports video streaming sites via yt-dlp
"""

import os
import json
import requests
import sys
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import hashlib
import subprocess
import re
from urllib.parse import urlparse

# --------- Utilities ---------

def sanitize_filename(name: str) -> str:
    try:
        invalid = set('<>:"/\\|?*')
        safe = ''.join('_' if c in invalid else c for c in name)
        safe = re.sub(r'[\x00-\x1f]', '', safe)
        safe = safe.strip().rstrip('. ')
        if not safe:
            safe = 'download'
        if len(safe) > 150:
            base, ext = os.path.splitext(safe)
            safe = (base[:150 - len(ext)]) + ext
        return safe
    except Exception:
        return 'download'

class StreamingDownloadManager:
    """Handles downloads from video streaming platforms using yt-dlp"""

    # Supported streaming platforms
    STREAMING_DOMAINS = {
        'youtube.com', 'youtu.be', 'm.youtube.com',
        'vimeo.com', 'player.vimeo.com',
        'tiktok.com', 'vm.tiktok.com', 'm.tiktok.com',
        'twitter.com', 'x.com', 'mobile.twitter.com',
        'instagram.com', 'm.instagram.com',
        'facebook.com', 'm.facebook.com', 'fb.watch',
        'dailymotion.com',
        'reddit.com', 'v.redd.it',
        'twitch.tv', 'm.twitch.tv',
        'soundcloud.com',
        'bilibili.com', 'b23.tv'
    }

    def __init__(self, download_dir=None):
        """Initialize streaming downloader"""
        self.download_dir = Path(download_dir or os.path.expanduser("~/Downloads"))
        self.download_dir.mkdir(parents=True, exist_ok=True)
        
        # yt-dlp availability will be checked lazily when needed
        self.yt_dlp_available = None

    def _check_yt_dlp(self):
        """Check if yt-dlp is installed and accessible (lazy check)"""
        # Cache only a successful detection. If we previously detected it was missing,
        # re-check on subsequent calls so installing while the host is running works
        # without requiring a full Chrome restart.
        if self.yt_dlp_available is True:
            return True

        # Fast path: module import check (no subprocess)
        try:
            import yt_dlp  # noqa: F401
            self.yt_dlp_available = True
            return True
        except Exception:
            pass
            
        try:
            # Prefer running as a module so we don't depend on PATH.
            result = subprocess.run(
                [sys.executable, '-m', 'yt_dlp', '--version'],
                capture_output=True,
                text=True,
                timeout=10
            )
            if result.returncode == 0:
                self.yt_dlp_available = True
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        try:
            # Fallback to the yt-dlp executable if present on PATH.
            result = subprocess.run(['yt-dlp', '--version'], capture_output=True, text=True, timeout=10)
            if result.returncode == 0:
                self.yt_dlp_available = True
                return True
            return False
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            return False

    def _yt_dlp_cmd(self):
        """Return a command prefix to run yt-dlp reliably."""
        # If installed in the same environment, `python -m yt_dlp` is the most reliable.
        if self._check_yt_dlp():
            return [sys.executable, '-m', 'yt_dlp']
        return ['yt-dlp']

    def _find_cookie_file(self):
        """Look for exported cookies.txt in common locations (Downloads and app directory)."""
        candidates = []
        try:
            home = Path.home()
            dl = home / 'Downloads'
            for name in ['yt_cookies.txt', 'cookies.txt']:
                p = dl / name
                if p.exists():
                    candidates.append(str(p))
            # Wildcard search in Downloads
            for p in dl.glob('*cookies*.txt'):
                candidates.append(str(p))
            # App directory next to this file
            here = Path(__file__).parent
            for name in ['yt_cookies.txt', 'cookies.txt']:
                p = here / name
                if p.exists():
                    candidates.append(str(p))
        except Exception:
            pass
        # Return first existing
        return candidates[0] if candidates else None

    def _detect_cookie_sources(self):
        """Return a list of possible --cookies-from-browser sources based on installed browsers and profiles"""
        sources = []
        try:
            home = Path.home()
            # Chrome profiles
            chrome_base = home / 'AppData' / 'Local' / 'Google' / 'Chrome' / 'User Data'
            if chrome_base.exists():
                for p in chrome_base.iterdir():
                    if p.is_dir() and (p / 'Network' / 'Cookies').exists():
                        sources.append(f'chrome:{p.name}')
                # Fallbacks
                sources.extend(['chrome:Default', 'chrome'])
            # Edge profiles
            edge_base = home / 'AppData' / 'Local' / 'Microsoft' / 'Edge' / 'User Data'
            if edge_base.exists():
                for p in edge_base.iterdir():
                    if p.is_dir() and (p / 'Network' / 'Cookies').exists():
                        sources.append(f'edge:{p.name}')
                sources.extend(['edge:Default', 'edge'])
        except Exception:
            pass
        # Deduplicate while preserving order
        seen = set()
        out = []
        for s in sources:
            if s not in seen:
                seen.add(s)
                out.append(s)
        return out

    @classmethod
    def is_streaming_site(cls, url):
        """Check if URL is from a supported streaming platform"""
        try:
            parsed = urlparse(url)
            domain = parsed.netloc.lower()
            
            # Remove www. prefix if present
            if domain.startswith('www.'):
                domain = domain[4:]
                
            return domain in cls.STREAMING_DOMAINS
        except Exception:
            return False

    def download(self, url, on_progress=None, on_complete=None, on_error=None):
        """Download from streaming site using yt-dlp with cookie fallbacks"""
        download_id = hashlib.md5(url.encode()).hexdigest()[:12]
        
        # Check yt-dlp availability (lazy check)
        if not self._check_yt_dlp():
            error_msg = (
                f"yt-dlp not installed in host Python ({sys.executable}). "
                f"Install with: {sys.executable} -m pip install yt-dlp "
                f"(or: {sys.executable} -m pip install -r requirements.txt)"
            )
            if on_error:
                on_error(download_id, error_msg)
            return None

        def build_cmd(cookies_arg=None):
            base = [
                *self._yt_dlp_cmd(),
                '--no-warnings',
                '--progress',
                '--newline',
                '--no-playlist',  # Force single video extraction (prevents downloading whole playlists)
                '--socket-timeout', '30',  # 30 second socket timeout
                '--extractor-args', 'youtube:player_client=web',  # Use web client to bypass age-gate
                '--extractor-args', 'youtube:skip=dash,hls',  # Skip problematic formats
                '-f', 'b[ext=mp4]/best[ext=mp4]/best',  # Flexible format selection
                '--skip-unavailable-fragments',  # Skip unavailable fragments
                '-o', str(self.download_dir / '%(title)s.%(ext)s')
            ]
            if cookies_arg:
                base.extend(['--cookies-from-browser', cookies_arg])
            base.append(url)
            return base

        # Try multiple cookie sources then fallback to no cookies
        cookie_sources = self._detect_cookie_sources()
        if not cookie_sources:
            cookie_sources = ['chrome:Default', 'chrome', 'edge:Default', 'edge']
        # Try without cookies first (fast path), then browser cookies
        attempts = [None] + cookie_sources
        last_error_text = ''

        for attempt_num, cookies in enumerate(attempts):
            try:
                cmd = build_cmd(cookies)
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    universal_newlines=True
                )
            except Exception as e:
                last_error_text = str(e)
                continue

            filename = "video.mp4"  # Default name
            total_size = 0
            downloaded_size = 0
            last_progress_time = 0
            min_progress_interval = 0.5  # Only report progress every 500ms max
            recent_output = []

            # Monitor progress (yt-dlp progress is typically written to stderr, so we merge stderr->stdout above)
            for line in process.stdout:
                line = line.strip()
                if not line:
                    continue

                # Keep a short tail for error reporting
                if len(recent_output) >= 80:
                    recent_output.pop(0)
                recent_output.append(line)

                # Extract filename from destination line first
                if '[download]' in line and 'Destination:' in line:
                    try:
                        filename = line.split('Destination:')[1].strip()
                        filename = filename.split()[0] if filename else "video.mp4"
                    except:
                        pass

                # Parse progress information
                if '[download]' in line and '%' in line:
                    try:
                        # Extract percentage
                        percent_match = re.search(r'(\d+(?:\.\d+)?)%', line)
                        if percent_match:
                            percent = float(percent_match.group(1))
                        else:
                            percent = 0

                        # Extract size information if available
                        size_match = re.search(r'of\s+(\d+(?:\.\d+)?[KMGT]i?B)', line)
                        if size_match:
                            size_str = size_match.group(1)
                            total_size = self._parse_size(size_str)
                            downloaded_size = int((percent / 100) * total_size) if total_size > 0 else 0

                        # Calculate speed
                        speed = "N/A"
                        speed_match = re.search(r'at\s+(\d+(?:\.\d+)?\w+/s)', line)
                        if speed_match:
                            speed = speed_match.group(1)

                        # Throttle progress updates
                        current_time = time.time()
                        if on_progress and (current_time - last_progress_time) >= min_progress_interval:
                            on_progress(
                                download_id,
                                filename,
                                min(100, max(0, percent)),
                                speed,
                                total_size,
                                downloaded_size
                            )
                            last_progress_time = current_time
                    except Exception as e:
                        continue  # Skip malformed progress lines

            # Wait for process to complete with timeout
            try:
                process.wait(timeout=3600)
            except subprocess.TimeoutExpired:
                process.kill()
                if on_error:
                    on_error(download_id, "Download timeout - took more than 1 hour")
                return None

            if process.returncode == 0:
                time.sleep(1)
                if on_complete:
                    output_file = self._find_downloaded_file(filename)
                    on_complete(download_id, filename, output_file)
                return download_id
            else:
                stderr_output = "\n".join(recent_output[-40:])

                # Log detailed error info
                cookies_str = f"cookies={cookies}" if cookies else "no-cookies"
                error_detail = f"Attempt {attempt_num + 1} failed ({cookies_str}): {stderr_output[:200]}"
                
                last_error_text = stderr_output or f"Return code {process.returncode}"
                
                # If cookie-related error when using a browser cookie source, try next
                if cookies and (
                    'cookies database' in last_error_text.lower() or
                    'dpapi' in last_error_text.lower() or
                    'cookie' in last_error_text.lower()
                ):
                    continue  # try next cookie source
                # If bot-detection without cookies and we have more sources to try, continue
                if (not cookies) and ('sign in to confirm you' in last_error_text.lower()):
                    continue
                # If age restriction without cookies, try with cookies
                if (not cookies) and ('age-restricted' in last_error_text.lower() or 'age restricted' in last_error_text.lower()):
                    continue
                # If access denied/unavailable, still try cookies before giving up
                if (not cookies) and ('not available' in last_error_text.lower() or 'access denied' in last_error_text.lower()):
                    continue
                # Otherwise, break and report
                break

        # As a last resort, try an exported cookies.txt if DPAPI failed
        cookie_file = None
        if last_error_text and ('dpapi' in last_error_text.lower() or 'cookie' in last_error_text.lower()):
            cookie_file = self._find_cookie_file()
        
        if cookie_file:
            try:
                cmd = [
                    *self._yt_dlp_cmd(), '--no-warnings', '--progress', '--newline',
                    '--no-playlist',
                    '--socket-timeout', '30',
                    '--extractor-args', 'youtube:player_client=web',  # Bypass age-gate
                    '-f', 'b[ext=mp4]/best[ext=mp4]/best',  # Flexible format
                    '--skip-unavailable-fragments',
                    '--cookies', cookie_file,
                    '-o', str(self.download_dir / '%(title)s.%(ext)s'),
                    url
                ]
                process = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    universal_newlines=True
                )
                
                last_progress_time = 0
                min_progress_interval = 0.5
                recent_output = []
                
                # Monitor progress
                for line in process.stdout:
                    line = line.strip()
                    if not line:
                        continue

                    if len(recent_output) >= 80:
                        recent_output.pop(0)
                    recent_output.append(line)
                    
                    if '[download]' in line and '%' in line:
                        try:
                            percent_match = re.search(r'(\d+(?:\.\d+)?)%', line)
                            if percent_match:
                                percent = float(percent_match.group(1))
                                current_time = time.time()
                                if on_progress and (current_time - last_progress_time) >= min_progress_interval:
                                    on_progress(download_id, 'video', min(100, max(0, percent)), 'N/A', 0, 0)
                                    last_progress_time = current_time
                        except:
                            pass
                
                try:
                    process.wait(timeout=3600)
                except subprocess.TimeoutExpired:
                    process.kill()
                    if on_error:
                        on_error(download_id, "Download timeout - took more than 1 hour")
                    return None
                
                if process.returncode == 0:
                    if on_complete:
                        output_file = self._find_downloaded_file('video.mp4')
                        on_complete(download_id, 'video', output_file)
                    return download_id
                else:
                    stderr_output = "\n".join(recent_output[-40:])
                    if stderr_output:
                        last_error_text = stderr_output[:500]
            except Exception as e:
                last_error_text = str(e)

        # If we reach here, all attempts failed
        # Build a user-friendly error message
        error_msg = last_error_text or 'Streaming download failed'
        
        # Clean up error message for display
        error_lower = error_msg.lower()
        if 'http error 404' in error_lower or 'video unavailable' in error_lower:
            error_msg = 'Video not found (HTTP 404). Check if the URL is correct.'
        elif 'http error 403' in error_lower:
            error_msg = 'Access forbidden (HTTP 403). Video may be private or blocked.'
        elif 'http error 429' in error_lower:
            error_msg = 'Too many requests (HTTP 429). Try again later.'
        elif 'age-restrict' in error_lower or 'age restrict' in error_lower or 'confirm your age' in error_lower:
            error_msg = 'Video is age-restricted. Please sign in to your account.'
        elif 'sign in' in error_lower and 'confirm' in error_lower:
            error_msg = 'Video requires sign-in. Please log into your browser.'
        elif 'private video' in error_lower or 'video is private' in error_lower:
            error_msg = 'Video is private. You may need to be logged in.'
        elif 'not available' in error_lower:
            error_msg = 'Video is not available in your region or has been deleted.'
        elif 'disabled' in error_lower:
            error_msg = 'Downloads are disabled for this video.'
        elif 'no video formats' in error_lower or 'unable to extract' in error_lower:
            error_msg = 'Could not extract video. The URL may be invalid or unsupported.'
        elif len(error_msg) > 200:
            error_msg = error_msg[:200] + '...'
        
        if on_error:
            on_error(download_id, error_msg)
        return None


    def _parse_size(self, size_str):
        """Parse size string like '10.5MiB' to bytes"""
        try:
            # Extract number and unit
            match = re.match(r'(\d+(?:\.\d+)?)([KMGT]?i?B)', size_str.upper())
            if not match:
                return 0

            number = float(match.group(1))
            unit = match.group(2)

            multipliers = {
                'B': 1,
                'KB': 1024, 'KIB': 1024,
                'MB': 1024**2, 'MIB': 1024**2,
                'GB': 1024**3, 'GIB': 1024**3,
                'TB': 1024**4, 'TIB': 1024**4
            }

            return int(number * multipliers.get(unit, 1))
        except:
            return 0

    def _find_downloaded_file(self, filename):
        """Find the actual downloaded file in the download directory"""
        try:
            import time
            
            # First try exact filename match
            exact_path = self.download_dir / filename
            if exact_path.exists():
                return str(exact_path)
            
            # Look for files modified in the last 60 seconds
            current_time = time.time()
            recent_files = []
            
            for file in self.download_dir.glob('*'):
                if file.is_file():
                    mod_time = file.stat().st_mtime
                    if current_time - mod_time < 60:  # Modified in last 60 seconds
                        recent_files.append((file, mod_time))
            
            # Return the most recently modified file
            if recent_files:
                recent_files.sort(key=lambda x: x[1], reverse=True)
                return str(recent_files[0][0])
            
            # Fallback to constructed path
            return str(self.download_dir / filename)
        except Exception as e:
            return str(self.download_dir / filename)


class DownloadManager:
    """Manages individual downloads with segmented multi-threaded approach"""

    def __init__(self, download_dir=None, num_threads=8):
        """
        Initialize download manager
        
        Args:
            download_dir: Directory to save downloads (default: ~/Downloads)
            num_threads: Number of threads for parallel downloads (default: 8)
        """
        self.download_dir = Path(download_dir or os.path.expanduser("~/Downloads"))
        self.download_dir.mkdir(parents=True, exist_ok=True)
        
        self.num_threads = num_threads
        self.downloads = {}  # Track all downloads
        self.lock = threading.Lock()  # Thread-safe access

    def generate_download_id(self, url):
        """Generate unique download ID from URL"""
        return hashlib.md5(url.encode()).hexdigest()[:12]

    def get_file_info(self, url, referer=None):
        """
        Get file information from URL (name, size, resumable)
        
        Returns:
            dict: {filename, size, resumable, headers}
        """
        try:
            headers = {'User-Agent': 'MyDM/1.0'}
            if referer:
                headers['Referer'] = referer

            response = requests.head(url, headers=headers, allow_redirects=True, timeout=10)
            response.raise_for_status()

            # Get filename
            filename = 'download'
            if 'content-disposition' in response.headers:
                # Extract filename from Content-Disposition header
                content_disp = response.headers['content-disposition']
                if 'filename=' in content_disp:
                    filename = content_disp.split('filename=')[1].strip('"\'')
            else:
                # Extract from URL
                filename = url.split('/')[-1].split('?')[0] or 'download'

            # Sanitize for Windows
            filename = sanitize_filename(filename)

            # Get file size
            size = int(response.headers.get('content-length', 0))
            
            # Check if server supports range requests
            resumable = response.headers.get('accept-ranges', 'none') != 'none'

            return {
                'filename': filename,
                'size': size,
                'resumable': resumable,
                'headers': dict(response.headers)
            }
        except Exception as e:
            raise Exception(f"Failed to get file info: {str(e)}")

    def download_segment(self, url, start_byte, end_byte, segment_num, output_file, referer=None):
        """
        Download a segment of the file
        
        Args:
            url: Download URL
            start_byte: Start byte position
            end_byte: End byte position
            segment_num: Segment number
            output_file: Path to output file
            referer: Referer header (optional)
            
        Returns:
            dict: {bytes_downloaded, success, error}
        """
        segment_file = f"{output_file}.part{segment_num}"
        bytes_downloaded = 0

        try:
            headers = {
                'User-Agent': 'MyDM/1.0',
                'Range': f'bytes={start_byte}-{end_byte}'
            }
            if referer:
                headers['Referer'] = referer

            response = requests.get(
                url,
                headers=headers,
                timeout=30,
                stream=True
            )
            response.raise_for_status()

            with open(segment_file, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        f.write(chunk)
                        bytes_downloaded += len(chunk)

            return {'bytes_downloaded': bytes_downloaded, 'success': True, 'error': None}

        except Exception as e:
            return {'bytes_downloaded': bytes_downloaded, 'success': False, 'error': str(e)}

    def merge_segments(self, output_file, num_segments):
        """
        Merge downloaded segments into final file
        
        Args:
            output_file: Path to final output file
            num_segments: Number of segments to merge
        """
        try:
            with open(output_file, 'wb') as outf:
                for i in range(num_segments):
                    segment_file = f"{output_file}.part{i}"
                    if os.path.exists(segment_file):
                        with open(segment_file, 'rb') as inf:
                            outf.write(inf.read())
                        # Clean up segment
                        os.remove(segment_file)
        except Exception as e:
            raise Exception(f"Failed to merge segments: {str(e)}")

    def start_download(self, url, referer=None, on_progress=None, on_complete=None, on_error=None):
        """
        Start a new download
        
        Args:
            url: URL to download
            referer: Referer header (optional)
            on_progress: Callback for progress updates
            on_complete: Callback for completion
            on_error: Callback for errors
            
        Returns:
            str: Download ID
        """
        download_id = self.generate_download_id(url)

        # Check if already downloading
        with self.lock:
            if download_id in self.downloads and self.downloads[download_id]['status'] in ['downloading', 'paused']:
                return download_id

        # Get file info
        try:
            file_info = self.get_file_info(url, referer)
        except Exception as e:
            if on_error:
                on_error(download_id, str(e))
            return download_id

        # Ensure filename is sanitized (double safety)
        safe_name = sanitize_filename(file_info['filename'])
        output_file = self.download_dir / safe_name
        
        # Check if file already exists and is complete
        if output_file.exists():
            file_size_on_disk = output_file.stat().st_size
            if file_size_on_disk == file_info['size']:
                # File already exists and appears complete
                with self.lock:
                    self.downloads[download_id] = {
                        'url': url,
                        'filename': file_info['filename'],
                        'output_file': str(output_file),
                        'size': file_info['size'],
                        'downloaded': file_info['size'],
                        'status': 'complete',
                        'start_time': time.time(),
                        'paused': False,
                        'cancelled': False,
                        'referer': referer,
                        'on_progress': on_progress,
                        'on_complete': on_complete,
                        'on_error': on_error
                    }
                
                # Immediately call completion callback
                if on_complete:
                    on_complete(download_id, file_info['filename'], str(output_file))
                
                return download_id
        
        # Initialize download state
        with self.lock:
            self.downloads[download_id] = {
                'url': url,
                'filename': file_info['filename'],
                'output_file': str(output_file),
                'size': file_info['size'],
                'downloaded': 0,
                'status': 'downloading',
                'start_time': time.time(),
                'paused': False,
                'cancelled': False,
                'referer': referer,
                'on_progress': on_progress,
                'on_complete': on_complete,
                'on_error': on_error
            }

        # Start download in background thread
        thread = threading.Thread(
            target=self._execute_download,
            args=(download_id, url, referer, file_info, output_file, on_progress),
            daemon=True
        )
        thread.start()

        return download_id

    def _execute_download(self, download_id, url, referer, file_info, output_file, on_progress):
        """Execute the actual download (called in thread)"""
        try:
            file_size = file_info['size']
            
            # If file size is 0 or very small, download as single segment
            if file_size < 1024 * 1024:  # Less than 1MB
                self._download_single_segment(
                    download_id, url, referer, output_file, on_progress
                )
            else:
                # Download with multiple segments
                self._download_multi_segment(
                    download_id, url, referer, output_file, file_size, on_progress
                )

            # Mark as complete
            with self.lock:
                self.downloads[download_id]['status'] = 'complete'
                self.downloads[download_id]['downloaded'] = file_size

            if self.downloads[download_id]['on_complete']:
                self.downloads[download_id]['on_complete'](
                    download_id, file_info['filename'], str(output_file)
                )

        except Exception as e:
            with self.lock:
                self.downloads[download_id]['status'] = 'error'

            if self.downloads[download_id]['on_error']:
                self.downloads[download_id]['on_error'](download_id, str(e))

    def _download_single_segment(self, download_id, url, referer, output_file, on_progress):
        """Download file as single segment"""
        try:
            headers = {'User-Agent': 'MyDM/1.0'}
            if referer:
                headers['Referer'] = referer

            response = requests.get(
                url,
                headers=headers,
                timeout=30,
                stream=True
            )
            response.raise_for_status()

            total_size = int(response.headers.get('content-length', 0))
            downloaded = 0
            last_progress_time = 0
            min_progress_interval = 0.5  # Throttle to max 2 updates per second

            with open(output_file, 'wb') as f:
                for chunk in response.iter_content(chunk_size=8192):
                    # Check for pause/cancel
                    with self.lock:
                        if self.downloads[download_id]['cancelled']:
                            raise Exception("Download cancelled")
                        while self.downloads[download_id]['paused']:
                            time.sleep(0.1)

                    if chunk:
                        f.write(chunk)
                        downloaded += len(chunk)

                        # Throttle progress updates
                        current_time = time.time()
                        if on_progress and total_size > 0 and (current_time - last_progress_time) >= min_progress_interval:
                            percent = min(100, int((downloaded / total_size) * 100))
                            speed = self._calculate_speed(download_id, downloaded)
                            on_progress(
                                download_id,
                                file_info['filename'] if 'file_info' in locals() else 'file',
                                percent,
                                speed,
                                total_size,
                                downloaded
                            )
                            last_progress_time = current_time

                        # Update downloaded size in state
                        with self.lock:
                            self.downloads[download_id]['downloaded'] = downloaded

        except Exception as e:
            raise e

    def _download_multi_segment(self, download_id, url, referer, output_file, file_size, on_progress):
        """Download file with multiple segments"""
        segment_size = file_size // self.num_threads
        
        # Create segments to download
        segments = []
        for i in range(self.num_threads):
            start = i * segment_size
            end = file_size - 1 if i == self.num_threads - 1 else (i + 1) * segment_size - 1
            segments.append((i, start, end))

        total_downloaded = 0
        segment_status = {}
        last_progress_time = 0
        min_progress_interval = 0.5  # Throttle to max 2 updates per second

        try:
            with ThreadPoolExecutor(max_workers=self.num_threads) as executor:
                futures = {}

                for seg_num, start, end in segments:
                    future = executor.submit(
                        self.download_segment,
                        url, start, end, seg_num, str(output_file), referer
                    )
                    futures[future] = seg_num

                # Monitor progress
                for future in as_completed(futures):
                    seg_num = futures[future]
                    result = future.result()
                    segment_status[seg_num] = result

                    if result['success']:
                        total_downloaded += result['bytes_downloaded']
                    else:
                        raise Exception(f"Segment {seg_num} failed: {result['error']}")

                    # Report progress (throttled)
                    current_time = time.time()
                    if on_progress and (current_time - last_progress_time) >= min_progress_interval:
                        percent = min(100, int((total_downloaded / file_size) * 100))
                        speed = self._calculate_speed(download_id, total_downloaded)
                        on_progress(
                            download_id,
                            os.path.basename(str(output_file)),
                            percent,
                            speed,
                            file_size,
                            total_downloaded
                        )
                        last_progress_time = current_time

                    # Check for cancellation
                    with self.lock:
                        if self.downloads[download_id]['cancelled']:
                            raise Exception("Download cancelled")

            # Merge segments
            self.merge_segments(str(output_file), self.num_threads)

        except Exception as e:
            # Clean up partial files
            for i in range(self.num_threads):
                part_file = f"{output_file}.part{i}"
                if os.path.exists(part_file):
                    try:
                        os.remove(part_file)
                    except:
                        pass
            raise e

    def _calculate_speed(self, download_id, bytes_downloaded):
        """Calculate download speed"""
        try:
            with self.lock:
                start_time = self.downloads[download_id]['start_time']
                elapsed = time.time() - start_time
                if elapsed > 0:
                    speed_bytes = bytes_downloaded / elapsed
                    if speed_bytes < 1024:
                        return f"{speed_bytes:.1f} B/s"
                    elif speed_bytes < 1024 * 1024:
                        return f"{speed_bytes / 1024:.1f} KB/s"
                    else:
                        return f"{speed_bytes / (1024 * 1024):.1f} MB/s"
            return "0 B/s"
        except:
            return "0 B/s"

    def pause_download(self, download_id):
        """Pause a download"""
        with self.lock:
            if download_id in self.downloads:
                self.downloads[download_id]['paused'] = True
                self.downloads[download_id]['status'] = 'paused'

    def resume_download(self, download_id):
        """Resume a paused download"""
        with self.lock:
            if download_id in self.downloads:
                self.downloads[download_id]['paused'] = False
                self.downloads[download_id]['status'] = 'downloading'

    def cancel_download(self, download_id):
        """Cancel a download"""
        with self.lock:
            if download_id in self.downloads:
                self.downloads[download_id]['cancelled'] = True
                self.downloads[download_id]['status'] = 'cancelled'

    def get_download_status(self, download_id):
        """Get current status of a download"""
        with self.lock:
            if download_id in self.downloads:
                return self.downloads[download_id].copy()
        return None

