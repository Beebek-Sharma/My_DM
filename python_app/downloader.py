"""
MyDM Downloader Module
Handles multi-threaded segmented downloads with pause/resume support
"""

import os
import json
import requests
import threading
import time
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
import hashlib


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

        output_file = self.download_dir / file_info['filename']
        
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

                        if on_progress and total_size > 0:
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

                    # Report progress
                    if on_progress:
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
