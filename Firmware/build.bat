@echo off
setlocal EnableExtensions
title ESP32-CAM - Build Firmware

echo ============================================================
echo ESP32-CAM - Compile Firmware
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
echo Running: pio run -e esp32cam
echo.
pushd "%PROJECT_DIR%"
"%PIO_EXE%" run -e esp32cam
set "EXIT_CODE=%ERRORLEVEL%"
popd

:finished
echo.
if "%EXIT_CODE%"=="0" (
    echo [PASS] Firmware compiled successfully.
    echo Output: .pio\build\esp32cam\firmware.bin
) else (
    echo [FAIL] Firmware build returned exit code %EXIT_CODE%.
)
echo.
pause
exit /b %EXIT_CODE%

