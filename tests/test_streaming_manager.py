import pytest
from pathlib import Path
from downloader import StreamingDownloadManager

def test_is_streaming_site_true():
    assert StreamingDownloadManager.is_streaming_site("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert StreamingDownloadManager.is_streaming_site("https://youtu.be/dQw4w9WgXcQ")
    assert StreamingDownloadManager.is_streaming_site("https://vimeo.com/12345678")
    assert StreamingDownloadManager.is_streaming_site("https://www.tiktok.com/@user/video/123456789")
    assert StreamingDownloadManager.is_streaming_site("https://x.com/user/status/123456789")
    assert StreamingDownloadManager.is_streaming_site("https://twitter.com/user/status/123456789")
    assert StreamingDownloadManager.is_streaming_site("https://www.instagram.com/reel/C123456/")
    assert StreamingDownloadManager.is_streaming_site("https://www.reddit.com/r/videos/comments/abc1234/")
    assert StreamingDownloadManager.is_streaming_site("https://soundcloud.com/artist/track")

def test_is_streaming_site_false():
    assert not StreamingDownloadManager.is_streaming_site("https://example.com/file.zip")
    assert not StreamingDownloadManager.is_streaming_site("https://github.com/torvalds/linux/archive/master.tar.gz")
    assert not StreamingDownloadManager.is_streaming_site("invalid-url")
    assert not StreamingDownloadManager.is_streaming_site("")

def test_parse_size(tmp_path):
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))
    assert mgr._parse_size("100B") == 100
    assert mgr._parse_size("10.5KB") == int(10.5 * 1024)
    assert mgr._parse_size("2.5MiB") == int(2.5 * 1024 * 1024)
    assert mgr._parse_size("1.2GiB") == int(1.2 * 1024 * 1024 * 1024)
    assert mgr._parse_size("invalid") == 0

def test_detect_cookie_sources(tmp_path):
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))
    sources = mgr._detect_cookie_sources()
    assert isinstance(sources, list)
    # Deduplication check
    assert len(sources) == len(set(sources))

def test_yt_dlp_cmd(tmp_path):
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))
    cmd = mgr._yt_dlp_cmd()
    assert isinstance(cmd, list)
    assert len(cmd) >= 1
