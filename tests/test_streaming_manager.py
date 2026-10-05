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

def test_extract_formats_fallback_and_parsing(tmp_path):
    from unittest.mock import patch, MagicMock
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))

    # Test when yt-dlp returns mocked video info
    mock_info = {
        'title': 'Test Video',
        'thumbnail': 'https://example.com/thumb.jpg',
        'duration': 120,
        'uploader': 'Test Channel',
        'formats': [
            {'height': 1080, 'filesize': 50000000, 'ext': 'mp4'},
            {'height': 720, 'filesize': 25000000, 'ext': 'mp4'},
            {'height': 360, 'filesize': 10000000, 'ext': 'mp4'},
            {'vcodec': 'none', 'filesize': 5000000, 'ext': 'm4a'}
        ]
    }

    mock_ydl = MagicMock()
    mock_ydl.__enter__.return_value = mock_ydl
    mock_ydl.extract_info.return_value = mock_info

    with patch('yt_dlp.YoutubeDL', return_value=mock_ydl):
        res = mgr.extract_formats("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        assert res['title'] == 'Test Video'
        assert res['thumbnail'] == 'https://example.com/thumb.jpg'
        assert len(res['formats']) >= 4
        # Verify 1080p, 720p, 360p and audio are present
        labels = [f['label'] for f in res['formats']]
        assert any('1080p' in l for l in labels)
        assert any('720p' in l for l in labels)
        assert any('Audio Only' in l for l in labels)

def test_find_downloaded_file_matches(tmp_path):
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))
    test_file = tmp_path / "My Video Title.mp4"
    test_file.write_bytes(b"dummy video data")

    # Exact match
    assert mgr._find_downloaded_file("My Video Title.mp4") == str(test_file)
    # Case-insensitive match
    assert mgr._find_downloaded_file("my video title.mp4") == str(test_file)
    # Stem match
    assert mgr._find_downloaded_file("My Video Title.mkv") == str(test_file)

def test_extract_playlist_info_mocked(tmp_path):
    import json
    from unittest.mock import patch, MagicMock
    import subprocess
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))

    mock_json = {
        'id': 'PL123',
        'title': 'Test Playlist',
        'uploader': 'Test Channel',
        'entries': [
            {'id': 'v1', 'title': 'Video 1', 'url': 'https://www.youtube.com/watch?v=v1', 'duration': 100},
            {'id': 'v2', 'title': 'Video 2', 'url': 'https://www.youtube.com/watch?v=v2', 'duration': 200}
        ]
    }

    mock_res = MagicMock()
    mock_res.returncode = 0
    mock_res.stdout = json.dumps(mock_json)

    with patch('subprocess.run', return_value=mock_res):
        info = mgr.extract_playlist_info("https://www.youtube.com/playlist?list=PL123")
        assert info['is_playlist'] is True
        assert info['title'] == 'Test Playlist'
        assert info['item_count'] == 2
        assert len(info['entries']) == 2
        assert info['entries'][0]['title'] == 'Video 1'


def test_find_node(tmp_path):
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))
    node_path = mgr._find_node()
    # node is installed in this test environment
    assert node_path is not None
    assert 'node' in node_path.lower()


def test_find_downloaded_file_with_output_template(tmp_path):
    mgr = StreamingDownloadManager(download_dir=str(tmp_path))
    subfolder = tmp_path / "Videos" / "Numpy Tutorial"
    subfolder.mkdir(parents=True, exist_ok=True)
    test_file = subfolder / "12 - Numpy Part 12 - Broadcasting.mp4"
    test_file.write_bytes(b"sample video bytes")

    # Finding with output_template pointing to subfolder
    template = "Videos/Numpy Tutorial/12 - Numpy Part 12 - Broadcasting.mp4"
    res = mgr._find_downloaded_file("12 - Numpy Part 12 - Broadcasting.mp4", output_template=template)
    assert res == str(test_file)

    # Stem match with different container inside subfolder
    res_mkv = mgr._find_downloaded_file("12 - Numpy Part 12 - Broadcasting.mkv", output_template=template)
    assert res_mkv == str(test_file)



