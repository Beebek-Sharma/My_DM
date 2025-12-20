@echo off
echo ========================================
echo MyDM Extension - Complete Reset
echo ========================================
echo.

echo [1/5] Killing all Python processes...
taskkill /F /IM python.exe /T >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo OK - Python processes killed
) else (
    echo OK - No Python processes running
)

echo.
echo [2/5] Clearing Python cache...
if exist "%~dp0python_app\__pycache__\" (
    rmdir /S /Q "%~dp0python_app\__pycache__"
    echo OK - Cache cleared
) else (
    echo OK - No cache to clear
)

echo.
echo [3/5] Testing Python imports...
cd /d "%~dp0"
where py >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    py -3 -c "import sys; sys.path.insert(0, 'python_app'); from mydm_host import NativeMessagingHost; print('OK - Imports successful')"
) else (
    where python >nul 2>nul
    if %ERRORLEVEL% EQU 0 (
        python -c "import sys; sys.path.insert(0, 'python_app'); from mydm_host import NativeMessagingHost; print('OK - Imports successful')"
    ) else (
        echo ERROR - Python not found on PATH!
        pause
        exit /b 1
    )
)
if %ERRORLEVEL% NEQ 0 (
    echo ERROR - Python imports failed!
    pause
    exit /b 1
)

echo.
echo [4/5] Checking registry...
reg query "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mydm.native" >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo OK - Registry configured
) else (
    echo ERROR - Registry not configured!
    echo Run: REG ADD "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.mydm.native" /ve /t REG_SZ /d "%~dp0python_app\com.mydm.native.json" /f
    pause
    exit /b 1
)

echo.
echo ========================================
echo All checks passed!
echo ========================================
echo.
echo IMPORTANT: You MUST do these steps:
echo.
echo 1. Close ALL Chrome windows
echo 2. Open Task Manager (Ctrl+Shift+Esc)
echo 3. End ALL "Google Chrome" processes
echo 4. Wait 5 seconds
echo 5. Reopen Chrome
echo 6. Go to chrome://extensions
echo 7. Click reload on MyDM extension
echo 8. Try downloading a video
echo.
echo ========================================
pause
