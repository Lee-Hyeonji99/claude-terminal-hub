@echo off
REM Claude Terminal Hub - Electron app, detached, no console window
setlocal
set "ROOT=%~dp0"
set "ELECTRON_EXE=%ROOT%node_modules\electron\dist\electron.exe"
set "BRANDED_EXE=%ROOT%node_modules\electron\dist\Claude Terminal Hub.exe"

if not exist "%ELECTRON_EXE%" (
    echo [claude-hub-app] Electron binary not found: %ELECTRON_EXE%
    choice /C YN /N /T 15 /D N /M "Install it now via npm install? [Y/N, defaults to N in 15s]"
    if errorlevel 2 (
        echo [claude-hub-app] Skipped. Run npm install manually and try again.
        exit /b 1
    )
    echo [claude-hub-app] Installing... this may take a while.
    pushd "%ROOT%"
    call npm install
    if not exist "%ELECTRON_EXE%" (
        echo [claude-hub-app] Retrying Electron binary download...
        call node node_modules\electron\install.js
    )
    popd
    if not exist "%ELECTRON_EXE%" (
        echo [claude-hub-app] Still missing after install. Please check manually.
        exit /b 1
    )
)

if not exist "%BRANDED_EXE%" (
    echo [claude-hub-app] Branding app exe...
    pushd "%ROOT%"
    call node electron\brand-exe.js
    popd
)
if exist "%BRANDED_EXE%" (
    start "" "%BRANDED_EXE%" "%ROOT%electron\main.js"
) else (
    start "" "%ELECTRON_EXE%" "%ROOT%electron\main.js"
)
