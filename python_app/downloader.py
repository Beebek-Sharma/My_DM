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
import tempfile
from urllib.parse import urlparse

# --------- Utilities ---------

def sanitize_filename(name: str) -> str:
    try:
        if not name:
            return 'download'
        invalid = set('<>:"/\\|?*')
        safe = ''.join('_' if c in invalid else c for c in str(name))
        safe = re.sub(r'[\x00-\x1f]', '', safe)
        safe = safe.strip().rstrip('. ')
        if not safe:
            safe = 'download'
        base_name = safe.split('.')[0]
        if base_name.upper() in {'CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'}:
            safe = f"_{safe}"
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
        self.active_processes = {}
        self.active_processes_lock = threading.Lock()

    def cancel_download(self, download_id):
        """Cancel an active streaming download process immediately"""
        with self.active_processes_lock:
            proc = self.active_processes.pop(download_id, None)
        if proc:
            try:
                proc.kill()
                return True
            except Exception:
                pass
        return False

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
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            if result.returncode == 0:
                self.yt_dlp_available = True
                return True
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass

        try:
            # Fallback to the yt-dlp executable if present on PATH.
            result = subprocess.run(
                ['yt-dlp', '--version'],
                stdin=subprocess.DEVNULL,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            if result.returncode == 0:
                self.yt_dlp_available = True
                return True
            return False
        except (subprocess.TimeoutExpired, FileNotFoundError) as e:
            return False

    def _yt_dlp_cmd(self):
        """Return a command prefix to run yt-dlp reliably."""
        # If installed in the same environment, `python -u -m yt_dlp` is the most reliable.
        if self._check_yt_dlp():
            return [sys.executable, '-u', '-m', 'yt_dlp']
        return ['yt-dlp']

    def _find_ffmpeg(self):
        """Locate ffmpeg binary via imageio_ffmpeg or system PATH"""
        try:
            import imageio_ffmpeg
            exe = imageio_ffmpeg.get_ffmpeg_exe()
            if exe and os.path.exists(exe):
                return exe
        except Exception:
            pass
        return None

    def _find_node(self):
        """Locate node.exe binary on system for yt-dlp JavaScript runtime"""
        try:
            import shutil
            exe = shutil.which('node')
            if exe and os.path.exists(exe):
                return exe
            common_paths = [
                r'C:\Program Files\nodejs\node.exe',
                r'C:\Program Files (x86)\nodejs\node.exe',
                os.path.expandvars(r'%LOCALAPPDATA%\Programs\node\node.exe'),
                os.path.expandvars(r'%APPDATA%\npm\node.exe'),
            ]
            for p in common_paths:
                if os.path.exists(p):
                    return p
        except Exception:
            pass
        return None

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

    def _create_temp_cookie_file(self, url, cookie_header):
        """Create a temporary Netscape-format cookie file from a Cookie HTTP header string."""
        if not cookie_header or not isinstance(cookie_header, str):
            return None
        try:
            parsed = urlparse(url)
            domain = parsed.hostname or ''
            if not domain:
                return None
            if domain.startswith('www.'):
                domain = domain[4:]
            cookie_domain = domain if domain.startswith('.') else f".{domain}"
            lines = ["# Netscape HTTP Cookie File", "# Created by MyDM for authenticated stream extraction"]
            now = int(time.time()) + 86400 * 30  # 30 days expiry

            for pair in cookie_header.split(';'):
                pair = pair.strip()
                if not pair or '=' not in pair:
                    continue
                name, val = pair.split('=', 1)
                name = name.strip()
                val = val.strip()
                if name:
                    lines.append(f"{cookie_domain}\tTRUE\t/\tTRUE\t{now}\t{name}\t{val}")

            tmp = tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', suffix='.txt', delete=False)
            tmp.write("\n".join(lines) + "\n")
            tmp.flush()
            tmp.close()
            return tmp.name
        except Exception:
            return None

    def extract_formats(self, url, cookie_header=None):
        """
        Extract available resolutions and formats for a video URL.
        Returns a dictionary with title, thumbnail, duration, and list of formats.
        """
        # Clean YouTube watch URLs that contain &list= when extracting single video info
        cleaned_url = url
        try:
            from urllib.parse import parse_qs, urlencode, urlunparse
            parsed_u = urlparse(url)
            u_host = parsed_u.hostname.lower() if parsed_u.hostname else ''
            if ('youtube.com' in u_host or 'youtu.be' in u_host) and parsed_u.path == '/watch':
                qs = parse_qs(parsed_u.query)
                v_param = qs.get('v')
                if v_param:
                    new_query = urlencode({'v': v_param[0]})
                    cleaned_url = urlunparse((parsed_u.scheme, parsed_u.netloc, parsed_u.path, '', new_query, ''))
        except Exception:
            cleaned_url = url

        # Fast reject Instagram collection / saved / feed pages (cannot be downloaded as single videos)
        try:
            parsed_chk = urlparse(cleaned_url)
            chk_host = parsed_chk.hostname.lower() if parsed_chk.hostname else ''
            if 'instagram.com' in chk_host and not any(p in parsed_chk.path for p in ['/p/', '/reel/', '/tv/', '/stories/']):
                raise ValueError("Instagram collection and feed pages cannot be downloaded directly. Please use 'Media Sniffer' -> 'Scan Page' to select an individual Reel or Post.")
        except ValueError:
            raise
        except Exception:
            pass

        if not self._check_yt_dlp():
            raise RuntimeError("yt-dlp is not available")

        temp_cookie_file = self._create_temp_cookie_file(cleaned_url, cookie_header)
        info = None
        try:
            # Fast path: try Python module
            try:
                import yt_dlp
                ydl_opts = {
                    'quiet': True,
                    'no_warnings': True,
                    'skip_download': True,
                    'extract_flat': False,
                    'socket_timeout': 15,
                }
                ffmpeg_exe = self._find_ffmpeg()
                if ffmpeg_exe:
                    ydl_opts['ffmpeg_location'] = ffmpeg_exe
                if temp_cookie_file:
                    ydl_opts['cookiefile'] = temp_cookie_file

                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(cleaned_url, download=False)
            except Exception:
                # Subprocess fallback
                cmd = [*self._yt_dlp_cmd(), '--dump-single-json', '--no-playlist', '--skip-download', '--socket-timeout', '15']
                ffmpeg_exe = self._find_ffmpeg()
                if ffmpeg_exe:
                    cmd.extend(['--ffmpeg-location', ffmpeg_exe])
                node_exe = self._find_node()
                if node_exe:
                    cmd.extend(['--js-runtimes', f'node:{node_exe}'])

                cookie_sources = self._detect_cookie_sources()
                attempts = [('none', None)]
                if temp_cookie_file:
                    attempts.append(('file', temp_cookie_file))
                for s in cookie_sources:
                    attempts.append(('browser', s))

                for kind, val in attempts:
                    try:
                        c_cmd = list(cmd)
                        if kind == 'file':
                            c_cmd.extend(['--cookies', val])
                        elif kind == 'browser':
                            c_cmd.extend(['--cookies-from-browser', val])
                        c_cmd.append(cleaned_url)
                        res = subprocess.run(
                            c_cmd,
                            stdin=subprocess.DEVNULL,
                            capture_output=True,
                            text=True,
                            timeout=20,
                            creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                        )
                        if res.returncode == 0 and res.stdout.strip():
                            info = json.loads(res.stdout)
                            break
                    except Exception:
                        continue
        finally:
            if temp_cookie_file and os.path.exists(temp_cookie_file):
                try:
                    os.unlink(temp_cookie_file)
                except Exception:
                    pass

        if not info:
            return {
                'title': 'Video Stream',
                'thumbnail': '',
                'duration': 0,
                'uploader': '',
                'formats': [
                    {
                        'id': 'best',
                        'label': 'Best Available Quality (Auto)',
                        'format_spec': 'bestvideo*+bestaudio/best',
                        'ext': 'mp4',
                        'is_audio': False,
                        'is_default': True
                    },
                    {
                        'id': 'audio_mp3',
                        'label': '🎵 Audio Only (MP3)',
                        'format_spec': 'ba/b',
                        'ext': 'mp3',
                        'audio_only': True,
                        'is_audio': True
                    }
                ]
            }

        if 'entries' in info and info['entries']:
            info = info['entries'][0]

        title = info.get('title') or 'Video Stream'
        thumbnail = info.get('thumbnail') or ''
        duration = info.get('duration') or 0
        uploader = info.get('uploader') or info.get('channel') or ''
        raw_formats = info.get('formats') or []

        available_heights = set()
        height_sizes = {}
        for f in raw_formats:
            h = f.get('height')
            if h and isinstance(h, int) and h > 0:
                available_heights.add(h)
                sz = f.get('filesize') or f.get('filesize_approx') or 0
                if sz and (h not in height_sizes or sz > height_sizes[h]):
                    height_sizes[h] = sz

        STANDARD_TIERS = [
            (2160, '4K (2160p)'),
            (1440, '2K (1440p)'),
            (1080, '1080p (Full HD)'),
            (720, '720p (HD)'),
            (480, '480p (SD)'),
            (360, '360p (Low)'),
            (240, '240p (Mobile)')
        ]

        formatted_list = [
            {
                'id': 'best',
                'label': 'Best Available Quality (Auto)',
                'format_spec': 'bestvideo*+bestaudio/best',
                'ext': 'mp4',
                'is_audio': False,
                'is_default': True
            }
        ]

        max_available_height = max(available_heights) if available_heights else 1080
        for tier_h, tier_label in STANDARD_TIERS:
            if tier_h <= max_available_height and any(h >= tier_h for h in available_heights):
                closest_h = min([h for h in available_heights if h >= tier_h], default=tier_h)
                size_est = height_sizes.get(closest_h, 0)
                formatted_list.append({
                    'id': f'res_{tier_h}',
                    'label': tier_label,
                    'format_spec': f'bestvideo[height<={tier_h}]+bestaudio/best[height<={tier_h}]/best',
                    'height': tier_h,
                    'ext': 'mp4',
                    'filesize': size_est,
                    'is_audio': False
                })

        audio_size = 0
        for f in raw_formats:
            if f.get('vcodec') == 'none' and (f.get('filesize') or f.get('filesize_approx')):
                audio_size = max(audio_size, f.get('filesize') or f.get('filesize_approx') or 0)

        formatted_list.append({
            'id': 'audio_mp3',
            'label': '🎵 Audio Only (MP3 - High Quality)',
            'format_spec': 'ba/b',
            'ext': 'mp3',
            'filesize': audio_size,
            'audio_only': True,
            'is_audio': True
        })
        formatted_list.append({
            'id': 'audio_m4a',
            'label': '🎵 Audio Only (M4A / AAC)',
            'format_spec': 'bestaudio[ext=m4a]/ba',
            'ext': 'm4a',
            'filesize': audio_size,
            'audio_only': True,
            'is_audio': True
        })

        return {
            'title': title,
            'thumbnail': thumbnail,
            'duration': duration,
            'uploader': uploader,
            'formats': formatted_list
        }

    def extract_playlist_info(self, url, cookie_header=None):
        """
        Extract playlist title, uploader, video count, and list of video entries.
        Fast extraction using --flat-playlist.
        """
        if not self._check_yt_dlp():
            raise RuntimeError("yt-dlp is not available")

        # Resolve playlist URL
        playlist_url = url
        try:
            from urllib.parse import parse_qs
            parsed = urlparse(url)
            qs = parse_qs(parsed.query)
            list_id = qs.get('list', [None])[0]
            if list_id:
                playlist_url = f"https://www.youtube.com/playlist?list={list_id}"
        except Exception:
            pass

        temp_cookie_file = self._create_temp_cookie_file(url, cookie_header)
        try:
            base_cmd = [
                *self._yt_dlp_cmd(),
                '--flat-playlist',
                '--dump-single-json',
                '--no-warnings',
                '--socket-timeout', '25'
            ]
            node_exe = self._find_node()
            if node_exe:
                base_cmd.extend(['--js-runtimes', f'node:{node_exe}'])

            attempts_pl = [('none', None)]
            if temp_cookie_file:
                attempts_pl.append(('file', temp_cookie_file))

            res = None
            last_err = ''
            for p_kind, p_val in attempts_pl:
                cmd = list(base_cmd)
                if p_kind == 'file':
                    cmd.extend(['--cookies', p_val])
                cmd.append(playlist_url)

                res = subprocess.run(
                    cmd,
                    stdin=subprocess.DEVNULL,
                    capture_output=True,
                    text=True,
                    timeout=30,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                )
                if res.returncode == 0 and res.stdout.strip():
                    break
                last_err = res.stderr.strip() if res else ''

            if not res or res.returncode != 0 or not res.stdout.strip():
                raise RuntimeError(last_err or "Failed to extract playlist")

            info = json.loads(res.stdout)
            raw_entries = info.get('entries') or []
            entries = []
            for idx, entry in enumerate(raw_entries):
                if not entry:
                    continue
                v_id = entry.get('id') or ''
                v_title = entry.get('title') or f"Video {idx + 1}"
                v_url = entry.get('url') or (f"https://www.youtube.com/watch?v={v_id}" if v_id else '')
                v_thumb = (entry.get('thumbnails') or [{}])[-1].get('url', '') if entry.get('thumbnails') else (f"https://i.ytimg.com/vi/{v_id}/hqdefault.jpg" if v_id else '')
                entries.append({
                    'index': idx + 1,
                    'id': v_id,
                    'title': v_title,
                    'url': v_url,
                    'duration': entry.get('duration') or 0,
                    'thumbnail': v_thumb
                })

            return {
                'is_playlist': True,
                'playlist_id': info.get('id') or '',
                'title': info.get('title') or 'Playlist',
                'uploader': info.get('uploader') or info.get('channel') or '',
                'item_count': len(entries),
                'entries': entries
            }
        finally:
            if temp_cookie_file and os.path.exists(temp_cookie_file):
                try:
                    os.unlink(temp_cookie_file)
                except Exception:
                    pass

    def download(self, url, on_progress=None, on_complete=None, on_error=None, download_id=None, format_spec=None, audio_only=False, cookie_header=None, output_template=None):
        """Download from streaming site using yt-dlp with cookie fallbacks"""
        download_id = download_id or hashlib.md5(url.encode()).hexdigest()[:12]
        
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

        # Clean YouTube watch URLs that contain &list= when downloading a single video
        cleaned_url = url
        try:
            from urllib.parse import parse_qs, urlencode, urlunparse
            parsed_u = urlparse(url)
            u_host = parsed_u.hostname.lower() if parsed_u.hostname else ''
            if ('youtube.com' in u_host or 'youtu.be' in u_host) and parsed_u.path == '/watch':
                qs = parse_qs(parsed_u.query)
                v_param = qs.get('v')
                if v_param:
                    new_query = urlencode({'v': v_param[0]})
                    cleaned_url = urlunparse((parsed_u.scheme, parsed_u.netloc, parsed_u.path, '', new_query, ''))
        except Exception:
            cleaned_url = url

        # Check if URL was an Instagram collection/feed
        try:
            parsed_chk = urlparse(cleaned_url)
            chk_host = parsed_chk.hostname.lower() if parsed_chk.hostname else ''
            if 'instagram.com' in chk_host and not any(p in parsed_chk.path for p in ['/p/', '/reel/', '/tv/', '/stories/']):
                err_feed = "Instagram collection and feed pages cannot be downloaded directly. Please use 'Media Sniffer' -> 'Scan Page' to select an individual Reel or Post."
                if on_error:
                    on_error(download_id, err_feed)
                return None
        except Exception:
            pass

        temp_cookie_file = self._create_temp_cookie_file(cleaned_url, cookie_header)

        # Output path template
        if output_template:
            norm_tmpl = str(output_template).replace('\\', '/')
            if not norm_tmpl.endswith('.%(ext)s'):
                base_no_ext, _ = os.path.splitext(norm_tmpl)
                target_tmpl = f"{base_no_ext}.%(ext)s"
            else:
                target_tmpl = norm_tmpl
            out_target = str(self.download_dir / target_tmpl)
        else:
            out_target = str(self.download_dir / '%(title)s.%(ext)s')

        try:
            target_dir = Path(out_target).parent
            target_dir.mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

        def build_cmd(cookie_kind=None, cookie_val=None):
            base = [
                *self._yt_dlp_cmd(),
                '--no-warnings',
                '--progress',
                '--newline',
                '--no-playlist',  # Force single video extraction (prevents downloading whole playlists)
                '--socket-timeout', '30',  # 30 second socket timeout
                '--skip-unavailable-fragments',  # Skip unavailable fragments
                '--postprocessor-args', 'ffmpeg:-nostdin',
            ]
            ffmpeg_exe = self._find_ffmpeg()
            if ffmpeg_exe:
                base.extend(['--ffmpeg-location', ffmpeg_exe])

            node_exe = self._find_node()
            if node_exe:
                base.extend(['--js-runtimes', f'node:{node_exe}'])

            if audio_only:
                base.extend(['-x', '--audio-format', 'mp3', '-f', format_spec or 'ba/b'])
                base.extend(['-o', out_target])
            else:
                fmt = format_spec or 'bestvideo*+bestaudio/best'
                base.extend(['-f', fmt, '--merge-output-format', 'mp4'])
                base.extend(['-o', out_target])

            if cookie_kind == 'file':
                base.extend(['--cookies', cookie_val])
            elif cookie_kind == 'browser':
                base.extend(['--cookies-from-browser', cookie_val])
            base.append(cleaned_url)
            return base

        # Try multiple cookie sources then fallback to no cookies
        cookie_sources = self._detect_cookie_sources()
        if not cookie_sources:
            cookie_sources = ['chrome:Default', 'chrome', 'edge:Default', 'edge']

        # Always try without cookies first ('none', None):
        # 1. YouTube public videos extract cleanly and fast without cookie conflicts or bot challenges.
        # 2. Chrome 127+ App-Bound Encryption prevents reading DPAPI-encrypted cookies.
        # 3. If 'none' fails (e.g. age-restricted or private), fall back to temp_cookie_file and browser sources.
        attempts = [('none', None)]
        if temp_cookie_file:
            attempts.append(('file', temp_cookie_file))
        for s in cookie_sources:
            attempts.append(('browser', s))

        last_error_text = ''

        try:
            for attempt_num, (kind, cookies) in enumerate(attempts):
                try:
                    cmd = build_cmd(kind, cookies)
                    process = subprocess.Popen(
                        cmd,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        universal_newlines=True,
                        bufsize=1,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                    )
                    with self.active_processes_lock:
                        self.active_processes[download_id] = process
                except Exception as e:
                    last_error_text = str(e)
                    continue

                default_name = Path(output_template).name if output_template else ("audio.mp3" if audio_only else "video.mp4")
                filename = default_name
                total_size = 0
                downloaded_size = 0
                last_progress_time = 0
                min_progress_interval = 0.5  # Only report progress every 500ms max
                recent_output = []

                # Monitor progress
                for line in process.stdout:
                    line = line.strip()
                    if not line:
                        continue

                    if len(recent_output) >= 80:
                        recent_output.pop(0)
                    recent_output.append(line)

                    # 1. Extract filename from destination line
                    if '[download]' in line and 'Destination:' in line:
                        try:
                            raw_dest = line.split('Destination:')[1].strip()
                            if raw_dest:
                                filename = Path(raw_dest).name
                        except Exception:
                            pass

                    # 2. Check if file was already downloaded
                    already_match = re.search(r'\[download\]\s+(.+?)\s+has already been downloaded', line)
                    if already_match:
                        try:
                            full_path = already_match.group(1).strip()
                            filename = Path(full_path).name
                            sz = os.path.getsize(full_path) if os.path.exists(full_path) else 0
                            total_size = sz
                            downloaded_size = sz
                            if on_progress:
                                on_progress(download_id, filename, 100, "N/A", total_size, downloaded_size)
                        except Exception:
                            pass

                    # 3. Check for format merger output
                    merger_match = re.search(r'\[Merger\]\s+Merging formats into\s+["\']?([^"\']+)["\']?', line)
                    if merger_match:
                        try:
                            filename = Path(merger_match.group(1).strip()).name
                        except Exception:
                            pass

                    # 4. Check for audio extraction output
                    if '[ExtractAudio]' in line and 'Destination:' in line:
                        try:
                            raw_dest = line.split('Destination:')[1].strip()
                            if raw_dest:
                                filename = Path(raw_dest).name
                        except Exception:
                            pass

                    # 5. Parse progress information
                    if '[download]' in line and '%' in line:
                        try:
                            percent_match = re.search(r'(\d+(?:\.\d+)?)%', line)
                            if percent_match:
                                percent = float(percent_match.group(1))
                            else:
                                percent = 0

                            size_match = re.search(r'of\s+(?:~\s*)?(\d+(?:\.\d+)?[KMGT]i?B)', line)
                            if size_match:
                                size_str = size_match.group(1)
                                total_size = self._parse_size(size_str)
                                downloaded_size = int((percent / 100) * total_size) if total_size > 0 else 0

                            speed = "N/A"
                            speed_match = re.search(r'at\s+(\d+(?:\.\d+)?\w+/s)', line)
                            if speed_match:
                                speed = speed_match.group(1)

                            current_time = time.time()
                            if on_progress and ((current_time - last_progress_time) >= min_progress_interval or percent >= 100):
                                on_progress(
                                    download_id,
                                    filename,
                                    min(100, max(0, percent)),
                                    speed,
                                    total_size,
                                    downloaded_size
                                )
                                last_progress_time = current_time
                        except Exception:
                            continue

                # Wait for process to complete with timeout
                try:
                    process.wait(timeout=3600)
                except subprocess.TimeoutExpired:
                    process.kill()
                    if on_error:
                        on_error(download_id, "Download timeout - took more than 1 hour")
                    return None

                if process.returncode == 0:
                    time.sleep(0.5)
                    if on_complete:
                        output_file = self._find_downloaded_file(filename, output_template)
                        on_complete(download_id, filename, output_file)
                    return download_id
                else:
                    error_lines = [l for l in recent_output if l.startswith('ERROR:') or 'error:' in l.lower()]
                    if error_lines:
                        last_error_text = "\n".join(error_lines)
                    elif recent_output:
                        last_error_text = "\n".join(recent_output[-5:])
                    else:
                        last_error_text = f"Process exited with code {process.returncode}"

                    # Continue to try remaining fallback attempts in attempts
                    continue

            # As a last resort, try an exported cookies.txt if available
            cookie_file = None
            if last_error_text and ('dpapi' in last_error_text.lower() or 'cookie' in last_error_text.lower()):
                cookie_file = self._find_cookie_file()
            
            if cookie_file:
                try:
                    cmd = [
                        *self._yt_dlp_cmd(), '--no-warnings', '--progress', '--newline',
                        '--no-playlist',
                        '--socket-timeout', '30',
                        '--skip-unavailable-fragments',
                        '--postprocessor-args', 'ffmpeg:-nostdin',
                    ]
                    ffmpeg_exe = self._find_ffmpeg()
                    if ffmpeg_exe:
                        cmd.extend(['--ffmpeg-location', ffmpeg_exe])
                    node_exe = self._find_node()
                    if node_exe:
                        cmd.extend(['--js-runtimes', f'node:{node_exe}'])
                    if audio_only:
                        cmd.extend(['-x', '--audio-format', 'mp3', '-f', format_spec or 'ba/b'])
                    else:
                        cmd.extend(['-f', format_spec or 'bestvideo*+bestaudio/best', '--merge-output-format', 'mp4'])
                    cmd.extend(['--cookies', cookie_file, '-o', out_target, cleaned_url])

                    process = subprocess.Popen(
                        cmd,
                        stdin=subprocess.DEVNULL,
                        stdout=subprocess.PIPE,
                        stderr=subprocess.STDOUT,
                        text=True,
                        universal_newlines=True,
                        bufsize=1,
                        creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                    )
                    with self.active_processes_lock:
                        self.active_processes[download_id] = process
                    
                    last_progress_time = 0
                    min_progress_interval = 0.5
                    recent_output = []
                    
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
                            except Exception:
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
                            fallback_name = Path(output_template).name if output_template else ('audio.mp3' if audio_only else 'video.mp4')
                            output_file = self._find_downloaded_file(fallback_name, output_template)
                            on_complete(download_id, fallback_name, output_file)
                        return download_id
                    else:
                        error_lines = [l for l in recent_output if l.startswith('ERROR:') or 'error:' in l.lower()]
                        if error_lines:
                            last_error_text = "\n".join(error_lines)
                        elif recent_output:
                            last_error_text = "\n".join(recent_output[-5:])
                except Exception as e:
                    last_error_text = str(e)
        finally:
            with self.active_processes_lock:
                self.active_processes.pop(download_id, None)
            if temp_cookie_file and os.path.exists(temp_cookie_file):
                try:
                    os.unlink(temp_cookie_file)
                except Exception:
                    pass

        # If we reach here, all attempts failed
        error_msg = last_error_text or 'Streaming download failed'
        error_lower = error_msg.lower()
        if 'http error 404' in error_lower or 'video unavailable' in error_lower:
            error_msg = 'Video not found (HTTP 404). Check if the URL is correct.'
        elif 'http error 403' in error_lower or 'forbidden' in error_lower:
            error_msg = 'Access forbidden (HTTP 403). Video may be private or requires login.'
        elif 'http error 429' in error_lower:
            error_msg = 'Too many requests (HTTP 429). Try again later.'
        elif 'age-restrict' in error_lower or 'confirm your age' in error_lower:
            error_msg = 'Video is age-restricted. Please sign in to your account.'
        elif 'sign in' in error_lower and 'confirm' in error_lower:
            error_msg = 'Video requires sign-in. Please log into your browser.'
        elif 'private video' in error_lower or 'video is private' in error_lower:
            error_msg = 'Video is private. You may need to be logged into your account.'
        elif 'redirect' in error_lower and 'login' in error_lower:
            error_msg = 'Website redirects to login. Please open an individual post or reel rather than a feed.'
        elif 'requested format is not available' in error_lower:
            error_msg = 'Requested video format is not available. Try selecting Best Quality or MP3.'
        elif 'not available' in error_lower:
            error_msg = 'Video is not available in your region or has been deleted.'
        elif 'disabled' in error_lower:
            error_msg = 'Downloads are disabled for this video.'
        elif 'no video formats' in error_lower or 'unable to extract' in error_lower:
            error_msg = 'Could not extract video. The URL may be invalid or unsupported.'
        elif 'failed to decrypt with dpapi' in error_lower:
            error_msg = 'Browser cookies are encrypted (DPAPI). Direct download without cookies failed.'
        else:
            cleaned_lines = []
            for eline in error_msg.splitlines():
                eline = re.sub(r'^ERROR:\s*(\[[^\]]+\]\s*)?', '', eline).strip()
                if eline:
                    cleaned_lines.append(eline)
            if cleaned_lines:
                error_msg = cleaned_lines[-1]
            if len(error_msg) > 200:
                error_msg = error_msg[:200] + '...'
        
        if on_error:
            on_error(download_id, error_msg)
        return None


    def _parse_size(self, size_str):
        """Parse size string like '10.5MiB' to bytes"""
        try:
            # Extract number and unit (case-insensitive)
            match = re.match(r'(\d+(?:\.\d+)?)\s*([KMGT]?I?B)', size_str.upper())
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

    def _find_downloaded_file(self, filename, output_template=None):
        """Find the actual downloaded file in the download directory or target subfolder"""
        try:
            import time
            
            # Determine target search directory from output_template or filename
            if output_template:
                norm_tmpl = str(output_template).replace('\\', '/')
                target_sub = (self.download_dir / norm_tmpl).parent
            else:
                target_sub = (self.download_dir / filename).parent

            search_dirs = [target_sub] if target_sub.exists() else []
            if self.download_dir not in search_dirs:
                search_dirs.append(self.download_dir)

            # 1. Exact filename match in search directories
            fname_p = Path(filename).name
            for sdir in search_dirs:
                exact_path = sdir / fname_p
                if exact_path.exists() and exact_path.is_file():
                    return str(exact_path.resolve())

            # 2. Try case-insensitive filename or stem match in destination dir or root
            fname_lower = fname_p.lower()
            stem_lower = Path(filename).stem.lower()
            for sdir in search_dirs:
                if not sdir.exists():
                    continue
                for file in sdir.iterdir():
                    if file.is_file():
                        if file.name.lower() == fname_lower or file.stem.lower() == stem_lower:
                            return str(file.resolve())

            # 3. Look for files modified in the last 180 seconds in search directories
            current_time = time.time()
            recent_files = []
            for sdir in search_dirs:
                if not sdir.exists():
                    continue
                for file in sdir.glob('*'):
                    if file.is_file():
                        mod_time = file.stat().st_mtime
                        if current_time - mod_time < 180:
                            recent_files.append((file, mod_time))

            if recent_files:
                recent_files.sort(key=lambda x: x[1], reverse=True)
                return str(recent_files[0][0].resolve())

            # Fallback to target directory with filename
            fallback_dir = search_dirs[0] if search_dirs else self.download_dir
            return str(fallback_dir / fname_p)
        except Exception:
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
                content_disp = response.headers['content-disposition']
                fn_star = re.search(r"filename\*\s*=\s*(?:UTF-8''|utf-8'')([^;\s]+)", content_disp, re.IGNORECASE)
                if fn_star:
                    from urllib.parse import unquote
                    filename = unquote(fn_star.group(1)).strip('"\' ')
                else:
                    fn_match = re.search(r'filename\s*=\s*("([^"]+)"|([^;\s]+))', content_disp, re.IGNORECASE)
                    if fn_match:
                        filename = (fn_match.group(2) or fn_match.group(3) or 'download').strip('"\' ')
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

    def download_segment(self, url, start_byte, end_byte, segment_num, output_file, referer=None, download_id=None):
        """
        Download a segment of the file
        
        Args:
            url: Download URL
            start_byte: Start byte position
            end_byte: End byte position
            segment_num: Segment number
            output_file: Path to output file
            referer: Referer header (optional)
            download_id: ID of the download (optional, for pause/cancel tracking)
            
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
                    if download_id:
                        while True:
                            with self.lock:
                                dl = self.downloads.get(download_id)
                                if dl:
                                    if dl.get('cancelled'):
                                        raise Exception("Download cancelled")
                                    if not dl.get('paused'):
                                        break
                                else:
                                    break
                            time.sleep(0.1)

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
            resumable = file_info.get('resumable', False)
            
            # If file size is 0 or very small, or server doesn't support range requests, download as single segment
            if file_size < 1024 * 1024 or not resumable:
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
                    # Check for pause/cancel without holding lock during sleep
                    while True:
                        with self.lock:
                            dl = self.downloads.get(download_id)
                            if dl:
                                if dl.get('cancelled'):
                                    raise Exception("Download cancelled")
                                if not dl.get('paused'):
                                    break
                            else:
                                break
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
                                os.path.basename(str(output_file)),
                                percent,
                                speed,
                                total_size,
                                downloaded
                            )
                            last_progress_time = current_time

                        # Update downloaded size in state
                        with self.lock:
                            if download_id in self.downloads:
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
                        url, start, end, seg_num, str(output_file), referer, download_id
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

