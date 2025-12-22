# MyDM Windows Setup Script
# Run this script with PowerShell to automate the setup process

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "MyDM Setup Script for Windows" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Python installation
Write-Host "[1/5] Checking Python installation..." -ForegroundColor Yellow
function Get-PythonCommand {
    if (Get-Command py -ErrorAction SilentlyContinue) { return @('py', '-3') }
    if (Get-Command python -ErrorAction SilentlyContinue) { return @('python') }
    return $null
}

$pythonCmd = Get-PythonCommand
if (-not $pythonCmd) {
    Write-Host "ERROR: Python not found. Please install Python 3.7+ from https://python.org" -ForegroundColor Red
    exit 1
}

try {
    $pythonVersion = & $pythonCmd[0] @($pythonCmd[1..($pythonCmd.Length-1)] | Where-Object { $_ }) --version 2>&1
    Write-Host "OK: Python found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Python is installed but failed to run." -ForegroundColor Red
    exit 1
}

# Step 2: Create venv + install dependencies
Write-Host "[2/5] Creating venv and installing Python dependencies..." -ForegroundColor Yellow

# Repo root is where this script lives
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvDir = Join-Path $scriptDir ".venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsPath = Join-Path $scriptDir "requirements.txt"

try {
    if (-not (Test-Path $venvPython)) {
        Write-Host "- Creating virtual environment at: $venvDir" -ForegroundColor Gray
        & $pythonCmd[0] @($pythonCmd[1..($pythonCmd.Length-1)] | Where-Object { $_ }) -m venv $venvDir
    }

    Write-Host "- Upgrading pip..." -ForegroundColor Gray
    & $venvPython -m pip install --upgrade pip -q

    if (Test-Path $requirementsPath) {
        Write-Host "- Installing from requirements.txt..." -ForegroundColor Gray
        & $venvPython -m pip install -r $requirementsPath
    } else {
        Write-Host "✗ requirements.txt not found at: $requirementsPath" -ForegroundColor Red
        exit 1
    }

    Write-Host "OK: Dependencies installed into .venv" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Failed to create venv or install dependencies" -ForegroundColor Red
    Write-Host "  Error: $_" -ForegroundColor Red
    exit 1
}

# Step 3: Get script directory
$pythonAppDir = Join-Path $scriptDir "python_app"
$mydmHostPath = Join-Path $pythonAppDir "start_host.bat"

Write-Host "[3/5] Script path: $scriptDir" -ForegroundColor Cyan
Write-Host "      Python app path: $pythonAppDir" -ForegroundColor Cyan
Write-Host ""

# Step 4: Instructions for manual setup
Write-Host "[4/5] Manual Setup Required:" -ForegroundColor Yellow
Write-Host ""
Write-Host "WARNING: Please follow these manual steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open Chrome and go to: chrome://extensions/" -ForegroundColor White
Write-Host "2. Enable 'Developer mode' (toggle in top-right)" -ForegroundColor White
Write-Host "3. Click 'Load unpacked'" -ForegroundColor White
$extensionDir = Join-Path $scriptDir "extension"
Write-Host "4. Select: $extensionDir" -ForegroundColor White
Write-Host ""
Write-Host "5. NOTE the Extension ID shown (32 characters)" -ForegroundColor White
Write-Host ""
Write-Host "6. Edit file: $pythonAppDir\com.mydm.native.json" -ForegroundColor White
Write-Host "   - Replace path to start_host.bat" -ForegroundColor White
Write-Host "   - Replace REPLACE_WITH_YOUR_EXTENSION_ID with your Extension ID" -ForegroundColor White
Write-Host ""
Write-Host "7. Open Registry (Win+R, type 'regedit'):" -ForegroundColor White
Write-Host "   Navigate to: HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts" -ForegroundColor White
Write-Host "   (or for Edge: HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts)" -ForegroundColor White
Write-Host "   Create new Key: com.mydm.native" -ForegroundColor White
$manifestJsonPath = Join-Path $pythonAppDir "com.mydm.native.json"
Write-Host "   Set Default value to: $manifestJsonPath" -ForegroundColor White
Write-Host ""

# Step 5: Verify installation
Write-Host "[5/5] Verifying installation..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path (Join-Path $scriptDir "extension\manifest.json")) {
    Write-Host "OK: Extension files found" -ForegroundColor Green
} else {
    Write-Host "ERROR: Extension files not found" -ForegroundColor Red
}

if (Test-Path (Join-Path $pythonAppDir "start_host.bat")) {
    Write-Host "OK: Python host found" -ForegroundColor Green
} else {
    Write-Host "ERROR: Python host not found" -ForegroundColor Red
}

if (Test-Path (Join-Path $pythonAppDir "downloader.py")) {
    Write-Host "OK: Downloader module found" -ForegroundColor Green
} else {
    Write-Host "ERROR: Downloader module not found" -ForegroundColor Red
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Complete the manual registry setup above" -ForegroundColor White
Write-Host "2. Restart Chrome" -ForegroundColor White
Write-Host "3. Right-click any file and select 'Download with MyDM'" -ForegroundColor White
Write-Host ""
Write-Host "For troubleshooting, see: README.md" -ForegroundColor Cyan
Write-Host ""
