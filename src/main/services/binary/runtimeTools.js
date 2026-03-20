const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { spawnAsync, killProcessesByPath } = require('../../utils/SpawnUtils');

module.exports = {
  async downloadNodejs(version = '20') {
    const id = `nodejs-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.nodejs[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Node.js ${version} download not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const { downloadPath } = await this.downloadWithVersionProbe('nodejs', version, id, downloadInfo);

      await this.checkCancelled(id, downloadPath);
      this.emitProgress(id, { status: 'extracting', progress: 50 });

      const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);
      await this.prepareNodejsInstallPath(nodejsPath);
      await fs.ensureDir(nodejsPath);

      await this.extractArchive(downloadPath, nodejsPath, id);

      const contents = await fs.readdir(nodejsPath);
      const extractedDir = contents.find((entry) => entry.startsWith('node-'));
      if (extractedDir) {
        const srcPath = path.join(nodejsPath, extractedDir);
        const files = await fs.readdir(srcPath);
        for (const file of files) {
          await fs.move(path.join(srcPath, file), path.join(nodejsPath, file), { overwrite: true });
        }
        await fs.remove(srcPath);
      }

      await this.setupNodejsEnvironment(version, nodejsPath);

      if (!await this.isNodejsVersionInstalled(version, platform)) {
        await fs.remove(nodejsPath);
        throw new Error(`Node.js ${version} installation is incomplete after extraction. Please try downloading it again.`);
      }

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });

      return {
        success: true,
        version,
        path: nodejsPath,
      };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Node.js ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async setupNodejsEnvironment(version, nodejsPath) {
    const platform = this.getPlatform();
    const binDir = path.join(this.resourcesPath, 'bin');
    await fs.ensureDir(binDir);

    if (platform === 'win') {
      const nodeExe = path.join(nodejsPath, 'node.exe');
      const npmExe = path.join(nodejsPath, 'npm.cmd');
      const npxExe = path.join(nodejsPath, 'npx.cmd');

      const nodeBat = `@echo off\n"${nodeExe}" %*`;
      const npmBat = `@echo off\n"${npmExe}" %*`;
      const npxBat = `@echo off\n"${npxExe}" %*`;

      await fs.writeFile(path.join(binDir, `node${version}.cmd`), nodeBat);
      await fs.writeFile(path.join(binDir, `npm${version}.cmd`), npmBat);
      await fs.writeFile(path.join(binDir, `npx${version}.cmd`), npxBat);
      return;
    }

    const nodeBin = path.join(nodejsPath, 'bin', 'node');
    const npmBin = path.join(nodejsPath, 'bin', 'npm');
    const npxBin = path.join(nodejsPath, 'bin', 'npx');

    try {
      await fs.symlink(nodeBin, path.join(binDir, `node${version}`));
      await fs.symlink(npmBin, path.join(binDir, `npm${version}`));
      await fs.symlink(npxBin, path.join(binDir, `npx${version}`));
    } catch {
    }
  },

  async prepareNodejsInstallPath(nodejsPath) {
    if (!await fs.pathExists(nodejsPath)) {
      return;
    }

    if (process.platform === 'win32') {
      try {
        await killProcessesByPath('node.exe', nodejsPath);
      } catch (error) {
        this.managers?.log?.systemWarn('Failed to stop existing Node.js processes before reinstall', { error: error.message, nodejsPath });
      }

      await new Promise((resolve) => setTimeout(resolve, 750));
    }

    let lastError = null;

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await fs.remove(nodejsPath);
        return;
      } catch (error) {
        lastError = error;

        if (process.platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code) || attempt === 3) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }

    if (lastError) {
      throw lastError;
    }
  },

  getNodejsPath(version = '20') {
    const platform = this.getPlatform();
    const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);
    const nodeExe = platform === 'win' ? 'node.exe' : 'bin/node';
    return path.join(nodejsPath, nodeExe);
  },

  getNpmPath(version = '20') {
    const platform = this.getPlatform();
    const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);
    const npmExe = platform === 'win' ? 'npm.cmd' : 'bin/npm';
    return path.join(nodejsPath, npmExe);
  },

  async downloadComposer() {
    const id = 'composer';

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', 'composer.phar');
      await fs.ensureDir(path.dirname(downloadPath));
      await this.downloadFile(this.downloads.composer.all.url, downloadPath, id, { forceIPv4: true });

      this.emitProgress(id, { status: 'installing', progress: 60 });

      if (!await fs.pathExists(downloadPath)) {
        throw new Error('Download did not complete - file not found after download.');
      }

      const composerDir = path.join(this.resourcesPath, 'composer');
      await fs.ensureDir(composerDir);
      await fs.copy(downloadPath, path.join(composerDir, 'composer.phar'));
      await this.setupComposerEnvironment(composerDir);

      try {
        const meta = await this.fetchRemoteMetadata(this.downloads.composer.all.url);
        await this.saveServiceMetadata('composer', meta);
      } catch {
      }

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });

      return {
        success: true,
        path: composerDir,
      };
    } catch (error) {
      this.managers?.log?.systemError('Failed to download Composer', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async setupComposerEnvironment(composerDir) {
    const platform = this.getPlatform();
    const binDir = path.join(this.resourcesPath, 'bin');
    await fs.ensureDir(binDir);

    const composerPhar = path.join(composerDir, 'composer.phar');

    if (platform === 'win') {
      const composerBat = `@echo off
setlocal
set "PHP_PATHS=${path.join(this.resourcesPath, 'php')}"
for /d %%V in ("%PHP_PATHS%\\*") do (
    if exist "%%V\\win\\php.exe" (
        "%%V\\win\\php.exe" "${composerPhar}" %*
        exit /b %ERRORLEVEL%
    )
)
echo No PHP installation found. Please install PHP first.
exit /b 1
`;
      await fs.writeFile(path.join(binDir, 'composer.cmd'), composerBat);
      await fs.writeFile(path.join(composerDir, 'composer.cmd'), composerBat);
      return;
    }

    const composerSh = `#!/bin/bash
PHP_PATHS="${path.join(this.resourcesPath, 'php')}"
for VERSION in 8.3 8.2 8.1 8.0 7.4; do
    if [ -x "$PHP_PATHS/$VERSION/mac/php" ]; then
        "$PHP_PATHS/$VERSION/mac/php" "${composerPhar}" "$@"
        exit $?
    fi
done
echo "No PHP installation found. Please install PHP first."
exit 1
`;
    await fs.writeFile(path.join(binDir, 'composer'), composerSh);
    await fs.chmod(path.join(binDir, 'composer'), '755');
    await fs.writeFile(path.join(composerDir, 'composer'), composerSh);
    await fs.chmod(path.join(composerDir, 'composer'), '755');
  },

  getComposerPath() {
    return path.join(this.resourcesPath, 'composer', 'composer.phar');
  },

  async runComposer(projectPath, command, phpVersion = '8.3', onOutput = null) {
    const platform = this.getPlatform();
    const phpDir = path.join(this.resourcesPath, 'php', phpVersion, platform);
    const phpPath = path.join(phpDir, platform === 'win' ? 'php.exe' : 'php');
    const composerPhar = this.getComposerPath();

    if (!await fs.pathExists(phpPath)) {
      const error = `PHP ${phpVersion} is not installed. Please download it from the Binary Manager.`;
      if (onOutput) onOutput(error, 'error');
      throw new Error(error);
    }

    if (!await fs.pathExists(composerPhar)) {
      const error = 'Composer is not installed. Please download it from the Binary Manager.';
      if (onOutput) onOutput(error, 'error');
      throw new Error(error);
    }

    const args = [composerPhar, ...command.split(' ')];
    const spawnEnv = {
      ...process.env,
      PATH: platform === 'win'
        ? `${phpDir};${process.env.PATH || ''}`
        : `${phpDir}:${process.env.PATH || ''}`,
      COMPOSER_HOME: path.join(this.resourcesPath, 'composer'),
      COMPOSER_NO_INTERACTION: '1',
    };

    const spawnOptions = {
      cwd: projectPath,
      env: spawnEnv,
      onStdout: (text) => onOutput?.(text.trim(), 'stdout'),
      onStderr: (text) => onOutput?.(text.trim(), 'stderr'),
    };

    try {
      const { code, error, stderr } = await spawnAsync(phpPath, args, spawnOptions);

      if (code === 0) {
        return { stdout: '', stderr: '' };
      }

      const errorMsg = stderr || error?.message || `Composer exited with code ${code}`;
      if (onOutput) onOutput(`Process exited with code ${code}`, 'error');
      throw new Error(errorMsg);
    } catch (err) {
      this.managers?.log?.systemError('[runComposer] Process error', { error: err.message });
      if (onOutput) onOutput(`Process error: ${err.message}`, 'error');
      throw err;
    }
  },

  async runNpm(projectPath, command, nodeVersion = '20') {
    const platform = this.getPlatform();
    const nodejsPath = path.join(this.resourcesPath, 'nodejs', nodeVersion, platform);
    const nodePath = platform === 'win' ? path.join(nodejsPath, 'node.exe') : path.join(nodejsPath, 'bin', 'node');
    const npmScript = platform === 'win'
      ? path.join(nodejsPath, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(nodejsPath, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');

    if (!await fs.pathExists(nodePath)) {
      throw new Error(`Node.js ${nodeVersion} is not installed`);
    }

    return new Promise((resolve, reject) => {
      const args = [npmScript, ...command.split(' ')];
      const proc = spawn(nodePath, args, {
        cwd: projectPath,
        env: {
          ...process.env,
          PATH: `${nodejsPath}${platform === 'win' ? '' : '/bin'}${path.delimiter}${process.env.PATH}`,
        },
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        reject(new Error(stderr || `npm exited with code ${code}`));
      });

      proc.on('error', reject);
    });
  },

  async downloadGit() {
    const platform = this.getPlatform();
    const id = 'git-portable';

    if (platform === 'mac') {
      return {
        success: false,
        error: 'Git on macOS should be installed via: xcode-select --install or brew install git',
      };
    }

    const downloadInfo = this.downloads.git?.portable?.[platform];
    if (!downloadInfo || downloadInfo.url === 'builtin') {
      throw new Error('Git download not available for this platform');
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      await this.downloadFile(downloadInfo.url, downloadPath, id);

      await this.checkCancelled(id, downloadPath);
      this.emitProgress(id, { status: 'extracting', progress: 50, message: 'Extracting Portable Git (this may take a few minutes)...' });

      const gitPath = path.join(this.resourcesPath, 'git', platform);
      await fs.ensureDir(gitPath);

      await new Promise((resolve, reject) => {
        const proc = spawn(downloadPath, ['-o' + gitPath, '-y'], {
          windowsHide: true,
          stdio: 'ignore',
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Git extraction failed with code ${code}`));
          }
        });

        proc.on('error', (err) => {
          reject(new Error(`Failed to extract Git: ${err.message}`));
        });
      });

      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });

      return {
        success: true,
        path: gitPath,
      };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download Git', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },
};