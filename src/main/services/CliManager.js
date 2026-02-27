/**
 * CliManager - Manages CLI functionality for terminal commands
 * 
 * Provides a way for users to run PHP/Node/MySQL commands using project-specific versions
 * directly from their external terminal/editor.
 * 
 * Example usage (after enabling in Settings):
 *   php artisan optimize
 *   npm install
 *   composer install
 *   node script.js
 *   mysql -u root
 *   mysqldump -u root mydb > backup.sql
 */

const path = require('path');
const fs = require('fs-extra');
const { exec, spawn } = require('child_process');
const os = require('os');

class CliManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.resourcesPath = null;
  }

  async initialize(resourcesPath) {
    this.resourcesPath = resourcesPath;
    // CliManager initialized
  }

  /**
   * Get the configured CLI alias (default: dvp)
   */
  getAlias() {
    return this.configStore.get('settings.cliAlias', 'dvp');
  }

  /**
   * Set the CLI alias
   */
  setAlias(alias) {
    // Validate alias (alphanumeric, no spaces)
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) {
      throw new Error('Invalid alias. Use only letters, numbers, underscores, and hyphens. Must start with a letter.');
    }
    this.configStore.set('settings.cliAlias', alias);
    return alias;
  }

  /**
   * Get the path where CLI scripts should be installed
   */
  getCliPath() {
    const dataPath = this.configStore.get('dataPath');
    return path.join(dataPath, 'cli');
  }

  /**
   * Get the path to the central projects mapping file
   */
  getProjectsFilePath() {
    return path.join(this.getCliPath(), 'projects.json');
  }

  /**
   * Get the first available installed Node.js version
   * Falls back to '20' if none found (for backwards compatibility)
   */
  getFirstInstalledNodeVersion() {
    if (!this.resourcesPath) return '20';

    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const nodejsDir = path.join(this.resourcesPath, 'nodejs');

    try {
      if (!fs.existsSync(nodejsDir)) return '20';

      const versions = fs.readdirSync(nodejsDir)
        .filter(v => v !== 'downloads' && v !== 'win' && v !== 'mac')
        .filter(v => {
          const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
          return fs.existsSync(path.join(nodejsDir, v, platform, nodeExe));
        })
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true })); // Sort descending

      return versions[0] || '20';
    } catch (e) {
      return '20';
    }
  }

  /**
   * Sync all projects to the central projects.json file
   * This file is used by the CLI scripts to find project configs
   */
  async syncProjectsFile() {
    const cliPath = this.getCliPath();
    await fs.ensureDir(cliPath);

    const projects = this.configStore.get('projects', []);
    const projectMappings = {};

    // Get default Node.js version (first installed, or '20' fallback)
    const defaultNodeVersion = this.getFirstInstalledNodeVersion();

    // Get active database info
    const dbInfo = this.getActiveMysqlInfo();

    for (const project of projects) {
      const normalizedPath = path.normalize(project.path);
      projectMappings[normalizedPath] = {
        id: project.id,
        name: project.name,
        phpVersion: project.phpVersion || '8.3',
        nodejsVersion: project.services?.nodejs ? (project.services.nodejsVersion || defaultNodeVersion) : null,
        mysqlType: dbInfo.dbType,
        mysqlVersion: dbInfo.version,
      };
    }

    const projectsFilePath = this.getProjectsFilePath();
    await fs.writeJson(projectsFilePath, projectMappings, { spaces: 2 });
    
    // Return the path for logging purposes
    return projectsFilePath;
  }

  /**
   * Get project configuration for a given path
   */
  getProjectForPath(projectPath) {
    const projects = this.configStore.get('projects', []);
    const normalizedPath = path.normalize(projectPath).toLowerCase();

    // Find project that contains this path
    for (const project of projects) {
      const projectDir = path.normalize(project.path).toLowerCase();
      if (normalizedPath.startsWith(projectDir)) {
        return project;
      }
    }

    return null;
  }

  /**
   * Build the environment for running commands in a project context
   */
  buildProjectEnv(project) {
    const env = { ...process.env };

    // PHP path
    const phpVersion = project.phpVersion || '8.3';
    const phpPath = this.getPhpPath(phpVersion);
    if (phpPath) {
      env.PATH = `${path.dirname(phpPath)}${path.delimiter}${env.PATH}`;
    }

    // Node.js path
    if (project.services?.nodejs) {
      const nodeVersion = project.services.nodejsVersion || this.getFirstInstalledNodeVersion();
      const nodePath = this.getNodePath(nodeVersion);
      if (nodePath) {
        env.PATH = `${path.dirname(nodePath)}${path.delimiter}${env.PATH}`;
      }
    }

    // Composer path
    const composerPath = this.getComposerPath();
    if (composerPath) {
      env.PATH = `${path.dirname(composerPath)}${path.delimiter}${env.PATH}`;
    }

    // MySQL/MariaDB client path
    const dbInfo = this.getActiveMysqlInfo();
    const mysqlClient = this.getMysqlClientPath(dbInfo.dbType, dbInfo.version);
    if (mysqlClient) {
      env.PATH = `${path.dirname(mysqlClient)}${path.delimiter}${env.PATH}`;
    }

    return env;
  }

  /**
   * Get the active database type and version from settings
   * Uses the global activeDatabaseType/activeDatabaseVersion settings
   * @returns {{ dbType: string, version: string }}
   */
  getActiveMysqlInfo() {
    const dbType = this.configStore.getSetting
      ? this.configStore.getSetting('activeDatabaseType', 'mysql')
      : this.configStore.get('settings.activeDatabaseType', 'mysql');
    const defaultVersion = dbType === 'mariadb' ? '11.4' : '8.4';
    const version = this.configStore.getSetting
      ? this.configStore.getSetting('activeDatabaseVersion', defaultVersion)
      : this.configStore.get('settings.activeDatabaseVersion', defaultVersion);
    return { dbType, version };
  }

  /**
   * Get PHP executable path for version
   */
  getPhpPath(version) {
    if (!this.resourcesPath) return null;
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpDir = path.join(this.resourcesPath, 'php', version, platform);
    const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
    const phpPath = path.join(phpDir, phpExe);
    return fs.existsSync(phpPath) ? phpPath : null;
  }

  /**
   * Get Node.js executable path for version
   */
  getNodePath(version) {
    if (!this.resourcesPath) return null;
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const nodeDir = path.join(this.resourcesPath, 'nodejs', version, platform);
    const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
    const nodePath = path.join(nodeDir, nodeExe);
    return fs.existsSync(nodePath) ? nodePath : null;
  }

  /**
   * Get Composer path
   */
  getComposerPath() {
    if (!this.resourcesPath) return null;
    const composerPath = path.join(this.resourcesPath, 'composer', 'composer.phar');
    return fs.existsSync(composerPath) ? composerPath : null;
  }

  /**
   * Get MySQL/MariaDB client executable path for a given type and version
   * Binary location: resources/<dbType>/<version>/<platform>/bin/mysql[.exe]
   * @param {string} dbType - 'mysql' or 'mariadb'
   * @param {string} version - e.g. '8.4', '11.4'
   */
  getMysqlClientPath(dbType, version) {
    if (!this.resourcesPath) return null;
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';
    const clientPath = path.join(this.resourcesPath, dbType, version, platform, 'bin', binName);
    return fs.existsSync(clientPath) ? clientPath : null;
  }

  /**
   * Get mysqldump executable path for a given type and version
   * @param {string} dbType - 'mysql' or 'mariadb'
   * @param {string} version - e.g. '8.4', '11.4'
   */
  getMysqldumpPath(dbType, version) {
    if (!this.resourcesPath) return null;
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const binName = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump';
    const dumpPath = path.join(this.resourcesPath, dbType, version, platform, 'bin', binName);
    return fs.existsSync(dumpPath) ? dumpPath : null;
  }

  /**
   * Get the first available installed MySQL version
   * Checks mysql first, then mariadb
   * @returns {{ dbType: string, version: string }}
   */
  getFirstInstalledMysqlVersion() {
    if (!this.resourcesPath) return { dbType: 'mysql', version: '8.4' };

    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';

    for (const dbType of ['mysql', 'mariadb']) {
      const dbDir = path.join(this.resourcesPath, dbType);
      try {
        if (!fs.existsSync(dbDir)) continue;
        const versions = fs.readdirSync(dbDir)
          .filter(v => v !== 'downloads' && v !== 'win' && v !== 'mac' && v !== 'backups')
          .filter(v => fs.existsSync(path.join(dbDir, v, platform, 'bin', binName)))
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        if (versions.length > 0) {
          return { dbType, version: versions[0] };
        }
      } catch (e) {
        // continue to next type
      }
    }

    return { dbType: 'mysql', version: '8.4' };
  }

  /**
   * Execute a command in the context of a project
   */
  async executeCommand(workingDir, command, args = []) {
    const project = this.getProjectForPath(workingDir);

    if (!project) {
      throw new Error(`No DevBox Pro project found for path: ${workingDir}`);
    }

    const env = this.buildProjectEnv(project);
    let executable = command;
    let finalArgs = [...args];

    // Handle special commands
    switch (command.toLowerCase()) {
      case 'php':
        const phpPath = this.getPhpPath(project.phpVersion);
        if (phpPath) {
          executable = phpPath;
        }
        break;

      case 'composer':
        const composerPath = this.getComposerPath();
        const phpForComposer = this.getPhpPath(project.phpVersion);
        if (composerPath && phpForComposer) {
          executable = phpForComposer;
          finalArgs = [composerPath, ...args];
        }
        break;

      case 'node':
      case 'npm':
      case 'npx':
        if (project.services?.nodejs) {
          const nodeVersion = project.services.nodejsVersion || this.getFirstInstalledNodeVersion();
          const nodePath = this.getNodePath(nodeVersion);
          if (nodePath) {
            const nodeDir = path.dirname(nodePath);
            if (command.toLowerCase() === 'node') {
              executable = nodePath;
            } else {
              // npm and npx are in the same directory
              const cmdExe = process.platform === 'win32' ? `${command}.cmd` : command;
              executable = path.join(nodeDir, cmdExe);
            }
          }
        }
        break;

      case 'mysql':
      case 'mysqldump': {
        const dbInfo = this.getActiveMysqlInfo();
        const binPath = command.toLowerCase() === 'mysql'
          ? this.getMysqlClientPath(dbInfo.dbType, dbInfo.version)
          : this.getMysqldumpPath(dbInfo.dbType, dbInfo.version);
        if (binPath) {
          executable = binPath;
        }
        break;
      }
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(executable, finalArgs, {
        cwd: workingDir,
        env,
        stdio: 'inherit',
        shell: process.platform === 'win32',
      });

      proc.on('close', (code) => {
        resolve({ exitCode: code });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Install CLI scripts to make the alias available system-wide
   */
  async installCli() {
    const alias = this.getAlias();
    const cliPath = this.getCliPath();

    await fs.ensureDir(cliPath);

    // Sync projects to the central projects.json file
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
  }

  /**
   * Install Windows batch script
   */
  async installWindowsCli(alias, cliPath) {
    const resourcesPath = this.resourcesPath;
    const projectsFilePath = this.getProjectsFilePath();

    // Create a helper PowerShell script for JSON parsing
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
            Write-Output "FOUND|$php|$node|$mt|$mv"
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

    // Create the batch script
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
    echo   node        - Run Node.js with project-specific version
    echo   npm         - Run npm with project's Node.js version
    echo   npx         - Run npx with project's Node.js version
    echo   mysql       - Run MySQL client with active database version
    echo   mysqldump   - Run mysqldump with active database version
    echo.
    echo Example:
    echo   ${alias} php artisan migrate
    echo   ${alias} npm install
    echo   ${alias} composer install
    echo   ${alias} mysql -u root
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

for /f "tokens=1,2,3,4,5 delims=|" %%a in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%DEVBOX_CLI%\\find-project.ps1" "%DEVBOX_PROJECTS%" "%CURRENT_DIR%"') do (
    set "PROJECT_STATUS=%%a"
    set "PHP_VERSION=%%b"
    set "NODE_VERSION=%%c"
    if not "%%d"=="" set "MYSQL_TYPE=%%d"
    if not "%%e"=="" set "MYSQL_VERSION=%%e"
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

REM Prepend to PATH
set "PATH=%PHP_PATH%;%NODE_PATH%;%COMPOSER_PATH%;%MYSQL_BIN_PATH%;%PATH%"

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

REM Unknown command - try to run it directly
%CMD% %1 %2 %3 %4 %5 %6 %7 %8 %9
exit /b %ERRORLEVEL%
`;

    const batchPath = path.join(cliPath, `${alias}.cmd`);
    await fs.writeFile(batchPath, batchContent, 'utf8');

    // CLI script installed (Windows)
    return batchPath;
  }

  /**
   * Install Unix shell script
   */
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
    echo ""
    echo "Example:"
    echo "  ${alias} php artisan migrate"
    echo "  ${alias} npm install"
    echo "  ${alias} composer install"
    echo "  ${alias} mysql -u root"
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
    read PHP_VERSION NODE_VERSION MYSQL_TYPE MYSQL_VERSION < <(python3 -c "
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
        print(f'{php} {node} {mt} {mv}')
        break
else:
    print('8.3  mysql 8.4')
" 2>/dev/null)
elif command -v jq &> /dev/null; then
    # Fallback to jq if available
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
    *)
        # Unknown command - try to run it directly with modified PATH
        export PATH="$PHP_PATH:$NODE_PATH:$MYSQL_BIN_PATH:$PATH"
        exec "$CMD" "$@"
        ;;
esac
`;

    const scriptPath = path.join(cliPath, alias);
    await fs.writeFile(scriptPath, shellContent, 'utf8');
    await fs.chmod(scriptPath, '755');

    // CLI script installed (macOS/Linux)
    return scriptPath;
  }

  /**
   * Get instructions for adding CLI to PATH
   */
  getInstallInstructions(cliPath) {
    if (process.platform === 'win32') {
      return {
        automatic: `Add the following to your system PATH:\n${cliPath}`,
        manual: [
          '1. Open System Properties (Win + Pause/Break)',
          '2. Click "Advanced system settings"',
          '3. Click "Environment Variables"',
          '4. Under "User variables", find and select "Path"',
          '5. Click "Edit" then "New"',
          `6. Add: ${cliPath}`,
          '7. Click OK on all dialogs',
          '8. Restart your terminal/editor',
        ],
        powershell: `[Environment]::SetEnvironmentVariable("Path", $env:Path + ";${cliPath}", "User")`,
      };
    } else {
      const shell = process.env.SHELL || '/bin/bash';
      const rcFile = shell.includes('zsh') ? '~/.zshrc' : '~/.bashrc';

      return {
        automatic: `Add to ${rcFile}:\nexport PATH="${cliPath}:$PATH"`,
        manual: [
          `1. Open ${rcFile} in a text editor`,
          `2. Add this line: export PATH="${cliPath}:$PATH"`,
          '3. Save and close the file',
          `4. Run: source ${rcFile}`,
        ],
        command: `echo 'export PATH="${cliPath}:$PATH"' >> ${rcFile} && source ${rcFile}`,
      };
    }
  }

  /**
   * Check if CLI is installed and in PATH
   */
  async checkCliInstalled() {
    const alias = this.getAlias();
    const cliPath = this.getCliPath();
    const scriptName = process.platform === 'win32' ? `${alias}.cmd` : alias;
    const scriptPath = path.join(cliPath, scriptName);

    const scriptExists = await fs.pathExists(scriptPath);

    // Check if in PATH
    let inPath = false;
    try {
      if (process.platform === 'win32') {
        // On Windows, check the actual User PATH from registry
        // This is more reliable than process.env.PATH which may be stale
        inPath = await this.isInWindowsUserPath(cliPath);
      } else {
        // For macOS/Linux, check process.env.PATH
        const pathDirs = (process.env.PATH || '').split(path.delimiter);
        inPath = pathDirs.some(dir => path.normalize(dir).toLowerCase() === path.normalize(cliPath).toLowerCase());
      }
    } catch (e) {
      this.managers?.log?.systemError('Error checking PATH', { error: e.message });
      // Fallback to checking process.env.PATH
      try {
        const pathDirs = (process.env.PATH || '').split(path.delimiter);
        inPath = pathDirs.some(dir => path.normalize(dir).toLowerCase() === path.normalize(cliPath).toLowerCase());
      } catch (e2) {
        // Ignore
      }
    }

    return {
      alias,
      installed: scriptExists,
      inPath,
      scriptPath,
      cliPath,
    };
  }

  /**
   * Check if a path is in the Windows User PATH (reads from registry)
   */
  async isInWindowsUserPath(targetPath) {
    return new Promise((resolve) => {
      // Normalize the target path - remove trailing slashes
      const normalizedTarget = targetPath.replace(/[\\/]+$/, '');

      // Create a simple inline script that checks the PATH
      const psScript = `
$targetPath = '${normalizedTarget.replace(/'/g, "''")}'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$systemPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$fullPath = "$systemPath;$userPath"
$found = $fullPath.Split(';') | Where-Object { 
  $_.Trim().TrimEnd('\\', '/') -ieq $targetPath 
}
if ($found) { 'FOUND' } else { 'NOTFOUND' }
`;

      const child = spawn('powershell', ['-NoProfile', '-Command', psScript], {
        windowsHide: true,
      });

      // Set a timeout manually
      const timeout = setTimeout(() => {
        child.kill();
        this.managers?.log?.systemError('PowerShell PATH check timed out');
        resolve(false);
      }, 5000);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        clearTimeout(timeout);
        this.managers?.log?.systemError('Error checking Windows PATH', { error: error.message });
        resolve(false);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) {
          this.managers?.log?.systemError('PowerShell PATH check failed', { stderr });
          resolve(false);
        } else {
          resolve(stdout.trim() === 'FOUND');
        }
      });
    });
  }

  /**
   * Add CLI path to user's PATH
   * Windows: Tries System PATH first, falls back to User PATH
   * Mac/Linux: Adds to shell config file (~/.zshrc or ~/.bashrc)
   */
  async addToPath() {
    const cliPath = this.getCliPath();
    const normalizedCliPath = cliPath.replace(/[\\/]+$/, '');

    if (process.platform === 'win32') {
      // Windows: Try System PATH first, then User PATH
      const systemResult = await this.tryAddToSystemPath(normalizedCliPath);
      const userResult = await this.addToUserPath(normalizedCliPath);

      return {
        success: true,
        systemPath: systemResult,
        userPath: userResult,
        message: systemResult.success
          ? 'Added to System PATH (takes priority over all other paths)'
          : 'Added to User PATH (at the beginning for priority)',
        note: 'Please restart your terminal/editor for changes to take effect.',
      };
    } else {
      // Mac/Linux: Add to shell config file
      return await this.addToUnixPath(normalizedCliPath);
    }
  }

  /**
   * Add CLI path to Unix shell config (~/.zshrc or ~/.bashrc)
   */
  async addToUnixPath(cliPath) {
    const homeDir = os.homedir();
    const shell = process.env.SHELL || '/bin/bash';
    const rcFile = shell.includes('zsh') ? '.zshrc' : '.bashrc';
    const rcPath = path.join(homeDir, rcFile);

    const exportLine = `export PATH="${cliPath}:$PATH"  # DevBox Pro CLI`;
    const marker = '# DevBox Pro CLI';

    try {
      let content = '';
      if (await fs.pathExists(rcPath)) {
        content = await fs.readFile(rcPath, 'utf8');
      }

      // Check if already added
      if (content.includes(marker)) {
        return {
          success: true,
          message: 'Already in PATH',
          rcFile: rcPath,
          note: 'DevBox Pro CLI is already configured in your shell.',
        };
      }

      // Prepend the export line (for priority)
      const newContent = exportLine + '\n' + content;
      await fs.writeFile(rcPath, newContent, 'utf8');

      return {
        success: true,
        message: `Added to ${rcFile}`,
        rcFile: rcPath,
        note: `Please restart your terminal or run: source ~/${rcFile}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to modify ${rcFile}: ${error.message}`,
        rcFile: rcPath,
      };
    }
  }

  /**
   * Try to add CLI path to System PATH (requires elevation via UAC)
   */
  async tryAddToSystemPath(normalizedCliPath) {
    const tempScriptFile = path.join(os.tmpdir(), 'devbox_add_path.ps1');
    const tempResultFile = path.join(os.tmpdir(), 'devbox_path_result.txt');

    // Write PowerShell script to temp file
    const psScript = `
$targetPath = '${normalizedCliPath.replace(/'/g, "''")}'
$resultFile = '${tempResultFile.replace(/\\/g, '\\\\')}'
$systemPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if ([string]::IsNullOrEmpty($systemPath)) { $systemPath = '' }
if ($systemPath.StartsWith($targetPath + ';') -or $systemPath -eq $targetPath) {
  'ALREADY_FIRST' | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
  exit 0
}
$pathArray = $systemPath.Split(';') | Where-Object { $_.Trim() -ne '' }
$pathArray = $pathArray | Where-Object { $_.Trim().TrimEnd('\\', '/') -ine $targetPath }
$newPath = if ($pathArray.Count -gt 0) { "$targetPath;" + ($pathArray -join ';') } else { $targetPath }
try {
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
  'SUCCESS' | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
} catch {
  'FAILED' | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
}
`;

    try {
      // Write script to temp file
      await fs.writeFile(tempScriptFile, psScript, 'utf8');

      // Remove old result file if exists
      if (await fs.pathExists(tempResultFile)) {
        await fs.remove(tempResultFile);
      }

      return new Promise((resolve) => {
        // Run elevated using Start-Process -Verb RunAs (triggers UAC)
        const elevatedCommand = `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScriptFile.replace(/\\/g, '\\\\')}'`;

        const child = spawn('powershell', ['-NoProfile', '-Command', elevatedCommand], {
          windowsHide: true,
        });

        child.on('error', async () => {
          await fs.remove(tempScriptFile).catch(() => { });
          resolve({ success: false, reason: 'spawn_error' });
        });

        child.on('close', async () => {
          // Clean up script file
          await fs.remove(tempScriptFile).catch(() => { });

          // Read result from temp file
          try {
            const exists = await fs.pathExists(tempResultFile);

            if (exists) {
              const result = (await fs.readFile(tempResultFile, 'utf8')).trim();
              await fs.remove(tempResultFile);
              if (result === 'SUCCESS' || result === 'ALREADY_FIRST') {
                resolve({ success: true, message: result });
              } else {
                resolve({ success: false, reason: 'failed' });
              }
            } else {
              // No result file means UAC was cancelled
              resolve({ success: false, reason: 'uac_cancelled' });
            }
          } catch (e) {
            resolve({ success: false, reason: 'read_error' });
          }
        });
      });
    } catch (e) {
      return { success: false, reason: 'write_error' };
    }
  }

  /**
   * Add CLI path to User PATH
   */
  async addToUserPath(normalizedCliPath) {
    return new Promise((resolve, reject) => {
      const psScript = `
$targetPath = '${normalizedCliPath.replace(/'/g, "''")}'
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ([string]::IsNullOrEmpty($currentPath)) {
  $currentPath = ''
}
$pathArray = $currentPath.Split(';') | Where-Object { $_.Trim() -ne '' }
# Remove existing entry if present (we'll re-add at the beginning)
$pathArray = $pathArray | Where-Object { $_.Trim().TrimEnd('\\', '/') -ine $targetPath }
# PREPEND the DevBox Pro CLI path (at the beginning) so it takes precedence
$newPath = if ($pathArray.Count -gt 0) { "$targetPath;" + ($pathArray -join ';') } else { $targetPath }
[Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
Write-Output 'Added to User PATH'
`;

      const child = spawn('powershell', ['-NoProfile', '-Command', psScript], {
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to add to User PATH: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to add to User PATH: ${stderr}`));
        } else {
          resolve({ success: true, message: stdout.trim() });
        }
      });
    });
  }

  /**
   * Remove CLI path from PATH
   * Windows: Removes from both System and User PATH
   * Mac/Linux: Removes from shell config file
   */
  async removeFromPath() {
    const cliPath = this.getCliPath();
    const normalizedCliPath = cliPath.replace(/[\\/]+$/, '');

    if (process.platform === 'win32') {
      // Windows: Remove from both System PATH and User PATH
      const systemResult = await this.tryRemoveFromSystemPath(normalizedCliPath);
      const userResult = await this.removeFromUserPath(normalizedCliPath);

      return {
        success: true,
        systemPath: systemResult,
        userPath: userResult,
        message: 'Removed from PATH',
        note: 'Please restart your terminal/editor for changes to take effect.',
      };
    } else {
      // Mac/Linux: Remove from shell config file
      return await this.removeFromUnixPath(normalizedCliPath);
    }
  }

  /**
   * Remove CLI path from Unix shell config (~/.zshrc or ~/.bashrc)
   */
  async removeFromUnixPath(cliPath) {
    const homeDir = os.homedir();
    const shell = process.env.SHELL || '/bin/bash';
    const rcFile = shell.includes('zsh') ? '.zshrc' : '.bashrc';
    const rcPath = path.join(homeDir, rcFile);

    const marker = '# DevBox Pro CLI';

    try {
      if (!await fs.pathExists(rcPath)) {
        return {
          success: true,
          message: 'Not in PATH',
          rcFile: rcPath,
        };
      }

      const content = await fs.readFile(rcPath, 'utf8');

      // Check if our marker exists
      if (!content.includes(marker)) {
        return {
          success: true,
          message: 'Not in PATH',
          rcFile: rcPath,
        };
      }

      // Remove lines containing our marker
      const lines = content.split('\n');
      const newLines = lines.filter(line => !line.includes(marker));
      const newContent = newLines.join('\n');

      await fs.writeFile(rcPath, newContent, 'utf8');

      return {
        success: true,
        message: `Removed from ${rcFile}`,
        rcFile: rcPath,
        note: `Please restart your terminal or run: source ~/${rcFile}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to modify ${rcFile}: ${error.message}`,
        rcFile: rcPath,
      };
    }
  }

  /**
   * Try to remove CLI path from System PATH (requires elevation via UAC)
   */
  async tryRemoveFromSystemPath(normalizedCliPath) {
    const tempScriptFile = path.join(os.tmpdir(), 'devbox_remove_path.ps1');
    const tempResultFile = path.join(os.tmpdir(), 'devbox_path_remove_result.txt');

    // Write PowerShell script to temp file
    const psScript = `
$targetPath = '${normalizedCliPath.replace(/'/g, "''")}'
$resultFile = '${tempResultFile.replace(/\\/g, '\\\\')}'
$systemPath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
if ([string]::IsNullOrEmpty($systemPath)) {
  'NOT_IN_PATH' | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
  exit 0
}
$pathArray = $systemPath.Split(';') | Where-Object { $_.Trim() -ne '' }
$newArray = $pathArray | Where-Object { $_.Trim().TrimEnd('\\', '/') -ine $targetPath }
if ($newArray.Count -lt $pathArray.Count) {
  try {
    $newPath = $newArray -join ';'
    [Environment]::SetEnvironmentVariable('Path', $newPath, 'Machine')
    'REMOVED' | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
  } catch {
    'FAILED' | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
  }
} else {
  'NOT_IN_PATH' | Out-File -FilePath $resultFile -Encoding utf8 -NoNewline
}
`;

    try {
      // Write script to temp file
      await fs.writeFile(tempScriptFile, psScript, 'utf8');

      // Remove old result file if exists
      if (await fs.pathExists(tempResultFile)) {
        await fs.remove(tempResultFile);
      }

      return new Promise((resolve) => {
        // Run elevated using Start-Process -Verb RunAs (triggers UAC)
        const elevatedCommand = `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScriptFile.replace(/\\/g, '\\\\')}'`;

        const child = spawn('powershell', ['-NoProfile', '-Command', elevatedCommand], {
          windowsHide: true,
        });

        child.on('error', async () => {
          await fs.remove(tempScriptFile).catch(() => { });
          resolve({ success: false, reason: 'spawn_error' });
        });

        child.on('close', async () => {
          // Clean up script file
          await fs.remove(tempScriptFile).catch(() => { });

          // Read result from temp file
          try {
            if (await fs.pathExists(tempResultFile)) {
              const result = (await fs.readFile(tempResultFile, 'utf8')).trim();
              await fs.remove(tempResultFile);
              if (result === 'REMOVED' || result === 'NOT_IN_PATH') {
                resolve({ success: true, message: result });
              } else {
                resolve({ success: false, reason: 'failed' });
              }
            } else {
              // No result file means UAC was cancelled
              resolve({ success: false, reason: 'uac_cancelled' });
            }
          } catch (e) {
            resolve({ success: false, reason: 'read_error' });
          }
        });
      });
    } catch (e) {
      return { success: false, reason: 'write_error' };
    }
  }

  /**
   * Remove CLI path from User PATH
   */
  async removeFromUserPath(normalizedCliPath) {
    return new Promise((resolve, reject) => {
      const psScript = `
$targetPath = '${normalizedCliPath.replace(/'/g, "''")}'
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ([string]::IsNullOrEmpty($currentPath)) {
  Write-Output 'Not in PATH'
  exit
}
$pathArray = $currentPath.Split(';') | Where-Object { $_.Trim() -ne '' }
$newArray = $pathArray | Where-Object { $_.Trim().TrimEnd('\\', '/') -ine $targetPath }
if ($newArray.Count -lt $pathArray.Count) {
  $newPath = $newArray -join ';'
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Output 'Removed from PATH'
} else {
  Write-Output 'Not in PATH'
}
`;

      const child = spawn('powershell', ['-NoProfile', '-Command', psScript], {
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(new Error(`Failed to remove from User PATH: ${error.message}`));
      });

      child.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`Failed to remove from User PATH: ${stderr}`));
        } else {
          resolve({ success: true, message: stdout.trim() });
        }
      });
    });
  }

  /**
   * Get direct shims setting (whether to install php, npm, node, composer commands directly)
   */
  getDirectShimsEnabled() {
    return this.configStore.get('settings.directShimsEnabled', true);
  }

  /**
   * Set direct shims setting
   */
  async setDirectShimsEnabled(enabled) {
    this.configStore.set('settings.directShimsEnabled', enabled);

    if (enabled) {
      await this.installDirectShims();
    } else {
      await this.removeDirectShims();
    }

    return enabled;
  }

  /**
   * Get default PHP version for non-project directories
   */
  getDefaultPhpVersion() {
    return this.configStore.get('settings.defaultPhpVersion', null);
  }


  /**
   * Set default PHP version
   */
  setDefaultPhpVersion(version) {
    if (version) {
      this.configStore.set('settings.defaultPhpVersion', version);
    } else {
      // Use configStore.delete() directly to ensure value is removed
      this.configStore.delete('settings.defaultPhpVersion');
    }
  }

  /**
   * Get default Node.js version for non-project directories
   */
  getDefaultNodeVersion() {
    return this.configStore.get('settings.defaultNodeVersion', null);
  }

  /**
   * Set default Node.js version
   */
  setDefaultNodeVersion(version) {
    if (version) {
      this.configStore.set('settings.defaultNodeVersion', version);
    } else {
      // Use configStore.delete() directly to ensure value is removed
      this.configStore.delete('settings.defaultNodeVersion');
    }
  }

  /**
   * Get default MySQL type for non-project directories
   * Returns the active database type from settings
   */
  getDefaultMysqlType() {
    return this.getActiveMysqlInfo().dbType;
  }

  /**
   * Get default MySQL version for non-project directories
   * Returns the active database version from settings
   */
  getDefaultMysqlVersion() {
    return this.getActiveMysqlInfo().version;
  }

  /**
   * Install direct command shims (php, npm, node, composer)
   */
  async installDirectShims() {
    const cliPath = this.getCliPath();
    await fs.ensureDir(cliPath);

    // Sync projects file first
    await this.syncProjectsFile();

    if (process.platform === 'win32') {
      await this.installWindowsDirectShims(cliPath);
    } else {
      await this.installUnixDirectShims(cliPath);
    }

    return { success: true, path: cliPath };
  }

  /**
   * Remove direct command shims
   */
  async removeDirectShims() {
    const cliPath = this.getCliPath();
    const commands = ['php', 'node', 'npm', 'npx', 'composer', 'mysql', 'mysqldump'];
    const ext = process.platform === 'win32' ? '.cmd' : '';

    for (const cmd of commands) {
      const shimPath = path.join(cliPath, `${cmd}${ext}`);
      try {
        if (await fs.pathExists(shimPath)) {
          await fs.remove(shimPath);
        }
      } catch (e) {
        // Ignore removal errors
      }
    }

    return { success: true };
  }

  /**
   * Install Windows direct command shims
   */
  async installWindowsDirectShims(cliPath) {
    const resourcesPath = this.resourcesPath;
    const projectsFilePath = this.getProjectsFilePath();
    const defaultPhpVersion = this.getDefaultPhpVersion() || this.getFirstInstalledPhpVersion();
    const defaultNodeVersion = this.getDefaultNodeVersion() || this.getFirstInstalledNodeVersion();
    const defaultMysqlInfo = this.getActiveMysqlInfo();
    const defaultMysqlType = defaultMysqlInfo.dbType;
    const defaultMysqlVersion = defaultMysqlInfo.version;

    // PHP shim - Use ^| to escape pipe in batch
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

    // Node shim
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
    echo [DevBox Pro] Node.js %NODE_VERSION% not found.
    exit /b 1
)
`;


    // NPM shim
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
    echo [DevBox Pro] npm not found.
    exit /b 1
)
`;

    // NPX shim
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
    echo [DevBox Pro] npx not found.
    exit /b 1
)
`;

    // Composer shim
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

    // MySQL client shim
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

    // mysqldump shim
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

    // Write all shims
    await fs.writeFile(path.join(cliPath, 'php.cmd'), phpShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'node.cmd'), nodeShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'npm.cmd'), npmShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'npx.cmd'), npxShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'composer.cmd'), composerShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'mysql.cmd'), mysqlShim, 'utf8');
    await fs.writeFile(path.join(cliPath, 'mysqldump.cmd'), mysqldumpShim, 'utf8');

    return true;
  }

  /**
   * Install Unix direct command shims
   */
  async installUnixDirectShims(cliPath) {
    const resourcesPath = this.resourcesPath;
    const projectsFilePath = this.getProjectsFilePath();
    const platform = process.platform === 'darwin' ? 'mac' : 'linux';
    const defaultPhpVersion = this.getDefaultPhpVersion() || this.getFirstInstalledPhpVersion();
    const defaultNodeVersion = this.getDefaultNodeVersion() || this.getFirstInstalledNodeVersion();
    const defaultMysqlInfo = this.getActiveMysqlInfo();
    const defaultMysqlType = defaultMysqlInfo.dbType;
    const defaultMysqlVersion = defaultMysqlInfo.version;

    // PHP shim
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

# Use project version or default
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

    // Node shim
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

# Use project version or default
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

    // Write shims and make executable
    const shims = [
      { name: 'php', content: phpShim },
      { name: 'node', content: nodeShim },
    ];

    for (const shim of shims) {
      const shimPath = path.join(cliPath, shim.name);
      await fs.writeFile(shimPath, shim.content, 'utf8');
      await fs.chmod(shimPath, 0o755);
    }

    // For npm, npx, and composer, create symlink-style shims that use node
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

# Fallback to system npm
command -v npm &> /dev/null && exec npm "$@"
echo "[DevBox Pro] npm not found."
exit 1
`;

    await fs.writeFile(path.join(cliPath, 'npm'), npmShim, 'utf8');
    await fs.chmod(path.join(cliPath, 'npm'), 0o755);

    await fs.writeFile(path.join(cliPath, 'npx'), npmShim.replace(/npm/g, 'npx'), 'utf8');
    await fs.chmod(path.join(cliPath, 'npx'), 0o755);

    // Composer shim
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

    // MySQL client shim
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

    // mysqldump shim
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

    return true;
  }

  /**
   * Get the first available installed PHP version
   */
  getFirstInstalledPhpVersion() {
    if (!this.resourcesPath) return '8.3';

    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpDir = path.join(this.resourcesPath, 'php');

    try {
      if (!fs.existsSync(phpDir)) return '8.3';

      const versions = fs.readdirSync(phpDir)
        .filter(v => v !== 'downloads' && v !== 'win' && v !== 'mac')
        .filter(v => {
          const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
          return fs.existsSync(path.join(phpDir, v, platform, phpExe));
        })
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

      return versions[0] || '8.3';
    } catch (e) {
      return '8.3';
    }
  }
}

module.exports = CliManager;
