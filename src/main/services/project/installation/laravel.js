const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  async installLaravel(project, mainWindow = null) {
    const projectPath = project.path;
    const phpVersion = project.phpVersion || '8.4';
    const projectName = project.name || 'laravel';
    const useNodejs = project.services?.nodejs !== false;
    const nodejsVersion = project.services?.nodejsVersion || '20';
    const parentPath = path.dirname(projectPath);
    const folderName = path.basename(projectPath);

    await fs.ensureDir(parentPath);

    const binary = this.managers.binaryDownload;
    if (!binary) {
      throw new Error('BinaryDownloadManager not available');
    }

    const onOutput = (text, type) => {
      const cleanText = text.toString().replace(/\r\n/g, '\n').trim();
      if (!cleanText) {
        return;
      }

      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('terminal:output', {
            projectId: 'installation',
            text: cleanText,
            type,
          });
        } catch {
          // Ignore send errors.
        }
      }
    };

    onOutput('Creating Laravel project...', 'info');
    onOutput(`$ composer create-project laravel/laravel ${folderName} --prefer-dist`, 'command');

    try {
      await binary.runComposer(
        parentPath,
        `create-project laravel/laravel ${folderName} --prefer-dist --no-interaction`,
        phpVersion,
        onOutput
      );

      onOutput('✓ Laravel files installed successfully!', 'success');
    } catch (error) {
      this.managers.log?.systemError('[installLaravel] Composer error', { error: error.message });
      onOutput(`✗ Composer error: ${error.message}`, 'error');
      throw error;
    }

    try {
      const envExamplePath = path.join(projectPath, '.env.example');
      const envPath = path.join(projectPath, '.env');

      if (await fs.pathExists(envExamplePath) && !await fs.pathExists(envPath)) {
        onOutput('Creating .env file...', 'info');
        await fs.copy(envExamplePath, envPath);
        onOutput('✓ .env file created from .env.example', 'success');
      }
    } catch (error) {
      onOutput(`Warning: Could not create .env file: ${error.message}`, 'warning');
    }

    try {
      const envPath = path.join(projectPath, '.env');
      if (await fs.pathExists(envPath)) {
        let envContent = await fs.readFile(envPath, 'utf-8');

        envContent = envContent.replace(/^APP_NAME=.*/m, `APP_NAME="${projectName}"`);

        const envTld = this.configStore.get('settings.defaultTld', 'test');
        const projectDomain = `${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${envTld}`;
        envContent = envContent.replace(/^APP_URL=.*/m, `APP_URL=http://${projectDomain}`);

        const storedProject = this.configStore.get('projects', []).find((entry) => entry.path === projectPath);
        if (storedProject) {
          const dbName = this.sanitizeDatabaseName(projectName);
          const dbInfo = this.managers.database?.getDatabaseInfo() || {};
          const dbUser = dbInfo.user || 'root';
          const dbPassword = dbInfo.password || '';
          const dbPort = dbInfo.port || 3306;

          envContent = envContent.replace(/^DB_DATABASE=.*/m, `DB_DATABASE=${dbName}`);
          envContent = envContent.replace(/^DB_USERNAME=.*/m, `DB_USERNAME=${dbUser}`);
          envContent = envContent.replace(/^DB_PASSWORD=.*/m, `DB_PASSWORD=${dbPassword}`);
          envContent = envContent.replace(/^DB_PORT=.*/m, `DB_PORT=${dbPort}`);
        }

        await fs.writeFile(envPath, envContent);
        onOutput('✓ .env file configured', 'success');
      }
    } catch (error) {
      onOutput(`Warning: Could not update .env file: ${error.message}`, 'warning');
    }

    try {
      onOutput('Generating application key...', 'info');
      onOutput('$ php artisan key:generate', 'command');

      const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
      const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
      const resourcePath = this.getResourcesPath();
      const phpDir = path.join(resourcePath, 'php', phpVersion, platform);
      const phpPath = path.join(phpDir, phpExe);
      const envPath = platform === 'win'
        ? `${phpDir};${process.env.PATH || ''}`
        : `${phpDir}:${process.env.PATH || ''}`;

      if (await fs.pathExists(phpPath)) {
        await new Promise((resolve) => {
          const proc = spawn(phpPath, ['artisan', 'key:generate'], {
            cwd: projectPath,
            env: { ...process.env, PATH: envPath },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          });
          proc.stdout.on('data', (data) => onOutput(data.toString(), 'stdout'));
          proc.stderr.on('data', (data) => onOutput(data.toString(), 'stderr'));
          proc.on('close', (code) => {
            if (code === 0) {
              onOutput('✓ Application key generated!', 'success');
            } else {
              onOutput(`Warning: key:generate exited with code ${code}`, 'warning');
            }
            resolve();
          });
          proc.on('error', (err) => {
            onOutput(`Warning: ${err.message}`, 'warning');
            resolve();
          });
        });
      }
    } catch (error) {
      onOutput(`Warning: Could not generate app key: ${error.message}`, 'warning');
    }

    if (!useNodejs) {
      onOutput('Skipping npm install (Node.js service not selected)', 'info');
    } else {
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
          onOutput('Installing npm packages...', 'info');
          onOutput('$ npm install', 'command');

          const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
          const resourcePath = this.getResourcesPath();
          const nodeDir = path.join(resourcePath, 'nodejs', nodejsVersion, platform);
          let npmCmd = 'npm';

          if (await fs.pathExists(nodeDir)) {
            npmCmd = process.platform === 'win32'
              ? path.join(nodeDir, 'npm.cmd')
              : path.join(nodeDir, 'bin', 'npm');
          }

          await new Promise((resolve) => {
            const npmProc = spawn(npmCmd, ['install'], {
              cwd: projectPath,
              shell: true,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              env: {
                ...process.env,
                PATH: process.platform === 'win32'
                  ? `${nodeDir};${process.env.PATH}`
                  : `${path.join(nodeDir, 'bin')}:${process.env.PATH}`,
              },
            });

            npmProc.stdout.on('data', (data) => onOutput(data.toString(), 'stdout'));
            npmProc.stderr.on('data', (data) => onOutput(data.toString(), 'stderr'));
            npmProc.on('close', (code) => {
              if (code === 0) {
                onOutput('✓ npm packages installed successfully!', 'success');
              } else {
                onOutput(`npm install finished with code ${code} (non-critical)`, 'warning');
              }
              resolve();
            });
            npmProc.on('error', (err) => {
              onOutput(`npm not available: ${err.message} (non-critical)`, 'warning');
              resolve();
            });
          });
        }
      } catch (error) {
        onOutput(`npm install skipped: ${error.message}`, 'warning');
      }
    }

    onOutput('', 'info');
    onOutput('🎉 Laravel project created successfully!', 'success');
    onOutput(`Project location: ${projectPath}`, 'info');

    return { success: true };
  },
};