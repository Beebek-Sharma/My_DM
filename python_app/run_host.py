#!/usr/bin/env python3
"""
Simple wrapper to run mydm_host as native messaging host
This is needed because native messaging hosts on Windows need to be
direct executables or batch files, not Python scripts.
"""

import sys
import os

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    from mydm_host import NativeMessagingHost
    
    # Create and run the host
    host = NativeMessagingHost()
    host.run()
except Exception as e:
    import traceback
    # Log to stderr so Chrome can capture it
    sys.stderr.write(f"FATAL ERROR: {str(e)}\n")
    sys.stderr.write(traceback.format_exc())
    sys.exit(1)
