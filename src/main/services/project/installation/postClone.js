const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  async runPostCloneLaravelSetup(project, mainWindow) {
    const sendOutput = (text, type) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', {
          projectId: 'installation',
          text,
          type,
        });
      }
    };

    const projectPath = project.path;
    const phpVersion = project.phpVersion || '8.4';
    const useNodejs = project.services?.nodejs !== false;
    const nodejsVersion = project.services?.nodejsVersion || '20';
    const binary = this.managers.binaryDownload;

    if (!binary) {
      throw new Error('BinaryDownloadManager not available');
    }

    const composerJsonPath = path.join(projectPath, 'composer.json');
    if (await fs.pathExists(composerJsonPath)) {
      sendOutput('Running composer install...', 'info');
      sendOutput('$ composer install --no-interaction', 'command');

      try {
        await binary.runComposer(projectPath, 'install --no-interaction', phpVersion, (text, type) => sendOutput(text, type));
        sendOutput('Dependencies installed successfully!', 'success');
      } catch (error) {
        sendOutput(`Warning: composer install failed: ${error.message}`, 'warning');
        sendOutput('You may need to run composer install manually.', 'info');
      }
    }

    try {
      const envExamplePath = path.join(projectPath, '.env.example');
      const envPath = path.join(projectPath, '.env');

      if (await fs.pathExists(envExamplePath) && !await fs.pathExists(envPath)) {
        sendOutput('Creating .env file...', 'info');
        await fs.copy(envExamplePath, envPath);
        sendOutput('.env file created from .env.example', 'success');
      }
    } catch (error) {
      sendOutput(`Warning: Could not create .env file: ${error.message}`, 'warning');
    }

    try {
      const envPath = path.join(projectPath, '.env');
      if (await fs.pathExists(envPath)) {
        let envContent = await fs.readFile(envPath, 'utf-8');
        const dbConfig = this.getProjectDatabaseConfig(project);

        envContent = envContent.replace(/^DB_CONNECTION=.*/m, `DB_CONNECTION=${dbConfig.laravelConnection}`);
        envContent = envContent.replace(/^DB_HOST=.*/m, `DB_HOST=${dbConfig.host}`);
        envContent = envContent.replace(/^DB_DATABASE=.*/m, `DB_DATABASE=${dbConfig.database}`);
        envContent = envContent.replace(/^DB_USERNAME=.*/m, `DB_USERNAME=${dbConfig.user}`);
        envContent = envContent.replace(/^DB_PASSWORD=.*/m, `DB_PASSWORD=${dbConfig.password}`);
        envContent = envContent.replace(/^DB_PORT=.*/m, `DB_PORT=${dbConfig.port}`);
        envContent = envContent.replace(/^APP_URL=.*/m, `APP_URL=http://${project.domain}`);

        await fs.writeFile(envPath, envContent);
        sendOutput('.env file configured', 'success');
      }
    } catch (error) {
      sendOutput(`Warning: Could not update .env file: ${error.message}`, 'warning');
    }

    try {
      sendOutput('Generating application key...', 'info');
      sendOutput('$ php artisan key:generate', 'command');

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
          proc.stdout.on('data', (data) => sendOutput(data.toString(), 'stdout'));
          proc.stderr.on('data', (data) => sendOutput(data.toString(), 'stderr'));
          proc.on('close', (code) => {
            if (code === 0) {
              sendOutput('Application key generated!', 'success');
            }
            resolve();
          });
          proc.on('error', () => resolve());
        });
      }
    } catch (error) {
      sendOutput(`Warning: Could not generate app key: ${error.message}`, 'warning');
    }

    if (useNodejs) {
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
          sendOutput('Installing npm packages...', 'info');
          sendOutput('$ npm install', 'command');

          const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
          const resourcePath = this.getResourcesPath();
          const nodeDir = path.join(resourcePath, 'nodejs', nodejsVersion, platform);
          let npmCmd = 'npm';

          if (await fs.pathExists(nodeDir)) {
            npmCmd = process.platform === 'win32' ? path.join(nodeDir, 'npm.cmd') : path.join(nodeDir, 'bin', 'npm');
          }

          await new Promise((resolve) => {
            const npmProc = spawn(npmCmd, ['install'], {
              cwd: projectPath,
              stdio: ['ignore', 'pipe', 'pipe'],
              windowsHide: true,
              env: {
                ...process.env,
                PATH: process.platform === 'win32'
                  ? `${nodeDir};${process.env.PATH}`
                  : `${path.join(nodeDir, 'bin')}:${process.env.PATH}`,
              },
            });

            npmProc.stdout.on('data', (data) => sendOutput(data.toString(), 'stdout'));
            npmProc.stderr.on('data', (data) => sendOutput(data.toString(), 'stderr'));
            npmProc.on('close', (code) => {
              if (code === 0) {
                sendOutput('npm packages installed successfully!', 'success');
              } else {
                sendOutput(`npm install finished with code ${code} (non-critical)`, 'warning');
              }
              resolve();
            });
            npmProc.on('error', (err) => {
              sendOutput(`npm not available: ${err.message} (non-critical)`, 'warning');
              resolve();
            });
          });
        }
      } catch (error) {
        sendOutput(`npm install skipped: ${error.message}`, 'warning');
      }
    }
  },

  async runPostCloneNodeSetup(project, mainWindow) {
    const sendOutput = (text, type) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', {
          projectId: 'installation',
          text,
          type,
        });
      }
    };

    const projectPath = project.path;
    const nodejsVersion = project.services?.nodejsVersion || '20';
    const packageJsonPath = path.join(projectPath, 'package.json');

    if (!await fs.pathExists(packageJsonPath)) {
      sendOutput('No package.json found. Skipping npm install.', 'warning');
      return;
    }

    try {
      sendOutput('Installing npm packages...', 'info');
      sendOutput('$ npm install', 'command');

      const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
      const resourcePath = this.getResourcesPath();
      const nodeDir = path.join(resourcePath, 'nodejs', nodejsVersion, platform);
      let npmCmd = 'npm';

      if (await fs.pathExists(nodeDir)) {
        npmCmd = process.platform === 'win32' ? path.join(nodeDir, 'npm.cmd') : path.join(nodeDir, 'bin', 'npm');
      }

      await new Promise((resolve) => {
        const npmProc = spawn(npmCmd, ['install'], {
          cwd: projectPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
          env: {
            ...process.env,
            PATH: process.platform === 'win32'
              ? `${nodeDir};${process.env.PATH}`
              : `${path.join(nodeDir, 'bin')}:${process.env.PATH}`,
          },
        });

        npmProc.stdout.on('data', (data) => sendOutput(data.toString(), 'stdout'));
        npmProc.stderr.on('data', (data) => sendOutput(data.toString(), 'stderr'));
        npmProc.on('close', (code) => {
          if (code === 0) {
            sendOutput('npm packages installed successfully!', 'success');
          } else {
            sendOutput(`npm install finished with code ${code} (non-critical)`, 'warning');
          }
          resolve();
        });
        npmProc.on('error', (err) => {
          sendOutput(`npm not available: ${err.message} (non-critical)`, 'warning');
          resolve();
        });
      });
    } catch (error) {
      sendOutput(`npm install skipped: ${error.message}`, 'warning');
    }
  },
};