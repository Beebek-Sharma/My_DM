#!/usr/bin/env python3
"""
MyDM Native Messaging Host
Communicates with Chrome extension via stdin/stdout using JSON protocol
Handles download commands and reports progress back to extension
"""

import sys
import json
import os
import struct
import threading
import time
from pathlib import Path

# Add current directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from downloader import DownloadManager


class NativeMessagingHost:
    """Handles native messaging protocol with Chrome extension"""

    def __init__(self):
        """Initialize the native messaging host"""
        # Use user's Downloads folder by default
        downloads_dir = str(Path.home() / 'Downloads')
        
        # Create download manager
        self.download_manager = DownloadManager(
            download_dir=downloads_dir,
            num_threads=8
        )

        # Track message queue for threading
        self.running = True

    def read_message(self):
        """
        Read a message from stdin (Chrome's native messaging protocol)
        Format: [4-byte length][JSON payload]
        
        Returns:
            dict: Parsed JSON message or None on error
        """
        try:
            # Read the message length (first 4 bytes, little-endian)
            length_bytes = sys.stdin.buffer.read(4)
            if not length_bytes or len(length_bytes) != 4:
                return None

            message_length = struct.unpack('I', length_bytes)[0]

            # Read the message content
            message_data = sys.stdin.buffer.read(message_length)
            if not message_data:
                return None

            # Parse JSON
            message = json.loads(message_data.decode('utf-8'))
            return message

        except Exception as e:
            self.log(f"Error reading message: {str(e)}")
            return None

    def send_message(self, message):
        """
        Send a message to stdout (Chrome's native messaging protocol)
        Format: [4-byte length][JSON payload]
        
        Args:
            message: Dictionary to send as JSON
        """
        try:
            message_json = json.dumps(message)
            message_bytes = message_json.encode('utf-8')
            message_length = struct.pack('I', len(message_bytes))

            # Write length + message
            sys.stdout.buffer.write(message_length)
            sys.stdout.buffer.flush()
            sys.stdout.buffer.write(message_bytes)
            sys.stdout.buffer.flush()

        except Exception as e:
            self.log(f"Error sending message: {str(e)}")

    def log(self, message, level="INFO"):
        """
        Log a message to a file (for debugging)
        
        Args:
            message: Message to log
            level: Log level (INFO, WARNING, ERROR)
        """
        try:
            log_file = Path.home() / 'AppData' / 'Local' / 'MyDM' / 'host.log'
            log_file.parent.mkdir(parents=True, exist_ok=True)
            
            with open(log_file, 'a', encoding='utf-8') as f:
                timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
                f.write(f"[{timestamp}] [{level}] {message}\n")
        except:
            # Silently fail if logging fails
            pass

    def on_progress(self, download_id, filename, percent, speed, total_size, downloaded):
        """Callback for download progress"""
        message = {
            'event': 'progress',
            'id': download_id,
            'filename': filename,
            'percent': percent,
            'speed': speed,
            'size': total_size,
            'downloaded': downloaded
        }
        self.send_message(message)
        self.log(f"Progress: {filename} - {percent}% ({speed})")

    def on_complete(self, download_id, filename, file_path):
        """Callback for download completion"""
        message = {
            'event': 'complete',
            'id': download_id,
            'filename': filename,
            'file': file_path,
            'percent': 100
        }
        self.send_message(message)
        self.log(f"Complete: {filename}")

    def on_error(self, download_id, error_message):
        """Callback for download errors"""
        message = {
            'event': 'error',
            'id': download_id,
            'error': error_message
        }
        self.send_message(message)
        self.log(f"Error: {error_message}")

    def handle_download_command(self, message):
        """
        Handle download command from extension
        
        Args:
            message: Message with 'url' and optional 'referer' fields
        """
        url = message.get('url')
        referer = message.get('referer')

        if not url:
            self.send_message({
                'event': 'error',
                'error': 'No URL provided'
            })
            return

        try:
            self.log(f"Starting download: {url}")

            # Start download
            download_id = self.download_manager.start_download(
                url=url,
                referer=referer,
                on_progress=self.on_progress,
                on_complete=self.on_complete,
                on_error=self.on_error
            )

            # Send acknowledgment
            self.send_message({
                'event': 'started',
                'id': download_id
            })

        except Exception as e:
            self.log(f"Failed to start download: {str(e)}")
            self.send_message({
                'event': 'error',
                'error': str(e)
            })

    def handle_pause_command(self, message):
        """Handle pause command"""
        download_id = message.get('id')
        
        if not download_id:
            self.send_message({
                'event': 'error',
                'error': 'No download ID provided'
            })
            return

        try:
            self.download_manager.pause_download(download_id)
            self.send_message({
                'event': 'paused',
                'id': download_id
            })
            self.log(f"Paused: {download_id}")
        except Exception as e:
            self.send_message({
                'event': 'error',
                'error': str(e)
            })

    def handle_resume_command(self, message):
        """Handle resume command"""
        download_id = message.get('id')
        
        if not download_id:
            self.send_message({
                'event': 'error',
                'error': 'No download ID provided'
            })
            return

        try:
            self.download_manager.resume_download(download_id)
            self.send_message({
                'event': 'resumed',
                'id': download_id
            })
            self.log(f"Resumed: {download_id}")
        except Exception as e:
            self.send_message({
                'event': 'error',
                'error': str(e)
            })

    def handle_cancel_command(self, message):
        """Handle cancel command"""
        download_id = message.get('id')
        
        if not download_id:
            self.send_message({
                'event': 'error',
                'error': 'No download ID provided'
            })
            return

        try:
            self.download_manager.cancel_download(download_id)
            self.send_message({
                'event': 'cancelled',
                'id': download_id
            })
            self.log(f"Cancelled: {download_id}")
        except Exception as e:
            self.send_message({
                'event': 'error',
                'error': str(e)
            })

    def run(self):
        """Main message loop"""
        self.log("MyDM Native Host Started")
        
        try:
            while self.running:
                # Read message from Chrome
                message = self.read_message()
                
                if not message:
                    break

                self.log(f"Received command: {message.get('command')}")

                # Handle different commands
                command = message.get('command')

                if command == 'download':
                    self.handle_download_command(message)
                elif command == 'pause':
                    self.handle_pause_command(message)
                elif command == 'resume':
                    self.handle_resume_command(message)
                elif command == 'cancel':
                    self.handle_cancel_command(message)
                else:
                    self.log(f"Unknown command: {command}")
                    self.send_message({
                        'event': 'error',
                        'error': f'Unknown command: {command}'
                    })

        except KeyboardInterrupt:
            self.log("Native Host Interrupted")
        except Exception as e:
            self.log(f"Fatal error: {str(e)}")
        finally:
            self.log("MyDM Native Host Stopped")
            self.running = False


def main():
    """Entry point for the native messaging host"""
    try:
        host = NativeMessagingHost()
        host.run()
    except Exception as e:
        # Log the error
        try:
            log_file = Path.home() / 'AppData' / 'Local' / 'MyDM' / 'host.log'
            log_file.parent.mkdir(parents=True, exist_ok=True)
            with open(log_file, 'a', encoding='utf-8') as f:
                timestamp = time.strftime('%Y-%m-%d %H:%M:%S')
                f.write(f"[{timestamp}] [FATAL] {str(e)}\n")
        except:
            pass


if __name__ == '__main__':
    main()
