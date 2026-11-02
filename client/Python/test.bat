@echo off
setlocal EnableExtensions
title ESP32-CAM - Python Camera Console

rem One command: test
rem The Python client detects the correct USB COM port automatically.
if not exist "%~dp0camera_cli.bat" (
    echo ERROR: camera_cli.bat must be in the same directory as test.bat.
    exit /b 1
)

call "%~dp0camera_cli.bat" %*
exit /b %ERRORLEVEL%

