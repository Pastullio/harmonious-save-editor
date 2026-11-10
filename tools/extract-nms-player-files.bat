@echo off
rem Double-click this to collect your No Man's Sky traveller's model files for Harmonious Save Editor (pose your character in Blender).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-nms-model-files.ps1" -Sets player
echo.
pause
