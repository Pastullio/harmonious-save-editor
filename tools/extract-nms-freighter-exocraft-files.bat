@echo off
rem Double-click this to collect No Man's Sky freighter and exocraft model files for Harmonious Save Editor.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-nms-model-files.ps1" -Sets freighters,exocraft
echo.
pause
