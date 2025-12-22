@echo off
setlocal enabledelayedexpansion

set "SCRIPT_DIR=%~dp0"

REM Prefer the repo-local venv if present (most reliable for packaged deps).
set "VENV_PY=%SCRIPT_DIR%..\.venv\Scripts\python.exe"
if exist "%VENV_PY%" (
	"%VENV_PY%" -u "%SCRIPT_DIR%run_host.py"
	exit /b %ERRORLEVEL%
)

REM Native messaging requires reliable stdio; run Python unbuffered.
REM Prefer the Windows py launcher, fall back to python on PATH.

where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
	py -3 -u "%SCRIPT_DIR%run_host.py"
	exit /b %ERRORLEVEL%
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
	python -u "%SCRIPT_DIR%run_host.py"
	exit /b %ERRORLEVEL%
)

>&2 echo ERROR: Python not found. Install Python 3.7+ or ensure it is on PATH.
exit /b 1
