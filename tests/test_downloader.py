import os
import time
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

from downloader import DownloadManager

def test_generate_download_id():
    dm = DownloadManager()
    id1 = dm.generate_download_id("https://example.com/file.zip")
    id2 = dm.generate_download_id("https://example.com/file.zip")
    id3 = dm.generate_download_id("https://example.com/other.zip")
    assert id1 == id2
    assert id1 != id3
    assert len(id1) == 12

def test_get_file_info_rfc5987():
    dm = DownloadManager()
    mock_resp = MagicMock()
    mock_resp.headers = {
        'content-disposition': "attachment; filename*=UTF-8''special%20file.pdf; size=1024",
        'content-length': '2048',
        'accept-ranges': 'bytes'
    }
    with patch('requests.head', return_value=mock_resp):
        info = dm.get_file_info('https://example.com/download')
        assert info['filename'] == 'special file.pdf'
        assert info['size'] == 2048
        assert info['resumable'] is True

def test_get_file_info_quoted_filename():
    dm = DownloadManager()
    mock_resp = MagicMock()
    mock_resp.headers = {
        'content-disposition': 'attachment; filename="archive_test.tar.gz"; other=param',
        'content-length': '5000',
        'accept-ranges': 'none'
    }
    with patch('requests.head', return_value=mock_resp):
        info = dm.get_file_info('https://example.com/download')
        assert info['filename'] == 'archive_test.tar.gz'
        assert info['size'] == 5000
        assert info['resumable'] is False

def test_merge_segments(tmp_path):
    dm = DownloadManager(download_dir=str(tmp_path))
    output_file = tmp_path / "combined.bin"
    parts = [b"Part0-Data", b"Part1-Data", b"Part2-Data"]
    for i, data in enumerate(parts):
        part_path = tmp_path / f"combined.bin.part{i}"
        part_path.write_bytes(data)

    dm.merge_segments(str(output_file), 3)

    assert output_file.exists()
    assert output_file.read_bytes() == b"".join(parts)
    for i in range(3):
        assert not (tmp_path / f"combined.bin.part{i}").exists()

def test_pause_resume_cancel_state(tmp_path):
    dm = DownloadManager(download_dir=str(tmp_path))
    dl_id = "test123"
    with dm.lock:
        dm.downloads[dl_id] = {
            'status': 'downloading',
            'paused': False,
            'cancelled': False,
            'start_time': time.time(),
            'downloaded': 100
        }

    dm.pause_download(dl_id)
    st = dm.get_download_status(dl_id)
    assert st['paused'] is True
    assert st['status'] == 'paused'

    dm.resume_download(dl_id)
    st = dm.get_download_status(dl_id)
    assert st['paused'] is False
    assert st['status'] == 'downloading'

    dm.cancel_download(dl_id)
    st = dm.get_download_status(dl_id)
    assert st['cancelled'] is True
    assert st['status'] == 'cancelled'

def test_calculate_speed(tmp_path):
    dm = DownloadManager(download_dir=str(tmp_path))
    dl_id = "speed_test"
    with dm.lock:
        dm.downloads[dl_id] = {
            'start_time': time.time() - 2.0,
            'downloaded': 2048
        }
    speed = dm._calculate_speed(dl_id, 2048)
    assert 'KB/s' in speed or 'B/s' in speed
