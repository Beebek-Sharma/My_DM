import sys
from pathlib import Path

# Add python_app directory to sys.path for test discovery
REPO_ROOT = Path(__file__).resolve().parent.parent
PYTHON_APP_DIR = REPO_ROOT / 'python_app'
if str(PYTHON_APP_DIR) not in sys.path:
    sys.path.insert(0, str(PYTHON_APP_DIR))
