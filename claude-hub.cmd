@echo off
REM Claude Terminal Hub launcher (app window). Use "claude-hub tab" for a browser tab.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch.ps1" %*
