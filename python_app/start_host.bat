@echo off
setlocal enabledelayedexpansion
set SCRIPT_DIR=%~dp0
"C:\Users\bibek\AppData\Local\Programs\Python\Python313\python.exe" "%SCRIPT_DIR%run_host.py"
exit /b %ERRORLEVEL%
