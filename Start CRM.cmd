@echo off
setlocal
title Masar CRM Launcher

cd /d "%~dp0"

set "CRM_NODE_DIR="
where node.exe >nul 2>nul
if not errorlevel 1 (
  for %%I in (node.exe) do set "CRM_NODE_DIR=%%~dp$PATH:I"
)

if not defined CRM_NODE_DIR if exist "C:\Users\ahmed\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" (
  set "CRM_NODE_DIR=C:\Users\ahmed\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\"
)

if not defined CRM_NODE_DIR (
  echo.
  echo Node.js was not found.
  echo Install Node.js 22 or newer, then run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules\vinext\dist\cli.js" (
  echo.
  echo Project packages are missing.
  echo Open Codex and ask it to install the project packages first.
  echo.
  pause
  exit /b 1
)

set "PATH=%CRM_NODE_DIR%;%PATH%"

netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul
if not errorlevel 1 (
  echo.
  echo Port 3001 is already in use by an old server window.
  echo Close the old CRM server window, then run this file again.
  echo.
  pause
  exit /b 1
)

echo Starting Masar CRM...
echo Keep the server window open while using the system.

powershell.exe -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 7; Start-Process 'http://localhost:3001/'"

echo.
echo CRM address: http://localhost:3001/
echo Do not close this window while using the system.
echo Press Ctrl+C when you want to stop the server.
echo.

set "WRANGLER_LOG_PATH=.wrangler\wrangler.log"
node node_modules\vinext\dist\cli.js dev --port 3001 --strictPort

echo.
echo The CRM server has stopped.
pause

endlocal
