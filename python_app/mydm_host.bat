@echo off
REM MyDM Native Host Wrapper
REM This batch file properly executes the Python host with stdin/stdout piping

setlocal enabledelayedexpansion

REM Get the directory where this script is located
set SCRIPT_DIR=%~dp0

REM Call Python with the host script
"C:\Users\bibek\AppData\Local\Programs\Python\Python313\python.exe" "%SCRIPT_DIR%mydm_host.py"

REM Exit with the same code as Python
exit /b %ERRORLEVEL%
