const path = require('path');
const fs = require('fs-extra');

module.exports = {
  getDirectShimsEnabled() {
    return this.configStore.get('settings.directShimsEnabled', true);
  },

  async setDirectShimsEnabled(enabled) {
    this.configStore.set('settings.directShimsEnabled', enabled);

    if (enabled) {
      await this.installDirectShims();
    } else {
      await this.removeDirectShims();
    }

    return enabled;
  },

  async installDirectShims() {
    const cliPath = this.getCliPath();
    await fs.ensureDir(cliPath);
    await this.syncProjectsFile();

    if (process.platform === 'win32') {
      await this.installWindowsDirectShims(cliPath);
    } else {
      await this.installUnixDirectShims(cliPath);
    }

    return { success: true, path: cliPath };
  },

  async removeDirectShims() {
    const cliPath = this.getCliPath();
    const commands = ['php', 'node', 'npm', 'npx', 'composer', 'mysql', 'mysqldump', 'python', 'python3', 'pip', 'pip3'];
    const ext = process.platform === 'win32' ? '.cmd' : '';

    for (const cmd of commands) {
      const shimPath = path.join(cliPath, `${cmd}${ext}`);
      try {
        if (await fs.pathExists(shimPath)) {
          await fs.remove(shimPath);
        }
      } catch (e) {
        // Ignore removal errors.
      }
    }

    return { success: true };
  },

  async installWindowsDirectShims(cliPath) {
    const resourcesPath = this.resourcesPath;
    const projectsFilePath = this.getProjectsFilePath();
    const defaultPhpVersion = this.getDefaultPhpVersion() || this.getFirstInstalledPhpVersion();
    const defaultNodeVersion = this.getDefaultNodeVersion() || this.getFirstInstalledNodeVersion();
    const defaultPythonVersion = this.getDefaultPythonVersion() || this.getFirstInstalledPythonVersion();
    const defaultMysqlInfo = this.getActiveMysqlInfo();
    const defaultMysqlType = defaultMysqlInfo.dbType;
    const defaultMysqlVersion = defaultMysqlInfo.version;

    const phpShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro PHP Shim - Auto-detects project PHP version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_PHP=${defaultPhpVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project PHP version
set "TEMP_PS=%TEMP%\\devbox_php_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best -and $best.phpVersion){ $best.phpVersion } >> "%TEMP_PS%"

set "PHP_VERSION="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "PHP_VERSION=%%a"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%PHP_VERSION%"=="" set "PHP_VERSION=%DEFAULT_PHP%"

set "PHP_PATH=%DEVBOX_RESOURCES%\\php\\%PHP_VERSION%\\win"

if exist "%PHP_PATH%\\php.exe" (
    "%PHP_PATH%\\php.exe" %*
    exit /b %ERRORLEVEL%
) else (
    echo [DevBox Pro] PHP %PHP_VERSION% not found.
    exit /b 1
)
`;

    const nodeShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro Node Shim - Auto-detects project Node version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_NODE=${defaultNodeVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project Node version
set "TEMP_PS=%TEMP%\\devbox_node_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best -and $best.nodejsVersion){ $best.nodejsVersion } >> "%TEMP_PS%"

set "NODE_VERSION="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "NODE_VERSION=%%a"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%NODE_VERSION%"=="" set "NODE_VERSION=%DEFAULT_NODE%"

set "NODE_PATH=%DEVBOX_RESOURCES%\\nodejs\\%NODE_VERSION%\\win"

if exist "%NODE_PATH%\\node.exe" (
    "%NODE_PATH%\\node.exe" %*
    exit /b %ERRORLEVEL%
) else (
    REM DevBox Pro Node.js not installed - fall back to system node
    set "SHIM_DIR=%~dp0"
    for /f "tokens=*" %%i in ('where node 2^>nul') do (
        if /i not "%%~dpi"=="%SHIM_DIR%" (
            "%%i" %*
            exit /b %ERRORLEVEL%
        )
    )
    echo [DevBox Pro] Node.js %NODE_VERSION% not found. Install it from the DevBox Pro Binaries page.
    exit /b 1
)
`;

    const npmShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro npm Shim - Auto-detects project Node version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_NODE=${defaultNodeVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project Node version
set "TEMP_PS=%TEMP%\\devbox_npm_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best -and $best.nodejsVersion){ $best.nodejsVersion } >> "%TEMP_PS%"

set "NODE_VERSION="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "NODE_VERSION=%%a"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%NODE_VERSION%"=="" set "NODE_VERSION=%DEFAULT_NODE%"

set "NODE_PATH=%DEVBOX_RESOURCES%\\nodejs\\%NODE_VERSION%\\win"

if exist "%NODE_PATH%\\npm.cmd" (
    call "%NODE_PATH%\\npm.cmd" %*
    exit /b %ERRORLEVEL%
) else (
    REM DevBox Pro Node.js not installed - fall back to system npm
    set "SHIM_DIR=%~dp0"
    for /f "tokens=*" %%i in ('where npm 2^>nul') do (
        if /i not "%%~dpi"=="%SHIM_DIR%" (
            call "%%i" %*
            exit /b %ERRORLEVEL%
        )
    )
    echo [DevBox Pro] npm not found. Install Node.js from the DevBox Pro Binaries page.
    exit /b 1
)
`;

    const npxShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro npx Shim - Auto-detects project Node version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_NODE=${defaultNodeVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project Node version
set "TEMP_PS=%TEMP%\\devbox_npx_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best -and $best.nodejsVersion){ $best.nodejsVersion } >> "%TEMP_PS%"

set "NODE_VERSION="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "NODE_VERSION=%%a"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%NODE_VERSION%"=="" set "NODE_VERSION=%DEFAULT_NODE%"

set "NODE_PATH=%DEVBOX_RESOURCES%\\nodejs\\%NODE_VERSION%\\win"

if exist "%NODE_PATH%\\npx.cmd" (
    call "%NODE_PATH%\\npx.cmd" %*
    exit /b %ERRORLEVEL%
) else (
    REM DevBox Pro Node.js not installed - fall back to system npx
    set "SHIM_DIR=%~dp0"
    for /f "tokens=*" %%i in ('where npx 2^>nul') do (
        if /i not "%%~dpi"=="%SHIM_DIR%" (
            call "%%i" %*
            exit /b %ERRORLEVEL%
        )
    )
    echo [DevBox Pro] npx not found. Install Node.js from the DevBox Pro Binaries page.
    exit /b 1
)
`;

    const composerShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro Composer Shim - Uses project PHP version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_PHP=${defaultPhpVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project PHP version
set "TEMP_PS=%TEMP%\\devbox_composer_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best -and $best.phpVersion){ $best.phpVersion } >> "%TEMP_PS%"

set "PHP_VERSION="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "PHP_VERSION=%%a"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%PHP_VERSION%"=="" set "PHP_VERSION=%DEFAULT_PHP%"

set "PHP_PATH=%DEVBOX_RESOURCES%\\php\\%PHP_VERSION%\\win"
set "COMPOSER_PATH=%DEVBOX_RESOURCES%\\composer\\composer.phar"

if exist "%PHP_PATH%\\php.exe" (
    if exist "%COMPOSER_PATH%" (
        "%PHP_PATH%\\php.exe" "%COMPOSER_PATH%" %*
        exit /b %ERRORLEVEL%
    ) else (
        echo [DevBox Pro] Composer not found.
        exit /b 1
    )
) else (
    echo [DevBox Pro] PHP %PHP_VERSION% not found.
    exit /b 1
)
`;

    const mysqlShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro MySQL Client Shim - Uses active database type and version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_MYSQL_TYPE=${defaultMysqlType}"
set "DEFAULT_MYSQL_VERSION=${defaultMysqlVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project MySQL info
set "TEMP_PS=%TEMP%\\devbox_mysql_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best){ >> "%TEMP_PS%"
echo   $t = if($best.mysqlType){ $best.mysqlType } else { '${defaultMysqlType}' } >> "%TEMP_PS%"
echo   $v = if($best.mysqlVersion){ $best.mysqlVersion } else { '${defaultMysqlVersion}' } >> "%TEMP_PS%"
echo   Write-Output "$t|$v" >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"

set "MYSQL_TYPE="
set "MYSQL_VERSION="
for /f "tokens=1,2 delims=|" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "MYSQL_TYPE=%%a"
    if not "%%b"=="" set "MYSQL_VERSION=%%b"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%MYSQL_TYPE%"=="" set "MYSQL_TYPE=%DEFAULT_MYSQL_TYPE%"
if "%MYSQL_VERSION%"=="" set "MYSQL_VERSION=%DEFAULT_MYSQL_VERSION%"

set "MYSQL_BIN_PATH=%DEVBOX_RESOURCES%\\%MYSQL_TYPE%\\%MYSQL_VERSION%\\win\\bin"

if exist "%MYSQL_BIN_PATH%\\mysql.exe" (
    "%MYSQL_BIN_PATH%\\mysql.exe" %*
    exit /b %ERRORLEVEL%
) else (
    echo [DevBox Pro] MySQL client not found for %MYSQL_TYPE% %MYSQL_VERSION%.
    exit /b 1
)
`;

    const mysqldumpShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro mysqldump Shim - Uses active database type and version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_MYSQL_TYPE=${defaultMysqlType}"
set "DEFAULT_MYSQL_VERSION=${defaultMysqlVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project MySQL info
set "TEMP_PS=%TEMP%\\devbox_mysqldump_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best){ >> "%TEMP_PS%"
echo   $t = if($best.mysqlType){ $best.mysqlType } else { '${defaultMysqlType}' } >> "%TEMP_PS%"
echo   $v = if($best.mysqlVersion){ $best.mysqlVersion } else { '${defaultMysqlVersion}' } >> "%TEMP_PS%"
echo   Write-Output "$t|$v" >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"

set "MYSQL_TYPE="
set "MYSQL_VERSION="
for /f "tokens=1,2 delims=|" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "MYSQL_TYPE=%%a"
    if not "%%b"=="" set "MYSQL_VERSION=%%b"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%MYSQL_TYPE%"=="" set "MYSQL_TYPE=%DEFAULT_MYSQL_TYPE%"
if "%MYSQL_VERSION%"=="" set "MYSQL_VERSION=%DEFAULT_MYSQL_VERSION%"

set "MYSQL_BIN_PATH=%DEVBOX_RESOURCES%\\%MYSQL_TYPE%\\%MYSQL_VERSION%\\win\\bin"

if exist "%MYSQL_BIN_PATH%\\mysqldump.exe" (
    "%MYSQL_BIN_PATH%\\mysqldump.exe" %*
    exit /b %ERRORLEVEL%
) else (
    echo [DevBox Pro] mysqldump not found for %MYSQL_TYPE% %MYSQL_VERSION%.
    exit /b 1
)
`;

    const pythonShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro Python Shim - Auto-detects project Python version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_PYTHON=${defaultPythonVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project Python version
set "TEMP_PS=%TEMP%\\devbox_python_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best -and $best.services -and $best.services.pythonVersion){ $best.services.pythonVersion } >> "%TEMP_PS%"

set "PYTHON_VERSION="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "PYTHON_VERSION=%%a"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%PYTHON_VERSION%"=="" set "PYTHON_VERSION=%DEFAULT_PYTHON%"

set "PYTHON_PATH=%DEVBOX_RESOURCES%\\python\\%PYTHON_VERSION%\\win"

if exist "%PYTHON_PATH%\\python.exe" (
    "%PYTHON_PATH%\\python.exe" %*
    exit /b %ERRORLEVEL%
) else (
    REM DevBox Pro Python not installed - fall back to system python
    set "SHIM_DIR=%~dp0"
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if /i not "%%~dpi"=="%SHIM_DIR%" (
            "%%i" %*
            exit /b %ERRORLEVEL%
        )
    )
    echo [DevBox Pro] Python %PYTHON_VERSION% not found. Install it from the DevBox Pro Binaries page.
    exit /b 1
)
`;

    const pipShim = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro pip Shim - Auto-detects project Python version
set "DEVBOX_RESOURCES=${resourcesPath}"
set "DEVBOX_PROJECTS=${projectsFilePath}"
set "DEFAULT_PYTHON=${defaultPythonVersion}"
set "CURRENT_DIR=%CD%"

REM Create temp PowerShell script to find project Python version
set "TEMP_PS=%TEMP%\\devbox_pip_lookup.ps1"
echo $p = Get-Content '%DEVBOX_PROJECTS%' -Raw ^| ConvertFrom-Json > "%TEMP_PS%"
echo $d = '%CURRENT_DIR%'.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo $best = $null >> "%TEMP_PS%"
echo $bestLen = 0 >> "%TEMP_PS%"
echo foreach($prop in $p.PSObject.Properties){ >> "%TEMP_PS%"
echo   $pp = $prop.Name.ToLower().Replace('/', '\\') >> "%TEMP_PS%"
echo   if($d -eq $pp -or $d.StartsWith($pp + '\\')){ >> "%TEMP_PS%"
echo     if($pp.Length -gt $bestLen){ $best = $prop.Value; $bestLen = $pp.Length } >> "%TEMP_PS%"
echo   } >> "%TEMP_PS%"
echo } >> "%TEMP_PS%"
echo if($best -and $best.services -and $best.services.pythonVersion){ $best.services.pythonVersion } >> "%TEMP_PS%"

set "PYTHON_VERSION="
for /f "tokens=*" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%TEMP_PS%" 2^>nul') do (
    if not "%%a"=="" set "PYTHON_VERSION=%%a"
)
del "%TEMP_PS%" 2>nul

REM Use project version or default
if "%PYTHON_VERSION%"=="" set "PYTHON_VERSION=%DEFAULT_PYTHON%"

set "PYTHON_PATH=%DEVBOX_RESOURCES%\\python\\%PYTHON_VERSION%\\win"
set "PYTHON_SCRIPTS=%PYTHON_PATH%\\Scripts"

if exist "%PYTHON_SCRIPTS%\\pip.exe" (
    "%PYTHON_SCRIPTS%\\pip.exe" %*
    exit /b %ERRORLEVEL%
) else if exist "%PYTHON_PATH%\\python.exe" (
    "%PYTHON_PATH%\\python.exe" -m pip %*
    exit /b %ERRORLEVEL%
) else (
    REM DevBox Pro Python not installed - fall back to system pip
    set "SHIM_DIR=%~dp0"
    for /f "tokens=*" %%i in ('where pip 2^>nul') do (
        if /i not "%%~dpi"=="%SHIM_DIR%" (
            "%%i" %*
            exit /b %ERRORLEVEL%
        )
    )
    echo [DevBox Pro] pip not found for Python %PYTHON_VERSION%. Install Python from the DevBox Pro Binaries page.
    exit /b 1
)
`;

    await fs.writeFile(path.join(cliPath, 'php.cmd'), phpShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'node.cmd'), nodeShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'npm.cmd'), npmShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'npx.cmd'), npxShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'composer.cmd'), composerShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'mysql.cmd'), mysqlShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'mysqldump.cmd'), mysqldumpShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'python.cmd'), pythonShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'pip.cmd'), pipShim, 'utf8');

    return true;
  },

  async installUnixDirectShims(cliPath) {
    const resourcesPath = this.resourcesPath;
    const projectsFilePath = this.getProjectsFilePath();
    const platform = process.platform === 'darwin' ? 'mac' : 'linux';
    const defaultPhpVersion = this.getDefaultPhpVersion() || this.getFirstInstalledPhpVersion();
    const defaultNodeVersion = this.getDefaultNodeVersion() || this.getFirstInstalledNodeVersion();
    const defaultPythonVersion = this.getDefaultPythonVersion() || this.getFirstInstalledPythonVersion();
    const defaultMysqlInfo = this.getActiveMysqlInfo();
    const defaultMysqlType = defaultMysqlInfo.dbType;
    const defaultMysqlVersion = defaultMysqlInfo.version;

    const phpShim = `#!/bin/bash
# DevBox Pro PHP Shim - Auto-detects project PHP version

DEVBOX_RESOURCES="${resourcesPath}"
DEVBOX_PROJECTS="${projectsFilePath}"
DEFAULT_PHP="${defaultPhpVersion}"
CURRENT_DIR="$(pwd)"

# Find project for current directory
PHP_VERSION=""
if [ -f "$DEVBOX_PROJECTS" ]; then
    RESULT=$(python3 -c "
import json, sys
try:
    with open('$DEVBOX_PROJECTS') as f:
        projects = json.load(f)
    current = '$CURRENT_DIR'.lower()
    for path, config in projects.items():
        if current.startswith(path.lower()) or current == path.lower():
            print('FOUND|' + (config.get('phpVersion') or '8.3'))
            sys.exit(0)
except:
    pass
print('NOTFOUND|')
" 2>/dev/null)
    
    if [[ "$RESULT" == FOUND* ]]; then
        PHP_VERSION="\${RESULT#FOUND|}"
    fi
fi

[ -z "$PHP_VERSION" ] && PHP_VERSION="$DEFAULT_PHP"

PHP_PATH="$DEVBOX_RESOURCES/php/$PHP_VERSION/${platform}"

if [ -x "$PHP_PATH/php" ]; then
    exec "$PHP_PATH/php" "$@"
elif command -v php &> /dev/null; then
    exec php "$@"
else
    echo "[DevBox Pro] PHP $PHP_VERSION not found. Install from Binaries page or set a default version."
    exit 1
fi
`;

    const nodeShim = `#!/bin/bash
# DevBox Pro Node Shim - Auto-detects project Node version

DEVBOX_RESOURCES="${resourcesPath}"
DEVBOX_PROJECTS="${projectsFilePath}"
DEFAULT_NODE="${defaultNodeVersion}"
CURRENT_DIR="$(pwd)"

# Find project for current directory
NODE_VERSION=""
if [ -f "$DEVBOX_PROJECTS" ]; then
    RESULT=$(python3 -c "
import json, sys
try:
    with open('$DEVBOX_PROJECTS') as f:
        projects = json.load(f)
    current = '$CURRENT_DIR'.lower()
    for path, config in projects.items():
        if current.startswith(path.lower()) or current == path.lower():
            nv = config.get('nodejsVersion')
            if nv:
                print('FOUND|' + nv)
            sys.exit(0)
except:
    pass
print('NOTFOUND|')
" 2>/dev/null)
    
    if [[ "$RESULT" == FOUND* ]]; then
        NODE_VERSION="\${RESULT#FOUND|}"
    fi
fi

[ -z "$NODE_VERSION" ] && NODE_VERSION="$DEFAULT_NODE"

NODE_PATH="$DEVBOX_RESOURCES/nodejs/$NODE_VERSION/${platform}"

if [ -x "$NODE_PATH/bin/node" ]; then
    exec "$NODE_PATH/bin/node" "$@"
elif [ -x "$NODE_PATH/node" ]; then
    exec "$NODE_PATH/node" "$@"
elif command -v node &> /dev/null; then
    exec node "$@"
else
    echo "[DevBox Pro] Node.js $NODE_VERSION not found. Install from Binaries page or set a default version."
    exit 1
fi
`;

    const shims = [
      { name: 'php', content: phpShim },
      { name: 'node', content: nodeShim },
    ];

    for (const shim of shims) {
      const shimPath = path.join(cliPath, shim.name);
      await fs.writeFile(shimPath, shim.content, 'utf8');
      await fs.chmod(shimPath, 0o755);
    }

    const npmShim = `#!/bin/bash
# DevBox Pro npm Shim
SCRIPT_DIR="$(dirname "$0")"
NODE_CMD="$SCRIPT_DIR/node"
DEVBOX_RESOURCES="${resourcesPath}"

# Get node version from the node shim logic, then find npm
NODE_VERSION=$($NODE_CMD -e "console.log(process.version)" 2>/dev/null | sed 's/v//')
if [ -n "$NODE_VERSION" ]; then
    MAJOR_VERSION=\${NODE_VERSION%%.*}
    NPM_PATH="$DEVBOX_RESOURCES/nodejs/$MAJOR_VERSION/${platform}/bin/npm"
    [ -x "$NPM_PATH" ] && exec "$NODE_CMD" "$NPM_PATH" "$@"
    NPM_PATH="$DEVBOX_RESOURCES/nodejs/$MAJOR_VERSION/${platform}/npm"
    [ -x "$NPM_PATH" ] && exec "$NODE_CMD" "$NPM_PATH" "$@"
fi

command -v npm &> /dev/null && exec npm "$@"
echo "[DevBox Pro] npm not found."
exit 1
`;

    await fs.writeFile(path.join(cliPath, 'npm'), npmShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'npm'), 0o755);
    await fs.writeFile(path.join(cliPath, 'npx'), npmShim.replace(/npm/g, 'npx'), 'utf8');
    await fs.chmod(path.join(cliPath, 'npx'), 0o755);

    const composerShim = `#!/bin/bash
# DevBox Pro Composer Shim
SCRIPT_DIR="$(dirname "$0")"
PHP_CMD="$SCRIPT_DIR/php"
DEVBOX_RESOURCES="${resourcesPath}"
COMPOSER_PATH="$DEVBOX_RESOURCES/composer/composer.phar"

if [ -f "$COMPOSER_PATH" ]; then
    exec "$PHP_CMD" "$COMPOSER_PATH" "$@"
elif command -v composer &> /dev/null; then
    exec composer "$@"
else
    echo "[DevBox Pro] Composer not found. Install from Binaries page."
    exit 1
fi
`;

    await fs.writeFile(path.join(cliPath, 'composer'), composerShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'composer'), 0o755);

    const mysqlShim = `#!/bin/bash
# DevBox Pro MySQL Client Shim - Uses active database type and version

DEVBOX_RESOURCES="${resourcesPath}"
DEVBOX_PROJECTS="${projectsFilePath}"
DEFAULT_MYSQL_TYPE="${defaultMysqlType}"
DEFAULT_MYSQL_VERSION="${defaultMysqlVersion}"
CURRENT_DIR="$(pwd)"

MYSQL_TYPE=""
MYSQL_VERSION=""
if [ -f "$DEVBOX_PROJECTS" ]; then
    RESULT=$(python3 -c "
import json, sys
try:
    with open('$DEVBOX_PROJECTS') as f:
        projects = json.load(f)
    current = '$CURRENT_DIR'.lower()
    for path, config in projects.items():
        if current.startswith(path.lower()) or current == path.lower():
            mt = config.get('mysqlType') or '$DEFAULT_MYSQL_TYPE'
            mv = config.get('mysqlVersion') or '$DEFAULT_MYSQL_VERSION'
            print(f'FOUND|{mt}|{mv}')
            sys.exit(0)
except:
    pass
print('NOTFOUND||')
" 2>/dev/null)

    if [[ "$RESULT" == FOUND* ]]; then
        MYSQL_TYPE=$(echo "$RESULT" | cut -d'|' -f2)
        MYSQL_VERSION=$(echo "$RESULT" | cut -d'|' -f3)
    fi
fi

[ -z "$MYSQL_TYPE" ] && MYSQL_TYPE="$DEFAULT_MYSQL_TYPE"
[ -z "$MYSQL_VERSION" ] && MYSQL_VERSION="$DEFAULT_MYSQL_VERSION"

MYSQL_BIN="$DEVBOX_RESOURCES/$MYSQL_TYPE/$MYSQL_VERSION/${platform}/bin/mysql"

if [ -x "$MYSQL_BIN" ]; then
    exec "$MYSQL_BIN" "$@"
elif command -v mysql &> /dev/null; then
    exec mysql "$@"
else
    echo "[DevBox Pro] MySQL client not found for $MYSQL_TYPE $MYSQL_VERSION."
    exit 1
fi
`;

    await fs.writeFile(path.join(cliPath, 'mysql'), mysqlShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'mysql'), 0o755);

    const mysqldumpShim = `#!/bin/bash
# DevBox Pro mysqldump Shim - Uses active database type and version

DEVBOX_RESOURCES="${resourcesPath}"
DEVBOX_PROJECTS="${projectsFilePath}"
DEFAULT_MYSQL_TYPE="${defaultMysqlType}"
DEFAULT_MYSQL_VERSION="${defaultMysqlVersion}"
CURRENT_DIR="$(pwd)"

MYSQL_TYPE=""
MYSQL_VERSION=""
if [ -f "$DEVBOX_PROJECTS" ]; then
    RESULT=$(python3 -c "
import json, sys
try:
    with open('$DEVBOX_PROJECTS') as f:
        projects = json.load(f)
    current = '$CURRENT_DIR'.lower()
    for path, config in projects.items():
        if current.startswith(path.lower()) or current == path.lower():
            mt = config.get('mysqlType') or '$DEFAULT_MYSQL_TYPE'
            mv = config.get('mysqlVersion') or '$DEFAULT_MYSQL_VERSION'
            print(f'FOUND|{mt}|{mv}')
            sys.exit(0)
except:
    pass
print('NOTFOUND||')
" 2>/dev/null)

    if [[ "$RESULT" == FOUND* ]]; then
        MYSQL_TYPE=$(echo "$RESULT" | cut -d'|' -f2)
        MYSQL_VERSION=$(echo "$RESULT" | cut -d'|' -f3)
    fi
fi

[ -z "$MYSQL_TYPE" ] && MYSQL_TYPE="$DEFAULT_MYSQL_TYPE"
[ -z "$MYSQL_VERSION" ] && MYSQL_VERSION="$DEFAULT_MYSQL_VERSION"

MYSQLDUMP_BIN="$DEVBOX_RESOURCES/$MYSQL_TYPE/$MYSQL_VERSION/${platform}/bin/mysqldump"

if [ -x "$MYSQLDUMP_BIN" ]; then
    exec "$MYSQLDUMP_BIN" "$@"
elif command -v mysqldump &> /dev/null; then
    exec mysqldump "$@"
else
    echo "[DevBox Pro] mysqldump not found for $MYSQL_TYPE $MYSQL_VERSION."
    exit 1
fi
`;

    await fs.writeFile(path.join(cliPath, 'mysqldump'), mysqldumpShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'mysqldump'), 0o755);

    const pythonShim = `#!/bin/bash
# DevBox Pro Python Shim - Auto-detects project Python version

DEVBOX_RESOURCES="${resourcesPath}"
DEVBOX_PROJECTS="${projectsFilePath}"
DEFAULT_PYTHON="${defaultPythonVersion}"
CURRENT_DIR="$(pwd)"

# Find project for current directory
PYTHON_VERSION=""
if [ -f "$DEVBOX_PROJECTS" ]; then
    RESULT=$(python3 -c "
import json, sys
try:
    with open('$DEVBOX_PROJECTS') as f:
        projects = json.load(f)
    current = '$CURRENT_DIR'.lower()
    for path, config in projects.items():
        if current.startswith(path.lower()) or current == path.lower():
            pv = (config.get('services') or {}).get('pythonVersion')
            if pv:
                print('FOUND|' + pv)
            sys.exit(0)
except:
    pass
print('NOTFOUND|')
" 2>/dev/null)
    
    if [[ "$RESULT" == FOUND* ]]; then
        PYTHON_VERSION="\${RESULT#FOUND|}"
    fi
fi

[ -z "$PYTHON_VERSION" ] && PYTHON_VERSION="$DEFAULT_PYTHON"

PYTHON_PATH="$DEVBOX_RESOURCES/python/$PYTHON_VERSION/${platform}"

if [ -x "$PYTHON_PATH/bin/python3" ]; then
    exec "$PYTHON_PATH/bin/python3" "$@"
elif command -v python3 &> /dev/null; then
    exec python3 "$@"
else
    echo "[DevBox Pro] Python $PYTHON_VERSION not found. Install from Binaries page or set a default version."
    exit 1
fi
`;

    await fs.writeFile(path.join(cliPath, 'python'), pythonShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'python'), 0o755);
    await fs.writeFile(path.join(cliPath, 'python3'), pythonShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'python3'), 0o755);

    const pipShim = `#!/bin/bash
# DevBox Pro pip Shim - Auto-detects project Python version

DEVBOX_RESOURCES="${resourcesPath}"
DEVBOX_PROJECTS="${projectsFilePath}"
DEFAULT_PYTHON="${defaultPythonVersion}"
CURRENT_DIR="$(pwd)"

# Find project for current directory
PYTHON_VERSION=""
if [ -f "$DEVBOX_PROJECTS" ]; then
    RESULT=$(python3 -c "
import json, sys
try:
    with open('$DEVBOX_PROJECTS') as f:
        projects = json.load(f)
    current = '$CURRENT_DIR'.lower()
    for path, config in projects.items():
        if current.startswith(path.lower()) or current == path.lower():
            pv = (config.get('services') or {}).get('pythonVersion')
            if pv:
                print('FOUND|' + pv)
            sys.exit(0)
except:
    pass
print('NOTFOUND|')
" 2>/dev/null)
    
    if [[ "$RESULT" == FOUND* ]]; then
        PYTHON_VERSION="\${RESULT#FOUND|}"
    fi
fi

[ -z "$PYTHON_VERSION" ] && PYTHON_VERSION="$DEFAULT_PYTHON"

PYTHON_PATH="$DEVBOX_RESOURCES/python/$PYTHON_VERSION/${platform}"

if [ -x "$PYTHON_PATH/bin/pip3" ]; then
    exec "$PYTHON_PATH/bin/pip3" "$@"
elif [ -x "$PYTHON_PATH/bin/python3" ]; then
    exec "$PYTHON_PATH/bin/python3" -m pip "$@"
elif command -v pip3 &> /dev/null; then
    exec pip3 "$@"
else
    echo "[DevBox Pro] pip not found for Python $PYTHON_VERSION. Install from Binaries page or set a default version."
    exit 1
fi
`;

    await fs.writeFile(path.join(cliPath, 'pip'), pipShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'pip'), 0o755);
    await fs.writeFile(path.join(cliPath, 'pip3'), pipShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'pip3'), 0o755);

    return true;
  },
};