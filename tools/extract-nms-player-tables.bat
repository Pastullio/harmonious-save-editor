@echo off
rem Double-click this to collect only the tables that say which parts and colours your traveller wears (small).
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0extract-nms-model-files.ps1" -Sets "" -Patterns "*metadata/gamestate/playerdata/*.mbin"
echo.
pause
