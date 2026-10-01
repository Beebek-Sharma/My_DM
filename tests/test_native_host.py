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

