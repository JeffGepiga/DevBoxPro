@echo off
setlocal

set "DISTRO=Ubuntu"
set "SCRIPT_PATH="

for /f "delims=" %%I in ('wsl.exe wslpath -a "%~dp0start-devboxpro-linux.sh"') do set "SCRIPT_PATH=%%I"

if not defined SCRIPT_PATH (
  echo Could not resolve the WSL path for start-devboxpro-linux.sh.
  pause
  exit /b 1
)

echo Launching DevBox Pro from Ubuntu...
wsl.exe -d %DISTRO% -- bash "%SCRIPT_PATH%"
if errorlevel 1 (
  echo Failed to launch DevBox Pro in Ubuntu.
  echo Expected AppImage under ~/devboxpro-wsl/dist or an installed devbox-pro binary.
  pause
  exit /b 1
)

echo DevBox Pro launch command sent to Ubuntu.
exit /b 0