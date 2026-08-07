@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Deploy-Update.ps1"
if errorlevel 1 (
  echo.
  echo Deployment failed. Review the message above.
  pause
  exit /b 1
)
echo.
pause
