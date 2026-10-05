import json
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

def test_extension_manifest_json():
    manifest_path = REPO_ROOT / 'extension' / 'manifest.json'
    assert manifest_path.exists()
    
    with open(manifest_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    assert data.get('manifest_version') == 3
    assert 'downloads' in data.get('permissions', [])
    assert 'downloads.open' in data.get('permissions', [])
    assert 'storage' in data.get('permissions', [])
    assert 'contextMenus' in data.get('permissions', [])
    assert data.get('background', {}).get('service_worker') == 'background.js'
    assert data.get('action', {}).get('default_popup') == 'popup.html'
    assert len(data.get('content_scripts', [])) > 0

def test_native_host_manifest_json():
    manifest_path = REPO_ROOT / 'python_app' / 'com.mydm.native.json'
    assert manifest_path.exists()
    
    with open(manifest_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
        
    assert data.get('name') == 'com.mydm.native'
    assert data.get('type') == 'stdio'
    assert isinstance(data.get('allowed_origins'), list)
    assert len(data.get('allowed_origins')) > 0
    assert 'path' in data
