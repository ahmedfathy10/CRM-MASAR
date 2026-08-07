@echo off
setlocal enabledelayedexpansion
title Masar CRM Server - Production

cd /d "%~dp0"

REM Check Node.js
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js is not found. Please install Node.js 22 or newer.
  pause
  exit /b 1
)

REM Check node_modules
if not exist "node_modules" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Failed to install dependencies.
    pause
    exit /b 1
  )
)

REM Check if port 3001 is in use
netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul
if not errorlevel 1 (
  echo Port 3001 is already in use.
  echo Please close the existing server or use a different port.
  pause
  exit /b 1
)

echo.
echo ============================================
echo Building Masar CRM for Production
echo ============================================
echo.

REM Build the project
set "WRANGLER_LOG_PATH=.wrangler\wrangler.log"
node node_modules\vinext\dist\cli.js build
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)

echo.
echo ============================================
echo Starting Masar CRM Server - Production
echo ============================================
echo Port: 3001
echo URL: http://localhost:3001/
echo.
echo Press Ctrl+C to stop the server
echo ============================================
echo.

REM Start the production server
node node_modules\vinext\dist\cli.js start --port 3001

pause
