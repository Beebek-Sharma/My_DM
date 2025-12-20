@echo off
REM MyDM Native Host Wrapper
REM This batch file executes the Python host with stdin/stdout piping.

setlocal enabledelayedexpansion
set "SCRIPT_DIR=%~dp0"

REM Native messaging requires reliable stdio; run Python unbuffered.
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
