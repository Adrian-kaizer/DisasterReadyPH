@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js is required. Install Node.js 22.5 or newer, then try again.
    pause
    exit /b 1
)

call :checkServer
if errorlevel 1 (
    start "DisasterReady PH server" /D "%~dp0" cmd /k "node server.js"

    for /L %%I in (1,1,15) do (
        timeout /t 1 /nobreak >nul
        call :checkServer
        if not errorlevel 1 goto openApp
    )

    echo The app server did not start at http://127.0.0.1:3000.
    echo Check the "DisasterReady PH server" window for the startup error.
    pause
    exit /b 1
)

goto openApp

:checkServer
node -e "fetch('http://127.0.0.1:3000/api/session').then(response => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))" >nul 2>nul
exit /b %errorlevel%

:openApp
start "" "http://127.0.0.1:3000/"
exit /b 0
