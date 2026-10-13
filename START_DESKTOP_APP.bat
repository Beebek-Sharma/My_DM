@echo off
title MyDM - Cyber Telemetry Desktop Manager
cd /d "%~dp0"

echo ========================================================
echo   Launching MyDM Desktop Application (v2.4 Pro)
echo   Engine: Multi-Segment HTTP + yt-dlp + Edge WebView2
echo ========================================================
echo.

python -m python_app.desktop

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Application exited with error code %ERRORLEVEL%.
    echo Make sure dependencies are installed: pip install -r requirements.txt pywebview
    pause
)
