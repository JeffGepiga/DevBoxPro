const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async installCli() {
    const alias = this.getAlias();
    const cliPath = this.getCliPath();

    await fs.ensureDir(cliPath);
    await this.syncProjectsFile();

    if (process.platform === 'win32') {
      await this.installWindowsCli(alias, cliPath);
    } else {
      await this.installUnixCli(alias, cliPath);
    }

    return {
      alias,
      path: cliPath,
      instructions: this.getInstallInstructions(cliPath),
    };
  },

  async installWindowsCli(alias, cliPath) {
    const resourcesPath = this.resourcesPath;
    const projectsFilePath = this.getProjectsFilePath();

    const psHelperContent = `param($ProjectsFile, $CurrentDir)
try {
  $projects = Get-Content $ProjectsFile -Raw | ConvertFrom-Json
  $currentDirLower = $CurrentDir.ToLower().Replace('/', '\\')
  foreach ($prop in $projects.PSObject.Properties) {
    $projPath = $prop.Name.ToLower().Replace('/', '\\')
    if ($currentDirLower.StartsWith($projPath) -or $currentDirLower -eq $projPath) {
      $php = if ($prop.Value.phpVersion) { $prop.Value.phpVersion } else { "8.3" }
      $node = if ($prop.Value.nodejsVersion) { $prop.Value.nodejsVersion } else { "" }
      $mt = if ($prop.Value.mysqlType) { $prop.Value.mysqlType } else { "mysql" }
      $mv = if ($prop.Value.mysqlVersion) { $prop.Value.mysqlVersion } else { "8.4" }
      $py = if ($prop.Value.services -and $prop.Value.services.pythonVersion) { $prop.Value.services.pythonVersion } else { "" }
      Write-Output "FOUND|$php|$node|$mt|$mv|$py"
      exit 0
    }
  }
  Write-Output "NOTFOUND||||"
} catch {
  Write-Output "NOTFOUND||||"
}
`;

    const psHelperPath = path.join(cliPath, 'find-project.ps1');
    await fs.writeFile(psHelperPath, psHelperContent, 'utf8');

    const batchContent = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro CLI Wrapper
REM This script routes commands through DevBox Pro to use project-specific versions

set "DEVBOX_RESOURCES=${resourcesPath.replace(/\\/g, '\\')}"
set "DEVBOX_CLI=${cliPath.replace(/\\/g, '\\')}"
set "DEVBOX_PROJECTS=${projectsFilePath.replace(/\\/g, '\\')}"

REM Get current directory
set "CURRENT_DIR=%CD%"

REM Check if we have arguments
if "%~1"=="" (
  echo DevBox Pro CLI Wrapper
  echo.
  echo Usage: ${alias} ^<command^> [arguments]
  echo.
  echo Commands:
  echo   php         - Run PHP with project-specific version
  echo   composer    - Run Composer with project's PHP version
  echo   node        - Run Node.js with project's Node.js version
  echo   npm         - Run npm with project's Node.js version
  echo   npx         - Run npx with project's Node.js version
  echo   mysql       - Run MySQL client with active database version
  echo   mysqldump   - Run mysqldump with active database version
  echo   python      - Run Python with project-specific version
  echo.
  echo Example:
  echo   ${alias} php artisan migrate
  echo   ${alias} npm install
  echo   ${alias} composer install
  echo   ${alias} mysql -u root
  echo   ${alias} python script.py
  exit /b 0
)

REM Check if projects.json exists
if not exist "%DEVBOX_PROJECTS%" (
  echo Warning: DevBox Pro projects file not found.
  echo Please open DevBox Pro and ensure CLI is installed.
  echo Running command with system defaults...
  %*
  exit /b %ERRORLEVEL%
)

REM Find matching project using PowerShell helper script
set "PROJECT_STATUS="
set "PHP_VERSION=8.3"
set "NODE_VERSION="
set "MYSQL_TYPE=mysql"
set "MYSQL_VERSION=8.4"

for /f "tokens=1,2,3,4,5,6 delims=|" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%DEVBOX_CLI%\\find-project.ps1" "%DEVBOX_PROJECTS%" "%CURRENT_DIR%"') do (
  set "PROJECT_STATUS=%%a"
  set "PHP_VERSION=%%b"
  set "NODE_VERSION=%%c"
  if not "%%d"=="" set "MYSQL_TYPE=%%d"
  if not "%%e"=="" set "MYSQL_VERSION=%%e"
  if not "%%f"=="" set "PYTHON_VERSION=%%f"
)

if "%PROJECT_STATUS%"=="NOTFOUND" (
  echo Error: Not in a DevBox Pro project directory.
  echo.
  echo Current directory: %CURRENT_DIR%
  echo.
  echo To use this command, navigate to a folder registered in DevBox Pro,
  echo or register this folder as a project in DevBox Pro.
  exit /b 1
)

REM Set up paths based on detected versions
set "PHP_PATH=%DEVBOX_RESOURCES%\\php\\%PHP_VERSION%\\win"
set "NODE_PATH=%DEVBOX_RESOURCES%\\nodejs\\%NODE_VERSION%\\win"
set "COMPOSER_PATH=%DEVBOX_RESOURCES%\\composer"
set "MYSQL_BIN_PATH=%DEVBOX_RESOURCES%\\%MYSQL_TYPE%\\%MYSQL_VERSION%\\win\\bin"
set "PYTHON_PATH=%DEVBOX_RESOURCES%\\python\\%PYTHON_VERSION%\\win"
set "PYTHON_SCRIPTS_PATH=%PYTHON_PATH%\\Scripts"

REM Prepend to PATH
set "PATH=%PHP_PATH%;%NODE_PATH%;%COMPOSER_PATH%;%MYSQL_BIN_PATH%;%PYTHON_PATH%;%PYTHON_SCRIPTS_PATH%;%PATH%"

REM Handle special commands
set "CMD=%~1"
shift

if /i "%CMD%"=="php" (
  if exist "%PHP_PATH%\\php.exe" (
    "%PHP_PATH%\\php.exe" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo PHP %PHP_VERSION% not found. Install it from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="composer" (
  if exist "%COMPOSER_PATH%\\composer.phar" (
    if exist "%PHP_PATH%\\php.exe" (
      "%PHP_PATH%\\php.exe" "%COMPOSER_PATH%\\composer.phar" %1 %2 %3 %4 %5 %6 %7 %8 %9
    ) else (
      echo PHP %PHP_VERSION% not found for Composer.
      exit /b 1
    )
  ) else (
    echo Composer not found. Install it from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="node" (
  if "%NODE_VERSION%"=="" (
    echo Node.js is not enabled for this project.
    exit /b 1
  )
  if exist "%NODE_PATH%\\node.exe" (
    "%NODE_PATH%\\node.exe" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo Node.js %NODE_VERSION% not found. Install it from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="npm" (
  if "%NODE_VERSION%"=="" (
    echo npm is not enabled for this project. Enable Node.js in project settings.
    exit /b 1
  )
  if exist "%NODE_PATH%\\npm.cmd" (
    call "%NODE_PATH%\\npm.cmd" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo npm not found. Install Node.js from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="npx" (
  if "%NODE_VERSION%"=="" (
    echo npx is not enabled for this project. Enable Node.js in project settings.
    exit /b 1
  )
  if exist "%NODE_PATH%\\npx.cmd" (
    call "%NODE_PATH%\\npx.cmd" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo npx not found. Install Node.js from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="mysql" (
  if exist "%MYSQL_BIN_PATH%\\mysql.exe" (
    "%MYSQL_BIN_PATH%\\mysql.exe" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo MySQL client not found for %MYSQL_TYPE% %MYSQL_VERSION%. Install it from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="mysqldump" (
  if exist "%MYSQL_BIN_PATH%\\mysqldump.exe" (
    "%MYSQL_BIN_PATH%\\mysqldump.exe" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo mysqldump not found for %MYSQL_TYPE% %MYSQL_VERSION%. Install it from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="python" (
  if "%PYTHON_VERSION%"=="" (
    echo Python is not enabled for this project. Enable Python in project settings.
    exit /b 1
  )
  if exist "%PYTHON_PATH%\\python.exe" (
    "%PYTHON_PATH%\\python.exe" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo Python %PYTHON_VERSION% not found. Install it from DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="pip" (
  if "%PYTHON_VERSION%"=="" (
    echo pip is not available. Enable Python in project settings.
    exit /b 1
  )
  if exist "%PYTHON_SCRIPTS_PATH%\\pip.exe" (
    "%PYTHON_SCRIPTS_PATH%\\pip.exe" %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else if exist "%PYTHON_PATH%\\python.exe" (
    "%PYTHON_PATH%\\python.exe" -m pip %1 %2 %3 %4 %5 %6 %7 %8 %9
  ) else (
    echo pip not found for Python %PYTHON_VERSION%. Install Python from the DevBox Pro Binaries page.
    exit /b 1
  )
  exit /b %ERRORLEVEL%
)

REM Unknown command - try to run it directly
%CMD% %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
`;

    const batchPath = path.join(cliPath, `${alias}.cmd`);
    await fs.writeFile(batchPath, batchContent, 'utf8');

    return batchPath;
  },

  async installUnixCli(alias, cliPath) {
    const resourcesPath = this.resourcesPath;
    const projectsFilePath = this.getProjectsFilePath();
    const platform = process.platform === 'darwin' ? 'mac' : 'linux';

    const shellContent = `#!/bin/bash

# DevBox Pro CLI Wrapper
# This script routes commands through DevBox Pro to use project-specific versions

DEVBOX_RESOURCES="${resourcesPath}"
DEVBOX_PROJECTS="${projectsFilePath}"
CURRENT_DIR="$(pwd)"

# Show help if no arguments
if [ $# -eq 0 ]; then
    echo "DevBox Pro CLI Wrapper"
    echo ""
    echo "Usage: ${alias} <command> [arguments]"
    echo ""
    echo "Commands:"
    echo "  php         - Run PHP with project-specific version"
    echo "  composer    - Run Composer with project's PHP version"
    echo "  node        - Run Node.js with project-specific version"
    echo "  npm         - Run npm with project's Node.js version"
    echo "  npx         - Run npx with project's Node.js version"
    echo "  mysql       - Run MySQL client with active database version"
    echo "  mysqldump   - Run mysqldump with active database version"
    echo "  python      - Run Python with project-specific version"
    echo ""
    echo "Example:"
    echo "  ${alias} php artisan migrate"
    echo "  ${alias} npm install"
    echo "  ${alias} composer install"
    echo "  ${alias} mysql -u root"
    echo "  ${alias} python script.py"
    exit 0
fi

# Check if projects.json exists
if [ ! -f "$DEVBOX_PROJECTS" ]; then
    echo "Warning: DevBox Pro projects file not found."
    echo "Please open DevBox Pro and ensure CLI is installed."
    echo "Running command with system defaults..."
    exec "$@"
fi

# Find matching project by checking if current path starts with any project path
CURRENT_DIR_LOWER=$(echo "$CURRENT_DIR" | tr '[:upper:]' '[:lower:]')

# Use python/node/jq to parse JSON and find matching project
if command -v python3 &> /dev/null; then
    read PHP_VERSION NODE_VERSION MYSQL_TYPE MYSQL_VERSION PYTHON_VERSION < <(python3 -c "
import json
import os
current_dir = '$CURRENT_DIR_LOWER'
with open('$DEVBOX_PROJECTS', 'r') as f:
    projects = json.load(f)
for proj_path, config in projects.items():
    proj_path_lower = proj_path.lower()
    if current_dir.startswith(proj_path_lower) or current_dir == proj_path_lower:
        php = config.get('phpVersion', '8.3')
        node = config.get('nodejsVersion') or ''
        mt = config.get('mysqlType') or 'mysql'
        mv = config.get('mysqlVersion') or '8.4'
        py = (config.get('services') or {}).get('pythonVersion') or ''
        print(f'{php} {node} {mt} {mv} {py}')
        break
else:
    print('8.3  mysql 8.4 ')
" 2>/dev/null)
elif command -v jq &> /dev/null; then
    PHP_VERSION=$(jq -r 'to_entries[] | select(.key | ascii_downcase | startswith("'"$CURRENT_DIR_LOWER"'")) | .value.phpVersion // "8.3"' "$DEVBOX_PROJECTS" 2>/dev/null | head -1)
    NODE_VERSION=$(jq -r 'to_entries[] | select(.key | ascii_downcase | startswith("'"$CURRENT_DIR_LOWER"'")) | .value.nodejsVersion // ""' "$DEVBOX_PROJECTS" 2>/dev/null | head -1)
    MYSQL_TYPE=$(jq -r 'to_entries[] | select(.key | ascii_downcase | startswith("'"$CURRENT_DIR_LOWER"'")) | .value.mysqlType // "mysql"' "$DEVBOX_PROJECTS" 2>/dev/null | head -1)
    MYSQL_VERSION=$(jq -r 'to_entries[] | select(.key | ascii_downcase | startswith("'"$CURRENT_DIR_LOWER"'")) | .value.mysqlVersion // "8.4"' "$DEVBOX_PROJECTS" 2>/dev/null | head -1)
else
    echo "Warning: python3 or jq required to parse project config."
    echo "Running command with system defaults..."
    exec "$@"
fi

PHP_VERSION=\${PHP_VERSION:-8.3}
MYSQL_TYPE=\${MYSQL_TYPE:-mysql}
MYSQL_VERSION=\${MYSQL_VERSION:-8.4}

# Set up paths
PHP_PATH="$DEVBOX_RESOURCES/php/$PHP_VERSION/${platform}"
NODE_PATH="$DEVBOX_RESOURCES/nodejs/$NODE_VERSION/${platform}"
COMPOSER_PATH="$DEVBOX_RESOURCES/composer"
MYSQL_BIN_PATH="$DEVBOX_RESOURCES/$MYSQL_TYPE/$MYSQL_VERSION/${platform}/bin"
PYTHON_PATH="$DEVBOX_RESOURCES/python/$PYTHON_VERSION/${platform}"

# Get the command
CMD="$1"
shift

case "$CMD" in
    php)
        if [ -x "$PHP_PATH/php" ]; then
            exec "$PHP_PATH/php" "$@"
        else
            echo "PHP $PHP_VERSION not found. Install it from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    composer)
        if [ -f "$COMPOSER_PATH/composer.phar" ] && [ -x "$PHP_PATH/php" ]; then
            exec "$PHP_PATH/php" "$COMPOSER_PATH/composer.phar" "$@"
        else
            echo "Composer or PHP not found. Install from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    node)
        if [ -z "$NODE_VERSION" ]; then
            echo "Node.js is not enabled for this project."
            exit 1
        fi
        if [ -x "$NODE_PATH/node" ]; then
            exec "$NODE_PATH/node" "$@"
        else
            echo "Node.js $NODE_VERSION not found. Install it from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    npm)
        if [ -z "$NODE_VERSION" ]; then
            echo "npm is not enabled for this project. Enable Node.js in project settings."
            exit 1
        fi
        if [ -x "$NODE_PATH/npm" ]; then
            export PATH="$NODE_PATH:$PATH"
            exec "$NODE_PATH/npm" "$@"
        else
            echo "npm not found. Install Node.js from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    npx)
        if [ -z "$NODE_VERSION" ]; then
            echo "npx is not enabled for this project. Enable Node.js in project settings."
            exit 1
        fi
        if [ -x "$NODE_PATH/npx" ]; then
            export PATH="$NODE_PATH:$PATH"
            exec "$NODE_PATH/npx" "$@"
        else
            echo "npx not found. Install Node.js from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    mysql)
        if [ -x "$MYSQL_BIN_PATH/mysql" ]; then
            exec "$MYSQL_BIN_PATH/mysql" "$@"
        else
            echo "MySQL client not found for $MYSQL_TYPE $MYSQL_VERSION. Install from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    mysqldump)
        if [ -x "$MYSQL_BIN_PATH/mysqldump" ]; then
            exec "$MYSQL_BIN_PATH/mysqldump" "$@"
        else
            echo "mysqldump not found for $MYSQL_TYPE $MYSQL_VERSION. Install from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    python|python3)
        if [ -z "$PYTHON_VERSION" ]; then
            echo "Python is not enabled for this project. Enable Python in project settings."
            exit 1
        fi
        if [ -x "$PYTHON_PATH/bin/python3" ]; then
            exec "$PYTHON_PATH/bin/python3" "$@"
        elif [ -x "$PYTHON_PATH/python.exe" ]; then
            exec "$PYTHON_PATH/python.exe" "$@"
        else
            echo "Python $PYTHON_VERSION not found. Install it from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    *)
        export PATH="$PHP_PATH:$NODE_PATH:$MYSQL_BIN_PATH:$PYTHON_PATH:$PATH"
        exec "$CMD" "$@"
        ;;
esac
`;

    const scriptPath = path.join(cliPath, alias);
    await fs.writeFile(scriptPath, shellContent, 'utf8');
    await fs.chmod(scriptPath, '755');

    return scriptPath;
  },
};