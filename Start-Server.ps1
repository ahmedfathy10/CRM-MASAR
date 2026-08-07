# Masar CRM Server Startup Script (PowerShell)
# Usage: .\Start-Server.ps1

Set-Location $PSScriptRoot

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "Masar CRM Server Launcher" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
$nodeCheck = & where.exe node.exe 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Error: Node.js is not found." -ForegroundColor Red
    Write-Host "Please install Node.js 22 or newer." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

# Check node_modules
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    & npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Failed to install dependencies." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# Check if port 3001 is in use
$portInUse = netstat -ano | Select-String ":3001.*LISTENING"
if ($portInUse) {
    Write-Host "Error: Port 3001 is already in use." -ForegroundColor Red
    Write-Host "Please close the existing server or use a different port." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Port: 3001" -ForegroundColor Green
Write-Host "URL: http://localhost:3001/" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop the server" -ForegroundColor Yellow
Write-Host ""

# Start the server
$env:WRANGLER_LOG_PATH = ".wrangler\wrangler.log"
& node node_modules\vinext\dist\cli.js dev --port 3001
