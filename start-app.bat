@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required. Install Node.js 22.5 or newer, then try again.
    pause
    exit /b 1
)

powershell -NoProfile -Command "$listeners = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; if ($listeners | Where-Object { $_.LocalAddress -eq '0.0.0.0' }) { exit 0 } elseif ($listeners) { exit 2 } else { exit 1 }"
if errorlevel 2 (
    echo A server that is not shareable is already using port 3000.
    echo Close its server window, then run start-app.bat again.
    pause
    exit /b 1
)
if errorlevel 1 (
    start "DisasterReady PH server" /D "%~dp0" cmd /k "node server.js"
    timeout /t 2 /nobreak >nul
)

start "" "http://127.0.0.1:3000/"
