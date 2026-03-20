const fs = require('fs-extra');
const { spawn } = require('child_process');
const path = require('path');

module.exports = {
  async runInstallation(project, mainWindow) {
    const divider = '-'.repeat(64);
    const sendOutput = (text, type) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', {
          projectId: 'installation',
          text,
          type,
        });
      }
    };

    sendOutput(`Starting ${project.cloneConfig ? 'repository clone' : project.type} installation at ${project.path}...`, 'info');

    try {
      if (project.cloneConfig && project.cloneConfig.repositoryUrl) {
        sendOutput(divider, 'info');
        sendOutput('Cloning repository...', 'info');
        sendOutput(`$ git clone ${project.cloneConfig.repositoryUrl}`, 'command');
        sendOutput(divider, 'info');

        const gitManager = this.managers.git;
        if (!gitManager) {
          throw new Error('Git manager not available. Please install Git first.');
        }

        const cloneResult = await gitManager.cloneRepository(project.cloneConfig.repositoryUrl, project.path, {
          authType: project.cloneConfig.authType,
          accessToken: project.cloneConfig.accessToken,
          onProgress: (progress) => {
            if (progress.phase) {
              sendOutput(`   ${progress.phase}: ${progress.percent || 0}%`, 'info');
            }
          },
        });

        if (!cloneResult.success) {
          throw new Error(cloneResult.error || 'Git clone failed');
        }

        sendOutput('Repository cloned successfully!', 'success');
        sendOutput('', 'info');

        if (project.type === 'laravel') {
          await this.runPostCloneLaravelSetup(project, mainWindow);
        } else if (project.type === 'nodejs') {
          await this.runPostCloneNodeSetup(project, mainWindow);
        }
      } else if (project.type === 'laravel') {
        if (await fs.pathExists(project.path)) {
          const files = await fs.readdir(project.path);
          if (files.length > 0) {
            const laravelIndicators = ['artisan', 'composer.json', 'app', 'bootstrap', 'config'];
            const hasLaravelFiles = files.some((file) => laravelIndicators.includes(file.toLowerCase()));

            if (hasLaravelFiles) {
              sendOutput(`Warning: Directory ${project.path} already contains a Laravel project. Skipping installation.`, 'warning');
              sendOutput('If you want a fresh installation, please choose an empty directory.', 'info');
              project.installError = 'Directory not empty';
              project.installing = false;
              this.updateProjectInStore(project);
              sendOutput('', 'complete');
              return;
            }

            sendOutput(`Cleaning up partial installation at ${project.path}...`, 'info');
            try {
              await fs.remove(project.path);
            } catch (cleanErr) {
              sendOutput(`Warning: Could not clean up partial files: ${cleanErr.message}`, 'warning');
            }
          }
        }

        await this.installLaravel(project, mainWindow);
      } else if (project.type === 'wordpress') {
        await this.installWordPress(project, mainWindow);
      } else if (project.type === 'symfony') {
        await this.installSymfony(project, mainWindow);
      } else if (project.type === 'nodejs') {
        await this.installNodeFramework(project, mainWindow);
      }

      try {
        await this.createVirtualHost(project);
        sendOutput('Virtual host configured', 'success');
      } catch (error) {
        sendOutput(`Warning: Could not create virtual host: ${error.message}`, 'warning');
      }

      if (project.type === 'laravel') {
        try {
          sendOutput('Optimizing application...', 'info');
          sendOutput('$ php artisan optimize', 'command');

          const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
          const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
          const resourcePath = this.getResourcesPath();
          const phpDir = path.join(resourcePath, 'php', project.phpVersion, platform);
          const phpPath = path.join(phpDir, phpExe);
          const envPath = platform === 'win'
            ? `${phpDir};${process.env.PATH || ''}`
            : `${phpDir}:${process.env.PATH || ''}`;

          if (await fs.pathExists(phpPath)) {
            await new Promise((resolve) => {
              const proc = spawn(phpPath, ['artisan', 'optimize'], {
                cwd: project.path,
                env: { ...process.env, PATH: envPath },
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
              });
              proc.stdout.on('data', (data) => sendOutput(data.toString(), 'stdout'));
              proc.stderr.on('data', (data) => sendOutput(data.toString(), 'stderr'));
              proc.on('close', (code) => {
                if (code === 0) {
                  sendOutput('Application optimized!', 'success');
                }
                resolve();
              });
              proc.on('error', () => resolve());
            });
          }
        } catch (error) {
          sendOutput(`Warning: Could not optimize application: ${error.message}`, 'warning');
        }
      }

      project.installing = false;
      this.updateProjectInStore(project);

      sendOutput('', 'info');
      sendOutput(divider, 'info');
      sendOutput('Thank you for using DevBox Pro!', 'success');
      sendOutput('', 'info');
      sendOutput(`Your project "${project.name}" is now available at:`, 'info');
      sendOutput(`   HTTP:  http://${project.domain}`, 'info');
      if (project.ssl) {
        sendOutput(`   HTTPS: https://${project.domain}`, 'info');
      }
      sendOutput('', 'info');
      sendOutput('Starting your project now...', 'info');
      sendOutput(divider, 'info');

      try {
        await this.startProject(project.id);
        sendOutput('Project started successfully!', 'success');
      } catch (startError) {
        sendOutput(`Warning: Could not auto-start project: ${startError.message}`, 'warning');
      }

      sendOutput('', 'complete');

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('installation:complete', {
          projectId: project.id,
          domain: project.domain,
          ssl: project.ssl,
        });
      }
    } catch (error) {
      this.managers.log?.systemError('Failed to install framework', { project: project.name, error: error.message });
      project.installError = error.message;
      project.installing = false;
      project.needsManualSetup = true;
      this.updateProjectInStore(project);

      sendOutput(`Installation failed: ${error.message}`, 'error');
      sendOutput('', 'info');
      sendOutput(divider, 'info');
      sendOutput('You can fix this manually:', 'info');
      sendOutput('   1. Click "I\'ll Fix It Manually" to go to your project', 'info');
      sendOutput('   2. Open a terminal in your project folder', 'info');
      sendOutput('   3. Run: composer install', 'info');
      sendOutput('   4. Run: php artisan key:generate (for Laravel)', 'info');
      sendOutput(divider, 'info');
      sendOutput('', 'complete');
    }
  },
};