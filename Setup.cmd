@echo off
cd /d "%~dp0"
call npm ci
if errorlevel 1 goto fail
call npm run build
if errorlevel 1 goto fail
echo Ready. Double-click Open-Sonail.cmd to launch.
pause
exit /b 0
:fail
echo Setup failed. Install Node.js 22 or 24 and Git, then try again.
pause
exit /b 1
