import subprocess
import sys
from pathlib import Path
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent

def test_extension_javascript_syntax():
    script_path = REPO_ROOT / 'scripts' / 'check_js_syntax.js'
    files_to_check = [
        str(REPO_ROOT / 'extension' / 'background.js'),
        str(REPO_ROOT / 'extension' / 'content.js'),
        str(REPO_ROOT / 'extension' / 'popup.js'),
        str(REPO_ROOT / 'extension' / 'engine' / 'state_machine.js'),
        str(REPO_ROOT / 'extension' / 'engine' / 'filename_util.js'),
        str(REPO_ROOT / 'extension' / 'engine' / 'rules_engine.js'),
        str(REPO_ROOT / 'extension' / 'engine' / 'speed_tracker.js'),
        str(REPO_ROOT / 'extension' / 'engine' / 'download_store.js'),
        str(REPO_ROOT / 'extension' / 'engine' / 'download_manager.js'),
    ]
    res = subprocess.run(['node', str(script_path), *files_to_check], capture_output=True, text=True)
    assert res.returncode == 0, f"JS Syntax errors:\n{res.stdout}\n{res.stderr}"

def test_extension_modules_automated_suite():
    test_runner = REPO_ROOT / 'tests' / 'test_extension_modules.js'
    res = subprocess.run(['node', str(test_runner)], capture_output=True, text=True)
    assert res.returncode == 0, f"Extension JS test suite failed:\n{res.stdout}\n{res.stderr}"
