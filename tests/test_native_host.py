import io
import json
import struct
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
import pytest

from mydm_host import NativeMessagingHost

def test_host_initialization(tmp_path):
    with patch.object(Path, 'home', return_value=tmp_path):
        host = NativeMessagingHost()
        assert host.download_manager is not None
        assert host.streaming_manager is not None
        assert host.running is True
        assert host.active_downloads == {}

def test_send_message_framing():
    fake_stdout = io.BytesIO()
    host = NativeMessagingHost(stdout=fake_stdout)
    
    msg = {'event': 'progress', 'id': 'test1', 'percent': 50}
    host.send_message(msg)

    data = fake_stdout.getvalue()
    assert len(data) >= 4
    length = struct.unpack('<I', data[:4])[0]
    payload = data[4:4+length].decode('utf-8')
    assert json.loads(payload) == msg

def test_read_message_framing():
    payload = json.dumps({'command': 'pause', 'id': 'dl123'}).encode('utf-8')
    length = struct.pack('<I', len(payload))
    fake_stdin = io.BytesIO(length + payload)
    host = NativeMessagingHost(stdin=fake_stdin)

    read_msg = host.read_message()
    assert read_msg == {'command': 'pause', 'id': 'dl123'}

def test_read_message_truncated():
    fake_stdin = io.BytesIO(b'\x05\x00\x00\x00abc')  # 5 bytes specified, only 3 provided
    host = NativeMessagingHost(stdin=fake_stdin)

    read_msg = host.read_message()
    assert read_msg is None

def test_handle_unknown_command():
    host = NativeMessagingHost()
    sent = []
    host.send_message = lambda m: sent.append(m)

    host.handle_download_command({})  # missing url
    assert any(m.get('event') == 'error' for m in sent)

def test_handle_pause_resume_cancel_flow(tmp_path):
    host = NativeMessagingHost()
    sent = []
    host.send_message = lambda m: sent.append(m)
    
    # Missing ID returns error
    host.handle_pause_command({})
    assert sent[-1]['event'] == 'error'

    host.handle_resume_command({})
    assert sent[-1]['event'] == 'error'

    host.handle_cancel_command({})
    assert sent[-1]['event'] == 'error'

    # Test streaming cancellation
    host.active_downloads['stream_123'] = 'streaming'
    with patch.object(host.streaming_manager, 'cancel_download', return_value=True) as mock_cancel:
        host.handle_cancel_command({'id': 'stream_123'})
        assert mock_cancel.called
        assert sent[-1]['event'] == 'cancelled'
        assert sent[-1]['id'] == 'stream_123'
        assert 'stream_123' not in host.active_downloads

def test_handle_show_in_folder(tmp_path):
    host = NativeMessagingHost(downloads_dir=str(tmp_path))
    dummy_file = tmp_path / "downloaded video.mp4"
    dummy_file.write_text("content", encoding="utf-8")

    with patch('subprocess.Popen') as mock_popen:
        host.handle_show_in_folder({'path': str(dummy_file)})
        assert mock_popen.called
        cmd_arg = mock_popen.call_args[0][0]
        # Must pass a formatted string with /select,"..." and not a list that quotes /select
        assert isinstance(cmd_arg, str)
        assert f'/select,"{dummy_file}"' in cmd_arg

def test_handle_open_file(tmp_path):
    host = NativeMessagingHost(downloads_dir=str(tmp_path))
    dummy_file = tmp_path / "video.mp4"
    dummy_file.write_text("test video", encoding="utf-8")

    sent = []
    host.send_message = lambda m: sent.append(m)

    with patch('os.startfile') as mock_startfile:
        host.handle_open_file({'path': str(dummy_file), 'id': 'dl_test'})
        assert mock_startfile.called
        assert mock_startfile.call_args[0][0] == str(dummy_file)
        assert sent[-1]['event'] == 'opened'

def test_handle_get_formats():
    host = NativeMessagingHost()
    sent = []
    host.send_message = lambda m: sent.append(m)

    mock_formats = {'title': 'Sample', 'formats': [{'label': '720p'}]}
    with patch.object(host.streaming_manager, 'extract_formats', return_value=mock_formats):
        host.handle_get_formats_command({'url': 'https://www.youtube.com/watch?v=123', 'id': 'fmt_1'})
        # Give thread a moment to finish
        import time
        time.sleep(0.1)
        assert len(sent) == 1
        assert sent[0]['event'] == 'formats'
        assert sent[0]['id'] == 'fmt_1'
        assert sent[0]['data']['title'] == 'Sample'

def test_handle_get_playlist_info():
    host = NativeMessagingHost()
    sent = []
    host.send_message = lambda m: sent.append(m)

    mock_playlist = {'is_playlist': True, 'title': 'Sample Playlist', 'item_count': 5, 'entries': []}
    with patch.object(host.streaming_manager, 'extract_playlist_info', return_value=mock_playlist):
        host.handle_get_playlist_command({'url': 'https://www.youtube.com/playlist?list=PL123', 'id': 'pl_1'})
        import time
        time.sleep(0.1)
        assert len(sent) == 1
        assert sent[0]['event'] == 'playlist_info'
        assert sent[0]['id'] == 'pl_1'
        assert sent[0]['data']['title'] == 'Sample Playlist'
        assert sent[0]['data']['item_count'] == 5


