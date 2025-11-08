# MyDM Registry Configuration Fix Script
# Run this script as Administrator to fix the "native messaging host not found" error

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "  MyDM - Registry Configuration Helper" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""

# Check if running as Administrator
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole] "Administrator")
if (-not $isAdmin) {
    Write-Host "[WARNING] This script needs to run as Administrator!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please follow these steps:" -ForegroundColor Yellow
    Write-Host "1. Open PowerShell" -ForegroundColor White
    Write-Host "2. Right-click -> 'Run as administrator'" -ForegroundColor White
    Write-Host "3. Run: Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process" -ForegroundColor White
    Write-Host "4. Run the script again" -ForegroundColor White
    Write-Host ""
    exit 1
}

# Get the script directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$pythonAppDir = Join-Path $scriptDir "python_app"
$manifestPath = Join-Path $pythonAppDir "com.mydm.native.json"
$hostScript = Join-Path $pythonAppDir "mydm_host.py"

Write-Host "[PATHS]" -ForegroundColor Yellow
Write-Host "   Script Directory: $scriptDir" -ForegroundColor Gray
Write-Host "   Python App Directory: $pythonAppDir" -ForegroundColor Gray
Write-Host "   Manifest File: $manifestPath" -ForegroundColor Gray
Write-Host "   Host Script: $hostScript" -ForegroundColor Gray
Write-Host ""

# Step 1: Get Extension ID from Chrome
Write-Host "[STEP 1] Get Your Extension ID" -ForegroundColor Yellow
Write-Host "   Go to: chrome://extensions/" -ForegroundColor White
Write-Host "   Find: 'MyDM - Download Manager'" -ForegroundColor White
Write-Host "   Copy: The ID (32 characters)" -ForegroundColor White
Write-Host ""
$extensionId = Read-Host "Paste your Extension ID here"

if ($extensionId.Length -ne 32) {
    Write-Host "[ERROR] Invalid Extension ID (must be 32 characters)" -ForegroundColor Red
    exit 1
}

Write-Host "[OK] Extension ID: $extensionId" -ForegroundColor Green
Write-Host ""

# Step 2: Update the manifest JSON
Write-Host "[STEP 2] Updating manifest JSON..." -ForegroundColor Yellow

$manifest = @{
    "name" = "com.mydm.native"
    "description" = "MyDM Python Native Host for Chrome Extension"
    "path" = $hostScript -replace '\\', '\\'
    "type" = "stdio"
    "allowed_origins" = @(
        "chrome-extension://$extensionId/"
    )
} | ConvertTo-Json

try {
    $manifest | Out-File -FilePath $manifestPath -Encoding UTF8 -Force
    Write-Host "[OK] Manifest JSON updated successfully" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Failed to update manifest: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[STEP 3] Registering in Windows Registry..." -ForegroundColor Yellow

# Registry paths for Chrome and Edge
$chromeRegPath = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.mydm.native"
$edgeRegPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.mydm.native"

# Create Chrome registry entry
try {
    if (-not (Test-Path (Split-Path $chromeRegPath))) {
        New-Item -Path (Split-Path $chromeRegPath) -Force | Out-Null
    }
    New-Item -Path $chromeRegPath -Force | Out-Null
    New-ItemProperty -Path $chromeRegPath -Name "(Default)" -Value $manifestPath -PropertyType String -Force | Out-Null
    Write-Host "[OK] Chrome registry entry created" -ForegroundColor Green
} catch {
    Write-Host "[WARNING] Chrome registry entry failed: $_" -ForegroundColor Yellow
}

# Create Edge registry entry
try {
    if (-not (Test-Path (Split-Path $edgeRegPath))) {
        New-Item -Path (Split-Path $edgeRegPath) -Force | Out-Null
    }
    New-Item -Path $edgeRegPath -Force | Out-Null
    New-ItemProperty -Path $edgeRegPath -Name "(Default)" -Value $manifestPath -PropertyType String -Force | Out-Null
    Write-Host "[OK] Edge registry entry created" -ForegroundColor Green
} catch {
    Write-Host "[WARNING] Edge registry entry failed: $_" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "[STEP 4] Verifying setup..." -ForegroundColor Yellow

# Verify manifest file exists
if (Test-Path $manifestPath) {
    Write-Host "[OK] Manifest file exists" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Manifest file not found" -ForegroundColor Red
    exit 1
}

# Verify Python host exists
if (Test-Path $hostScript) {
    Write-Host "[OK] Python host script exists" -ForegroundColor Green
} else {
    Write-Host "[ERROR] Python host script not found" -ForegroundColor Red
    exit 1
}

# Verify Python is installed
try {
    $pythonVersion = python --version 2>&1
    Write-Host "[OK] Python installed: $pythonVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Python not found or not in PATH" -ForegroundColor Red
    Write-Host "   Install Python 3.7+ from https://python.org" -ForegroundColor Yellow
    exit 1
}

# Verify requests module
try {
    python -c "import requests" 2>&1 | Out-Null
    Write-Host "[OK] requests module installed" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] requests module not installed" -ForegroundColor Red
    Write-Host "   Run: pip install requests" -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "====================================================================" -ForegroundColor Green
Write-Host "  Registry Configuration Complete!" -ForegroundColor Green
Write-Host "====================================================================" -ForegroundColor Green
Write-Host ""

Write-Host "[NEXT STEPS]" -ForegroundColor Yellow
Write-Host ""
Write-Host "1. Close Chrome completely (all windows)" -ForegroundColor White
Write-Host "2. Reopen Chrome" -ForegroundColor White
Write-Host "3. Right-click a file link on any website" -ForegroundColor White
Write-Host "4. Select 'Download with MyDM'" -ForegroundColor White
Write-Host ""

Write-Host "[TEST CONNECTION]" -ForegroundColor Yellow
Write-Host "1. Go to: chrome://extensions/" -ForegroundColor White
Write-Host "2. Find MyDM -> Click Details -> Inspect views -> service_worker" -ForegroundColor White
Write-Host "3. Open DevTools console (F12)" -ForegroundColor White
Write-Host "4. Paste: chrome.runtime.connectNative('com.mydm.native')" -ForegroundColor White
Write-Host "5. Should connect without errors" -ForegroundColor White
Write-Host ""

Write-Host "[SUMMARY]" -ForegroundColor Cyan
Write-Host "   Extension ID: $extensionId" -ForegroundColor Gray
Write-Host "   Manifest Path: $manifestPath" -ForegroundColor Gray
Write-Host "   Host Script: $hostScript" -ForegroundColor Gray
Write-Host ""

Write-Host "[TROUBLESHOOTING]" -ForegroundColor Yellow
Write-Host "   Check logs at: %APPDATA%\Local\MyDM\host.log" -ForegroundColor White
Write-Host "   Restart Chrome completely" -ForegroundColor White
Write-Host "   Re-run this script if needed" -ForegroundColor White
Write-Host ""

Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host "Ready to download faster!" -ForegroundColor Cyan
Write-Host "====================================================================" -ForegroundColor Cyan
Write-Host ""
