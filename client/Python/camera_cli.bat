@echo off
setlocal EnableExtensions
title ESP32-CAM - Multi-Transport Command Console

set "PROJECT_DIR=%~dp0"
set "EXIT_CODE=1"

if not exist "%PROJECT_DIR%camera_cli.py" (
    echo ERROR: camera_cli.py must be in the same folder as this BAT file.
    goto finished
)

rem Prefer an interpreter with pyserial for USB/BT. HTTP/TCP need only Python 3.
set "PYTHON_EXE="
set "PYTHON_ARGS="
set "PLATFORMIO_PYTHON=%USERPROFILE%\.platformio\penv\Scripts\python.exe"
if exist "%PLATFORMIO_PYTHON%" (
    set "PYTHON_EXE=%PLATFORMIO_PYTHON%"
    "%PLATFORMIO_PYTHON%" -c "import serial" >nul 2>&1
    if not errorlevel 1 goto launch
)

where.exe py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=py"
    set "PYTHON_ARGS=-3"
    py -3 -c "import serial" >nul 2>&1
    if not errorlevel 1 goto launch
)

where.exe python >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_EXE=python"
    set "PYTHON_ARGS="
    python -c "import serial" >nul 2>&1
    if not errorlevel 1 goto launch
)

rem If no Python has pyserial, HTTP/TCP still work with the last found Python.
if defined PYTHON_EXE goto launch

echo ERROR: Python 3 was not found.
echo Install Python 3 and re-run this BAT file.
goto finished

:launch
echo Starting ESP32-CAM client console (automatic COM detection)...
echo.
pushd "%PROJECT_DIR%"
"%PYTHON_EXE%" %PYTHON_ARGS% "camera_cli.py" %*
set "EXIT_CODE=%ERRORLEVEL%"
popd

:finished
echo.
pause
exit /b %EXIT_CODE%
