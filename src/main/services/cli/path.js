const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const os = require('os');

module.exports = {
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
    }

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
  },

  async checkCliInstalled() {
    const alias = this.getAlias();
    const cliPath = this.getCliPath();
    const scriptName = process.platform === 'win32' ? `${alias}.cmd` : alias;
    const scriptPath = path.join(cliPath, scriptName);

    const scriptExists = await fs.pathExists(scriptPath);

    let inPath = false;
    try {
      if (process.platform === 'win32') {
        inPath = await this.isInWindowsUserPath(cliPath);
      } else {
        const pathDirs = (process.env.PATH || '').split(path.delimiter);
        inPath = pathDirs.some(dir => path.normalize(dir).toLowerCase() === path.normalize(cliPath).toLowerCase());
      }
    } catch (e) {
      this.managers?.log?.systemError('Error checking PATH', { error: e.message });
      try {
        const pathDirs = (process.env.PATH || '').split(path.delimiter);
        inPath = pathDirs.some(dir => path.normalize(dir).toLowerCase() === path.normalize(cliPath).toLowerCase());
      } catch (e2) {
        // Ignore fallback errors.
      }
    }

    return {
      alias,
      installed: scriptExists,
      inPath,
      scriptPath,
      cliPath,
    };
  },

  async isInWindowsUserPath(targetPath) {
    return new Promise((resolve) => {
      const normalizedTarget = targetPath.replace(/[\\/]+$/, '');
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
  },

  async addToPath() {
    const cliPath = this.getCliPath();
    const normalizedCliPath = cliPath.replace(/[\\/]+$/, '');

    if (process.platform === 'win32') {
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
    }

    return await this.addToUnixPath(normalizedCliPath);
  },

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

      if (content.includes(marker)) {
        return {
          success: true,
          message: 'Already in PATH',
          rcFile: rcPath,
          note: 'DevBox Pro CLI is already configured in your shell.',
        };
      }

      await fs.writeFile(rcPath, exportLine + '\n' + content, 'utf8');

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
  },

  async tryAddToSystemPath(normalizedCliPath) {
    const tempScriptFile = path.join(os.tmpdir(), 'devbox_add_path.ps1');
    const tempResultFile = path.join(os.tmpdir(), 'devbox_path_result.txt');
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
      await fs.writeFile(tempScriptFile, psScript, 'utf8');

      if (await fs.pathExists(tempResultFile)) {
        await fs.remove(tempResultFile);
      }

      return new Promise((resolve) => {
        const elevatedCommand = `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScriptFile.replace(/\\/g, '\\\\')}'`;
        const child = spawn('powershell', ['-NoProfile', '-Command', elevatedCommand], {
          windowsHide: true,
        });

        child.on('error', async () => {
          await fs.remove(tempScriptFile).catch(() => { });
          resolve({ success: false, reason: 'spawn_error' });
        });

        child.on('close', async () => {
          await fs.remove(tempScriptFile).catch(() => { });

          try {
            const exists = await fs.pathExists(tempResultFile);
            if (!exists) {
              resolve({ success: false, reason: 'uac_cancelled' });
              return;
            }

            const result = (await fs.readFile(tempResultFile, 'utf8')).trim();
            await fs.remove(tempResultFile);
            if (result === 'SUCCESS' || result === 'ALREADY_FIRST') {
              resolve({ success: true, message: result });
            } else {
              resolve({ success: false, reason: 'failed' });
            }
          } catch (e) {
            resolve({ success: false, reason: 'read_error' });
          }
        });
      });
    } catch (e) {
      return { success: false, reason: 'write_error' };
    }
  },

  async addToUserPath(normalizedCliPath) {
    return new Promise((resolve, reject) => {
      const psScript = `
$targetPath = '${normalizedCliPath.replace(/'/g, "''")}'
$currentPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if ([string]::IsNullOrEmpty($currentPath)) {
  $currentPath = ''
}
$pathArray = $currentPath.Split(';') | Where-Object { $_.Trim() -ne '' }
$pathArray = $pathArray | Where-Object { $_.Trim().TrimEnd('\\', '/') -ine $targetPath }
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
  },

  async removeFromPath() {
    const cliPath = this.getCliPath();
    const normalizedCliPath = cliPath.replace(/[\\/]+$/, '');

    if (process.platform === 'win32') {
      const systemResult = await this.tryRemoveFromSystemPath(normalizedCliPath);
      const userResult = await this.removeFromUserPath(normalizedCliPath);

      return {
        success: true,
        systemPath: systemResult,
        userPath: userResult,
        message: 'Removed from PATH',
        note: 'Please restart your terminal/editor for changes to take effect.',
      };
    }

    return await this.removeFromUnixPath(normalizedCliPath);
  },

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
      if (!content.includes(marker)) {
        return {
          success: true,
          message: 'Not in PATH',
          rcFile: rcPath,
        };
      }

      const nextContent = content
        .split('\n')
        .filter(line => !line.includes(marker))
        .join('\n');
      await fs.writeFile(rcPath, nextContent, 'utf8');

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
  },

  async tryRemoveFromSystemPath(normalizedCliPath) {
    const tempScriptFile = path.join(os.tmpdir(), 'devbox_remove_path.ps1');
    const tempResultFile = path.join(os.tmpdir(), 'devbox_path_remove_result.txt');
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
      await fs.writeFile(tempScriptFile, psScript, 'utf8');

      if (await fs.pathExists(tempResultFile)) {
        await fs.remove(tempResultFile);
      }

      return new Promise((resolve) => {
        const elevatedCommand = `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScriptFile.replace(/\\/g, '\\\\')}'`;
        const child = spawn('powershell', ['-NoProfile', '-Command', elevatedCommand], {
          windowsHide: true,
        });

        child.on('error', async () => {
          await fs.remove(tempScriptFile).catch(() => { });
          resolve({ success: false, reason: 'spawn_error' });
        });

        child.on('close', async () => {
          await fs.remove(tempScriptFile).catch(() => { });

          try {
            if (!await fs.pathExists(tempResultFile)) {
              resolve({ success: false, reason: 'uac_cancelled' });
              return;
            }

            const result = (await fs.readFile(tempResultFile, 'utf8')).trim();
            await fs.remove(tempResultFile);
            if (result === 'REMOVED' || result === 'NOT_IN_PATH') {
              resolve({ success: true, message: result });
            } else {
              resolve({ success: false, reason: 'failed' });
            }
          } catch (e) {
            resolve({ success: false, reason: 'read_error' });
          }
        });
      });
    } catch (e) {
      return { success: false, reason: 'write_error' };
    }
  },

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
  },
};