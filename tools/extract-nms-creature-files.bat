@echo off
rem Double-click this to collect No Man's Sky creature model descriptions for Harmonious Save Editor (companion pictures).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-nms-model-files.ps1" -Sets creatures
echo.
pause
