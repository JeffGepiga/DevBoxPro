/**
 * CliManager - Manages CLI alias functionality
 * 
 * Provides a way for users to run PHP/Node commands using project-specific versions
 * from their external terminal/editor using a configurable alias (default: dvp)
 * 
 * Example usage:
 *   dvp php artisan optimize
 *   dvp npm install
 *   dvp composer install
 *   dvp node script.js
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
    console.log('CliManager initialized');
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
      const nodeVersion = project.services.nodejsVersion || '20';
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

    return env;
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
          const nodeVersion = project.services.nodejsVersion || '20';
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
    
    // Create the batch script
    const batchContent = `@echo off
setlocal enabledelayedexpansion

REM DevBox Pro CLI Wrapper
REM This script routes commands through DevBox Pro to use project-specific versions

set "DEVBOX_RESOURCES=${resourcesPath.replace(/\\/g, '\\\\')}"

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
    echo.
    echo Example:
    echo   ${alias} php artisan migrate
    echo   ${alias} npm install
    echo   ${alias} composer install
    exit /b 0
)

REM Find project config file
set "PROJECT_CONFIG="
set "CHECK_DIR=%CURRENT_DIR%"

:find_project
if exist "%CHECK_DIR%\\.devbox-project.json" (
    set "PROJECT_CONFIG=%CHECK_DIR%\\.devbox-project.json"
    goto :found_project
)

REM Go up one directory
for %%I in ("%CHECK_DIR%\\..") do set "PARENT_DIR=%%~fI"
if "%PARENT_DIR%"=="%CHECK_DIR%" goto :no_project
set "CHECK_DIR=%PARENT_DIR%"
goto :find_project

:no_project
REM Try to use DevBox Pro's data to find project
REM Fall back to system commands
echo Warning: Not in a DevBox Pro project directory
echo Running command with system defaults...
%*
exit /b %ERRORLEVEL%

:found_project
REM Parse project config to get versions (simplified - reads from DevBox data)
REM The actual execution happens through electron's IPC

REM For now, execute through the DevBox Pro app if it's running
REM Otherwise fall back to trying to find the binaries directly

set "PHP_VERSION=8.3"
set "NODE_VERSION=20"

REM Try to read from project config (basic parsing)
for /f "tokens=2 delims=:," %%a in ('type "%PROJECT_CONFIG%" ^| findstr "phpVersion"') do (
    set "PHP_VERSION=%%~a"
    set "PHP_VERSION=!PHP_VERSION: =!"
    set "PHP_VERSION=!PHP_VERSION:"=!"
)

for /f "tokens=2 delims=:," %%a in ('type "%PROJECT_CONFIG%" ^| findstr "nodejsVersion"') do (
    set "NODE_VERSION=%%~a"
    set "NODE_VERSION=!NODE_VERSION: =!"
    set "NODE_VERSION=!NODE_VERSION:"=!"
)

REM Set up paths based on detected versions
set "PHP_PATH=%DEVBOX_RESOURCES%\\php\\%PHP_VERSION%\\win"
set "NODE_PATH=%DEVBOX_RESOURCES%\\nodejs\\%NODE_VERSION%\\win"
set "COMPOSER_PATH=%DEVBOX_RESOURCES%\\composer"

REM Prepend to PATH
set "PATH=%PHP_PATH%;%NODE_PATH%;%COMPOSER_PATH%;%PATH%"

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
    if exist "%NODE_PATH%\\node.exe" (
        "%NODE_PATH%\\node.exe" %1 %2 %3 %4 %5 %6 %7 %8 %9
    ) else (
        echo Node.js %NODE_VERSION% not found. Install it from DevBox Pro Binaries page.
        exit /b 1
    )
    exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="npm" (
    if exist "%NODE_PATH%\\npm.cmd" (
        call "%NODE_PATH%\\npm.cmd" %1 %2 %3 %4 %5 %6 %7 %8 %9
    ) else (
        echo npm not found. Install Node.js from DevBox Pro Binaries page.
        exit /b 1
    )
    exit /b %ERRORLEVEL%
)

if /i "%CMD%"=="npx" (
    if exist "%NODE_PATH%\\npx.cmd" (
        call "%NODE_PATH%\\npx.cmd" %1 %2 %3 %4 %5 %6 %7 %8 %9
    ) else (
        echo npx not found. Install Node.js from DevBox Pro Binaries page.
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
    
    console.log(`CLI script installed at: ${batchPath}`);
    return batchPath;
  }

  /**
   * Install Unix shell script
   */
  async installUnixCli(alias, cliPath) {
    const resourcesPath = this.resourcesPath;
    const platform = process.platform === 'darwin' ? 'mac' : 'linux';
    
    const shellContent = `#!/bin/bash

# DevBox Pro CLI Wrapper
# This script routes commands through DevBox Pro to use project-specific versions

DEVBOX_RESOURCES="${resourcesPath}"
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
    echo ""
    echo "Example:"
    echo "  ${alias} php artisan migrate"
    echo "  ${alias} npm install"
    echo "  ${alias} composer install"
    exit 0
fi

# Find project config file by walking up the directory tree
find_project_config() {
    local dir="$1"
    while [ "$dir" != "/" ]; do
        if [ -f "$dir/.devbox-project.json" ]; then
            echo "$dir/.devbox-project.json"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

PROJECT_CONFIG=$(find_project_config "$CURRENT_DIR")

if [ -z "$PROJECT_CONFIG" ]; then
    echo "Warning: Not in a DevBox Pro project directory"
    echo "Running command with system defaults..."
    exec "$@"
fi

# Parse versions from config (simple grep-based parsing)
PHP_VERSION=$(grep -o '"phpVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$PROJECT_CONFIG" | cut -d'"' -f4)
NODE_VERSION=$(grep -o '"nodejsVersion"[[:space:]]*:[[:space:]]*"[^"]*"' "$PROJECT_CONFIG" | cut -d'"' -f4)

PHP_VERSION=\${PHP_VERSION:-8.3}
NODE_VERSION=\${NODE_VERSION:-20}

# Set up paths
PHP_PATH="$DEVBOX_RESOURCES/php/$PHP_VERSION/${platform}"
NODE_PATH="$DEVBOX_RESOURCES/nodejs/$NODE_VERSION/${platform}"
COMPOSER_PATH="$DEVBOX_RESOURCES/composer"

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
        if [ -x "$NODE_PATH/node" ]; then
            exec "$NODE_PATH/node" "$@"
        else
            echo "Node.js $NODE_VERSION not found. Install it from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    npm)
        if [ -x "$NODE_PATH/npm" ]; then
            export PATH="$NODE_PATH:$PATH"
            exec "$NODE_PATH/npm" "$@"
        else
            echo "npm not found. Install Node.js from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    npx)
        if [ -x "$NODE_PATH/npx" ]; then
            export PATH="$NODE_PATH:$PATH"
            exec "$NODE_PATH/npx" "$@"
        else
            echo "npx not found. Install Node.js from DevBox Pro Binaries page."
            exit 1
        fi
        ;;
    *)
        # Unknown command - try to run it directly with modified PATH
        export PATH="$PHP_PATH:$NODE_PATH:$PATH"
        exec "$CMD" "$@"
        ;;
esac
`;

    const scriptPath = path.join(cliPath, alias);
    await fs.writeFile(scriptPath, shellContent, 'utf8');
    await fs.chmod(scriptPath, '755');
    
    console.log(`CLI script installed at: ${scriptPath}`);
    return scriptPath;
  }

  /**
   * Create project-specific config file in project directory
   */
  async createProjectConfig(projectId) {
    const projects = this.configStore.get('projects', []);
    const project = projects.find(p => p.id === projectId);
    
    if (!project) {
      throw new Error('Project not found');
    }

    const configPath = path.join(project.path, '.devbox-project.json');
    const config = {
      id: project.id,
      name: project.name,
      phpVersion: project.phpVersion,
      services: {
        mysql: project.services?.mysql || false,
        mysqlVersion: project.services?.mysqlVersion || '8.4',
        mariadb: project.services?.mariadb || false,
        mariadbVersion: project.services?.mariadbVersion || '11.4',
        redis: project.services?.redis || false,
        redisVersion: project.services?.redisVersion || '7.4',
        nodejs: project.services?.nodejs || false,
        nodejsVersion: project.services?.nodejsVersion || '20',
      },
      createdAt: new Date().toISOString(),
    };

    await fs.writeJson(configPath, config, { spaces: 2 });
    console.log(`Project config created: ${configPath}`);
    
    return configPath;
  }

  /**
   * Sync all projects to create/update their .devbox-project.json files
   */
  async syncAllProjectConfigs() {
    const projects = this.configStore.get('projects', []);
    const results = [];

    for (const project of projects) {
      try {
        await this.createProjectConfig(project.id);
        results.push({ id: project.id, success: true });
      } catch (error) {
        results.push({ id: project.id, success: false, error: error.message });
      }
    }

    return results;
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
      const pathDirs = (process.env.PATH || '').split(path.delimiter);
      inPath = pathDirs.some(dir => path.normalize(dir).toLowerCase() === path.normalize(cliPath).toLowerCase());
    } catch (e) {
      // Ignore
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
   * Add CLI path to user's PATH (Windows only, requires admin for system PATH)
   */
  async addToPath() {
    if (process.platform !== 'win32') {
      throw new Error('Automatic PATH modification only supported on Windows. See manual instructions.');
    }

    const cliPath = this.getCliPath();
    
    return new Promise((resolve, reject) => {
      // Add to user PATH using PowerShell
      const psCommand = `
        $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($currentPath -notlike "*${cliPath.replace(/\\/g, '\\\\')}*") {
          [Environment]::SetEnvironmentVariable("Path", "$currentPath;${cliPath.replace(/\\/g, '\\\\')}", "User")
          Write-Output "Added to PATH"
        } else {
          Write-Output "Already in PATH"
        }
      `;
      
      exec(`powershell -Command "${psCommand.replace(/"/g, '\\"')}"`, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Failed to add to PATH: ${error.message}`));
        } else {
          resolve({
            success: true,
            message: stdout.trim(),
            note: 'Please restart your terminal/editor for changes to take effect.',
          });
        }
      });
    });
  }
}

module.exports = CliManager;
