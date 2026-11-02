@echo off
setlocal EnableExtensions
title ESP32-CAM - Upload Firmware

echo ============================================================
echo ESP32-CAM - Compile and Upload to MCU
echo ============================================================
echo.

set "PROJECT_DIR=%~dp0"
set "EXIT_CODE=1"
if not exist "%PROJECT_DIR%platformio.ini" (
    echo ERROR: platformio.ini was not found next to this BAT file.
    goto finished
)

set "PIO_EXE=%USERPROFILE%\.platformio\penv\Scripts\platformio.exe"
if not exist "%PIO_EXE%" (
    where.exe pio >nul 2>&1
    if errorlevel 1 (
        echo ERROR: PlatformIO CLI not found.
        goto finished
    )
    set "PIO_EXE=pio"
)

echo Firmware project: "%PROJECT_DIR%"
echo Upload target: AI Thinker ESP32-CAM
echo.
echo Close any Serial Monitor or other program using the COM port.
echo.
pushd "%PROJECT_DIR%"
if "%~1"=="" (
    echo Detecting upload COM port automatically...
    "%PIO_EXE%" run -e esp32cam -t upload
) else (
    echo Using upload port: %~1
    "%PIO_EXE%" run -e esp32cam -t upload --upload-port "%~1"
)
set "EXIT_CODE=%ERRORLEVEL%"
popd

:finished
echo.
if "%EXIT_CODE%"=="0" (
    echo [PASS] Firmware uploaded successfully.
) else (
    echo [FAIL] Firmware upload returned exit code %EXIT_CODE%.
    echo If automatic COM detection failed, run: upload.bat COM4
    echo Replace COM4 with the actual port shown in Device Manager.
)
echo.
pause
exit /b %EXIT_CODE%
