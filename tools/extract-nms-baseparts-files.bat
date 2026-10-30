@echo off
rem Double-click this to collect No Man's Sky base-building part models (walls, pipes, lights) for Harmonious Save Editor.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-nms-model-files.ps1" -Sets baseparts
echo.
pause
