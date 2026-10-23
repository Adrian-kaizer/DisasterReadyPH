@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required. Install Node.js 22.5 or newer, then try again.
    pause
    exit /b 1
)

node create-admin.js %*
if errorlevel 1 (
    echo.
    echo Admin account setup did not complete.
    pause
    exit /b 1
)

echo.
pause
