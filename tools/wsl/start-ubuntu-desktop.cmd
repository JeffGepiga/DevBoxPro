@echo off
setlocal

set "DISTRO=Ubuntu"
set "PORT=3390"
set "MSTSC=%SystemRoot%\System32\mstsc.exe"
set "MSRDC=%ProgramFiles%\WSL\msrdc.exe"
set "RDP_CLIENT="
set "RDP_FILE=%TEMP%\ubuntu-wsl-xrdp.rdp"

echo Starting %DISTRO%...
wsl.exe -d %DISTRO% -- bash -lc "true"
if errorlevel 1 (
  echo Failed to start WSL distro %DISTRO%.
  pause
  exit /b 1
)

echo Ensuring XRDP is running on port %PORT%...
wsl.exe -d %DISTRO% -- bash -lc "if systemctl is-active --quiet xrdp && systemctl is-active --quiet xrdp-sesman; then exit 0; fi; echo XRDP is not running. Sudo may prompt for your Ubuntu password.; sudo systemctl restart xrdp xrdp-sesman"
if errorlevel 1 (
  echo XRDP could not be started.
  pause
  exit /b 1
)

if exist "%MSTSC%" (
  set "RDP_CLIENT=%MSTSC%"
)

if not defined RDP_CLIENT if exist "%MSRDC%" (
  set "RDP_CLIENT=%MSRDC%"
)

if not defined RDP_CLIENT (
  echo No Remote Desktop client was found.
  echo Checked:
  echo   %MSTSC%
  echo   %MSRDC%
  pause
  exit /b 1
)

echo Opening Remote Desktop to 127.0.0.1:%PORT%...
if /I "%RDP_CLIENT%"=="%MSRDC%" (
  > "%RDP_FILE%" echo full address:s:127.0.0.1:%PORT%
  >> "%RDP_FILE%" echo prompt for credentials:i:1
  >> "%RDP_FILE%" echo username:s:jeff
  start "" "%RDP_CLIENT%" "%RDP_FILE%"
) else (
  start "" "%RDP_CLIENT%" /v:127.0.0.1:%PORT%
)
exit /b 0