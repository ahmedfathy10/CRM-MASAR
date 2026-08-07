@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Backup-Online-Data.ps1"
if errorlevel 1 (
  echo.
  echo Backup failed. Review the message above.
  pause
  exit /b 1
)
echo.
pause
