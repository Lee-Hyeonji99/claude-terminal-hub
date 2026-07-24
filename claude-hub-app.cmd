@echo off
REM Claude Terminal Hub - Electron app (detached, no console window)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0electron\main.js"
