@echo off
set "RADAR_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%RADAR_NODE%" set "RADAR_NODE=node"
"%RADAR_NODE%" "%~dp0launcher.cjs" --stop
