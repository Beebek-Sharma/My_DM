# MyDM Windows Setup Script
# Run this script with PowerShell to automate the setup process

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "MyDM Setup Script for Windows" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check Python installation
Write-Host "[1/5] Checking Python installation..." -ForegroundColor Yellow
try {
    $pythonVersion = python --version 2>&1
    Write-Host "✓ Python found: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "✗ Python not found. Please install Python 3.7+ from https://python.org" -ForegroundColor Red
    exit 1
}

# Step 2: Install dependencies
Write-Host "[2/5] Installing Python dependencies..." -ForegroundColor Yellow
try {
    pip install requests -q
    Write-Host "✓ Dependencies installed" -ForegroundColor Green
} catch {
    Write-Host "✗ Failed to install dependencies" -ForegroundColor Red
    exit 1
}

# Step 3: Get script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonAppDir = Join-Path $scriptDir "python_app"
$mydmHostPath = Join-Path $pythonAppDir "mydm_host.py"

Write-Host "[3/5] Script path: $scriptDir" -ForegroundColor Cyan
Write-Host "      Python app path: $pythonAppDir" -ForegroundColor Cyan
Write-Host ""

# Step 4: Instructions for manual setup
Write-Host "[4/5] Manual Setup Required:" -ForegroundColor Yellow
Write-Host ""
Write-Host "⚠️  Please follow these manual steps:" -ForegroundColor Cyan
Write-Host ""
Write-Host "1. Open Chrome and go to: chrome://extensions/" -ForegroundColor White
Write-Host "2. Enable 'Developer mode' (toggle in top-right)" -ForegroundColor White
Write-Host "3. Click 'Load unpacked'" -ForegroundColor White
Write-Host "4. Select: $scriptDir\extension\" -ForegroundColor White
Write-Host ""
Write-Host "5. NOTE the Extension ID shown (32 characters)" -ForegroundColor White
Write-Host ""
Write-Host "6. Edit file: $pythonAppDir\com.mydm.native.json" -ForegroundColor White
Write-Host "   - Replace path to mydm_host.py" -ForegroundColor White
Write-Host "   - Replace REPLACE_WITH_YOUR_EXTENSION_ID with your Extension ID" -ForegroundColor White
Write-Host ""
Write-Host "7. Open Registry (Win+R, type 'regedit'):" -ForegroundColor White
Write-Host "   Navigate to: HKEY_CURRENT_USER\Software\Google\Chrome\NativeMessagingHosts" -ForegroundColor White
Write-Host "   (or for Edge: HKEY_CURRENT_USER\Software\Microsoft\Edge\NativeMessagingHosts)" -ForegroundColor White
Write-Host "   Create new Key: com.mydm.native" -ForegroundColor White
Write-Host "   Set Default value to: $pythonAppDir\com.mydm.native.json" -ForegroundColor White
Write-Host ""

# Step 5: Verify installation
Write-Host "[5/5] Verifying installation..." -ForegroundColor Yellow
Write-Host ""

if (Test-Path (Join-Path $scriptDir "extension\manifest.json")) {
    Write-Host "✓ Extension files found" -ForegroundColor Green
} else {
    Write-Host "✗ Extension files not found" -ForegroundColor Red
}

if (Test-Path (Join-Path $pythonAppDir "mydm_host.py")) {
    Write-Host "✓ Python host found" -ForegroundColor Green
} else {
    Write-Host "✗ Python host not found" -ForegroundColor Red
}

if (Test-Path (Join-Path $pythonAppDir "downloader.py")) {
    Write-Host "✓ Downloader module found" -ForegroundColor Green
} else {
    Write-Host "✗ Downloader module not found" -ForegroundColor Red
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
