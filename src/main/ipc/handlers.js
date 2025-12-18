const { dialog, shell } = require('electron');
const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');

function setupIpcHandlers(ipcMain, managers, mainWindow) {
  const { config, project, php, service, database, ssl, supervisor, log } = managers;

  // ============ PROJECT HANDLERS ============
  ipcMain.handle('projects:getAll', async () => {
    return project.getAllProjects();
  });

  ipcMain.handle('projects:getById', async (event, id) => {
    return project.getProject(id);
  });

  ipcMain.handle('projects:create', async (event, projectConfig) => {
    const newProject = await project.createProject(projectConfig, mainWindow);
    mainWindow?.webContents.send('project:statusChanged', {
      id: newProject.id,
      status: 'created',
    });
    return newProject;
  });

  ipcMain.handle('projects:update', async (event, id, projectConfig) => {
    return project.updateProject(id, projectConfig);
  });

  ipcMain.handle('projects:delete', async (event, id) => {
    return project.deleteProject(id);
  });

  ipcMain.handle('projects:start', async (event, id) => {
    const result = await project.startProject(id);
    mainWindow?.webContents.send('project:statusChanged', {
      id,
      status: 'running',
    });
    return result;
  });

  ipcMain.handle('projects:stop', async (event, id) => {
    const result = await project.stopProject(id);
    mainWindow?.webContents.send('project:statusChanged', {
      id,
      status: 'stopped',
    });
    return result;
  });

  ipcMain.handle('projects:restart', async (event, id) => {
    await project.stopProject(id);
    return project.startProject(id);
  });

  ipcMain.handle('projects:getStatus', async (event, id) => {
    return project.getProjectStatus(id);
  });

  ipcMain.handle('projects:openInEditor', async (event, id, editor = 'vscode') => {
    const projectData = project.getProject(id);
    if (!projectData) throw new Error('Project not found');

    const commands = {
      vscode: `code "${projectData.path}"`,
      phpstorm: `phpstorm "${projectData.path}"`,
      sublime: `subl "${projectData.path}"`,
    };

    const { exec } = require('child_process');
    return new Promise((resolve, reject) => {
      exec(commands[editor] || commands.vscode, (error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
  });

  ipcMain.handle('projects:openInBrowser', async (event, id) => {
    const projectData = project.getProject(id);
    if (!projectData) throw new Error('Project not found');

    const protocol = projectData.ssl ? 'https' : 'http';
    const domain = projectData.domains?.[0] || `localhost:${projectData.port}`;
    await shell.openExternal(`${protocol}://${domain}`);
    return true;
  });

  ipcMain.handle('projects:openFolder', async (event, id) => {
    const projectData = project.getProject(id);
    if (!projectData) throw new Error('Project not found');
    await shell.openPath(projectData.path);
    return true;
  });

  ipcMain.handle('projects:switchWebServer', async (event, id, webServer) => {
    const result = await project.switchWebServer(id, webServer);
    mainWindow?.webContents.send('project:webServerChanged', {
      id,
      webServer,
    });
    return result;
  });

  ipcMain.handle('projects:regenerateVhost', async (event, id) => {
    const projectData = project.getProject(id);
    if (!projectData) throw new Error('Project not found');
    await project.createVirtualHost(projectData);
    return { success: true };
  });

  // ============ PHP HANDLERS ============
  ipcMain.handle('php:getVersions', async () => {
    return php.getAvailableVersions();
  });

  ipcMain.handle('php:getExtensions', async (event, version) => {
    return php.getExtensions(version);
  });

  ipcMain.handle('php:toggleExtension', async (event, version, extension, enabled) => {
    return php.toggleExtension(version, extension, enabled);
  });

  ipcMain.handle('php:runCommand', async (event, projectId, command) => {
    const projectData = project.getProject(projectId);
    if (!projectData) throw new Error('Project not found');
    return php.runCommand(projectData.phpVersion, projectData.path, command);
  });

  // ============ SERVICE HANDLERS ============
  ipcMain.handle('services:getStatus', async () => {
    return service.getAllServicesStatus();
  });

  ipcMain.handle('services:start', async (event, serviceName) => {
    const result = await service.startService(serviceName);
    mainWindow?.webContents.send('service:statusChanged', {
      service: serviceName,
      status: 'running',
    });
    return result;
  });

  ipcMain.handle('services:stop', async (event, serviceName) => {
    const result = await service.stopService(serviceName);
    mainWindow?.webContents.send('service:statusChanged', {
      service: serviceName,
      status: 'stopped',
    });
    return result;
  });

  ipcMain.handle('services:restart', async (event, serviceName) => {
    return service.restartService(serviceName);
  });

  ipcMain.handle('services:startAll', async () => {
    return service.startAllServices();
  });

  ipcMain.handle('services:stopAll', async () => {
    return service.stopAllServices();
  });

  ipcMain.handle('services:getResourceUsage', async () => {
    return service.getResourceUsage();
  });

  // ============ DATABASE HANDLERS ============
  ipcMain.handle('database:getConnections', async () => {
    return database.getConnections();
  });

  ipcMain.handle('database:getDatabases', async () => {
    return database.listDatabases();
  });

  ipcMain.handle('database:createDatabase', async (event, name) => {
    return database.createDatabase(name);
  });

  ipcMain.handle('database:deleteDatabase', async (event, name) => {
    return database.deleteDatabase(name);
  });

  ipcMain.handle('database:importDatabase', async (event, name, filePath) => {
    return database.importDatabase(name, filePath);
  });

  ipcMain.handle('database:exportDatabase', async (event, name, filePath) => {
    return database.exportDatabase(name, filePath);
  });

  ipcMain.handle('database:runQuery', async (event, databaseName, query) => {
    return database.runQuery(databaseName, query);
  });

  ipcMain.handle('database:getPhpMyAdminUrl', async () => {
    return database.getPhpMyAdminUrl();
  });

  ipcMain.handle('database:getActiveDatabaseType', async () => {
    return database.getActiveDatabaseType();
  });

  ipcMain.handle('database:setActiveDatabaseType', async (event, dbType) => {
    return database.setActiveDatabaseType(dbType);
  });

  ipcMain.handle('database:getDatabaseInfo', async () => {
    return database.getDatabaseInfo();
  });

  ipcMain.handle('database:resetCredentials', async (event, user, password) => {
    return database.resetCredentials(user, password);
  });

  // ============ SSL HANDLERS ============
  ipcMain.handle('ssl:getCertificates', async () => {
    return ssl.listCertificates();
  });

  ipcMain.handle('ssl:createCertificate', async (event, domains) => {
    return ssl.createCertificate(domains);
  });

  ipcMain.handle('ssl:deleteCertificate', async (event, domain) => {
    return ssl.deleteCertificate(domain);
  });

  ipcMain.handle('ssl:trustCertificate', async (event, domain) => {
    return ssl.trustCertificate(domain);
  });

  // ============ SUPERVISOR HANDLERS ============
  ipcMain.handle('supervisor:getProcesses', async (event, projectId) => {
    return supervisor.getProcesses(projectId);
  });

  ipcMain.handle('supervisor:addProcess', async (event, projectId, processConfig) => {
    return supervisor.addProcess(projectId, processConfig);
  });

  ipcMain.handle('supervisor:removeProcess', async (event, projectId, processName) => {
    return supervisor.removeProcess(projectId, processName);
  });

  ipcMain.handle('supervisor:startProcess', async (event, projectId, processName) => {
    return supervisor.startProcess(projectId, processName);
  });

  ipcMain.handle('supervisor:stopProcess', async (event, projectId, processName) => {
    return supervisor.stopProcess(projectId, processName);
  });

  ipcMain.handle('supervisor:restartProcess', async (event, projectId, processName) => {
    return supervisor.restartProcess(projectId, processName);
  });

  // ============ LOG HANDLERS ============
  ipcMain.handle('logs:getProjectLogs', async (event, projectId, lines = 100) => {
    return log.getProjectLogs(projectId, lines);
  });

  ipcMain.handle('logs:getServiceLogs', async (event, serviceName, lines = 100) => {
    return log.getServiceLogs(serviceName, lines);
  });

  ipcMain.handle('logs:clearProjectLogs', async (event, projectId) => {
    return log.clearProjectLogs(projectId);
  });

  ipcMain.handle('logs:streamLogs', async (event, projectId) => {
    log.streamLogs(projectId, (entry) => {
      mainWindow?.webContents.send('log:newEntry', { projectId, entry });
    });
    return true;
  });

  // ============ SETTINGS HANDLERS ============
  ipcMain.handle('settings:get', async (event, key) => {
    return config.get(key);
  });

  ipcMain.handle('settings:set', async (event, key, value) => {
    return config.set(key, value);
  });

  ipcMain.handle('settings:getAll', async () => {
    return config.getAll();
  });

  ipcMain.handle('settings:reset', async () => {
    return config.reset();
  });

  // ============ SYSTEM HANDLERS ============
  ipcMain.handle('system:selectDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('system:selectFile', async (event, filters) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('system:openExternal', async (event, url) => {
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('system:getAppVersion', async () => {
    return app.getVersion();
  });

  ipcMain.handle('system:getPlatform', async () => {
    return process.platform;
  });

  ipcMain.handle('system:checkForUpdates', async () => {
    // Auto-updater implementation would go here
    return { updateAvailable: false };
  });

  // ============ TERMINAL HANDLERS ============
  const terminals = new Map();

  ipcMain.handle('terminal:create', async (event, projectId) => {
    const pty = require('node-pty');
    const projectData = project.getProject(projectId);

    const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
    const term = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd: projectData?.path || process.cwd(),
      env: {
        ...process.env,
        ...(projectData?.environment || {}),
      },
    });

    const terminalId = `term-${Date.now()}`;
    terminals.set(terminalId, term);

    term.onData((data) => {
      mainWindow?.webContents.send('terminal:output', { terminalId, data });
    });

    term.onExit(() => {
      terminals.delete(terminalId);
    });

    return terminalId;
  });

  ipcMain.handle('terminal:write', async (event, terminalId, data) => {
    const term = terminals.get(terminalId);
    if (term) term.write(data);
  });

  ipcMain.handle('terminal:resize', async (event, terminalId, cols, rows) => {
    const term = terminals.get(terminalId);
    if (term) term.resize(cols, rows);
  });

  ipcMain.handle('terminal:close', async (event, terminalId) => {
    const term = terminals.get(terminalId);
    if (term) {
      term.kill();
      terminals.delete(terminalId);
    }
  });

  // ============ BINARY DOWNLOAD HANDLERS ============
  const { binaryDownload, webServer } = managers;
  
  if (binaryDownload) {
    ipcMain.handle('binaries:getInstalled', async () => {
      return binaryDownload.getInstalledBinaries();
    });

    ipcMain.handle('binaries:getStatus', async () => {
      const installed = await binaryDownload.getInstalledBinaries();
      
      // Transform to a more detailed status format
      const status = {
        php: {},
        mysql: { installed: installed.mysql },
        mariadb: { installed: installed.mariadb },
        redis: { installed: installed.redis },
        mailpit: { installed: installed.mailpit },
        phpmyadmin: { installed: installed.phpmyadmin },
        nginx: { installed: installed.nginx },
        apache: { installed: installed.apache },
        nodejs: {},
        composer: { installed: installed.composer },
      };

      // Transform PHP versions
      for (const [version, isInstalled] of Object.entries(installed.php)) {
        status.php[version] = { installed: isInstalled };
      }

      // Transform Node.js versions
      for (const [version, isInstalled] of Object.entries(installed.nodejs)) {
        status.nodejs[version] = { installed: isInstalled };
      }

      return status;
    });

    ipcMain.handle('binaries:getDownloadUrls', async () => {
      return binaryDownload.getDownloadUrls();
    });

    ipcMain.handle('binaries:downloadPhp', async (event, version) => {
      return binaryDownload.downloadPhp(version);
    });

    ipcMain.handle('binaries:downloadMysql', async () => {
      return binaryDownload.downloadMysql();
    });

    ipcMain.handle('binaries:downloadMariadb', async () => {
      return binaryDownload.downloadMariadb();
    });

    ipcMain.handle('binaries:downloadRedis', async () => {
      return binaryDownload.downloadRedis();
    });

    ipcMain.handle('binaries:downloadMailpit', async () => {
      return binaryDownload.downloadMailpit();
    });

    ipcMain.handle('binaries:downloadPhpMyAdmin', async () => {
      return binaryDownload.downloadPhpMyAdmin();
    });

    ipcMain.handle('binaries:downloadNginx', async () => {
      return binaryDownload.downloadNginx();
    });

    ipcMain.handle('binaries:downloadApache', async () => {
      return binaryDownload.downloadApache();
    });

    ipcMain.handle('binaries:importApache', async (event, filePath) => {
      return binaryDownload.importApache(filePath);
    });

    ipcMain.handle('binaries:openApacheDownloadPage', async () => {
      const { shell } = require('electron');
      await shell.openExternal('https://www.apachelounge.com/download/');
      return { success: true };
    });

    ipcMain.handle('binaries:downloadNodejs', async (event, version) => {
      return binaryDownload.downloadNodejs(version);
    });

    ipcMain.handle('binaries:downloadComposer', async () => {
      return binaryDownload.downloadComposer();
    });

    ipcMain.handle('binaries:runComposer', async (event, projectPath, command, phpVersion) => {
      return binaryDownload.runComposer(projectPath, command, phpVersion);
    });

    ipcMain.handle('binaries:runNpm', async (event, projectPath, command, nodeVersion) => {
      return binaryDownload.runNpm(projectPath, command, nodeVersion);
    });

    ipcMain.handle('binaries:remove', async (event, type, version) => {
      return binaryDownload.removeBinary(type, version);
    });

    // PHP.ini handlers
    ipcMain.handle('binaries:getPhpIni', async (event, version) => {
      const platform = process.platform === 'win32' ? 'win' : 'mac';
      const phpPath = path.join(binaryDownload.resourcesPath, 'php', version, platform);
      const iniPath = path.join(phpPath, 'php.ini');
      
      if (await fs.pathExists(iniPath)) {
        return await fs.readFile(iniPath, 'utf8');
      }
      return null;
    });

    ipcMain.handle('binaries:savePhpIni', async (event, version, content) => {
      const platform = process.platform === 'win32' ? 'win' : 'mac';
      const phpPath = path.join(binaryDownload.resourcesPath, 'php', version, platform);
      const iniPath = path.join(phpPath, 'php.ini');
      
      await fs.writeFile(iniPath, content, 'utf8');
      return { success: true };
    });

    ipcMain.handle('binaries:resetPhpIni', async (event, version) => {
      const platform = process.platform === 'win32' ? 'win' : 'mac';
      const phpPath = path.join(binaryDownload.resourcesPath, 'php', version, platform);
      
      await binaryDownload.createPhpIni(phpPath, version);
      return { success: true };
    });

    // Listen to download progress and forward to renderer
    binaryDownload.addProgressListener((id, progress) => {
      mainWindow?.webContents.send('binaries:progress', { id, progress });
    });
  }

  // ============ WEB SERVER HANDLERS ============
  if (webServer) {
    ipcMain.handle('webserver:getStatus', async () => {
      return webServer.getStatus();
    });

    ipcMain.handle('webserver:setServerType', async (event, type) => {
      return webServer.setServerType(type);
    });

    ipcMain.handle('webserver:getServerType', async () => {
      return webServer.getServerType();
    });

    ipcMain.handle('webserver:startProject', async (event, project) => {
      return webServer.startProject(project);
    });

    ipcMain.handle('webserver:stopProject', async (event, projectId) => {
      return webServer.stopProject(projectId);
    });

    ipcMain.handle('webserver:reloadConfig', async () => {
      return webServer.reloadConfig();
    });

    ipcMain.handle('webserver:getRunningProjects', async () => {
      return webServer.getRunningProjects();
    });
  }

  // ============ TERMINAL HANDLERS ============
  const runningProcesses = new Map();

  ipcMain.handle('terminal:runCommand', async (event, projectId, command, options = {}) => {
    const { spawn } = require('child_process');
    const path = require('path');
    const { app } = require('electron');
    
    const projectData = project.getProject(projectId);
    if (!projectData && projectId !== 'system' && projectId !== 'terminal') {
      throw new Error('Project not found');
    }

    const cwd = options.cwd || projectData?.path || process.cwd();
    const phpVersion = options.phpVersion || projectData?.phpVersion || '8.4';
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      // Parse command for PHP/Composer handling
      let cmd, args;
      const platform = process.platform === 'win32' ? 'win' : 'mac';
      const resourcePath = config.get('resourcePath') || path.join(app.getPath('userData'), 'resources');
      
      if (command.startsWith('php ') || command === 'php') {
        // Use project's PHP version
        const phpExe = platform === 'win' ? 'php.exe' : 'php';
        cmd = path.join(resourcePath, 'php', phpVersion, platform, phpExe);
        args = command === 'php' ? [] : command.substring(4).split(' ').filter(Boolean);
      } else if (command.startsWith('composer ')) {
        // Use Composer with PHP
        const phpExe = platform === 'win' ? 'php.exe' : 'php';
        cmd = path.join(resourcePath, 'php', phpVersion, platform, phpExe);
        const composerPhar = path.join(resourcePath, 'composer', 'composer.phar');
        args = [composerPhar, ...command.substring(9).split(' ').filter(Boolean)];
      } else if (command.startsWith('npm ') || command.startsWith('npx ')) {
        // Use system npm/npx or installed Node
        if (platform === 'win') {
          cmd = 'cmd.exe';
          args = ['/c', command];
        } else {
          cmd = '/bin/bash';
          args = ['-c', command];
        }
      } else {
        // Generic command
        if (platform === 'win') {
          cmd = 'cmd.exe';
          args = ['/c', command];
        } else {
          cmd = '/bin/bash';
          args = ['-c', command];
        }
      }

      console.log(`Running command: ${cmd} ${args.join(' ')} in ${cwd}`);

      const proc = spawn(cmd, args, {
        cwd,
        env: {
          ...process.env,
          COMPOSER_HOME: path.join(resourcePath, 'composer'),
        },
        shell: false,
        windowsHide: true,
      });

      // Store process reference for potential cancellation
      runningProcesses.set(projectId, proc);

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        stdout += text;
        // Send real-time output to renderer
        mainWindow?.webContents.send('terminal:output', {
          projectId,
          text,
          type: 'stdout',
        });
      });

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        stderr += text;
        mainWindow?.webContents.send('terminal:output', {
          projectId,
          text,
          type: 'stderr',
        });
      });

      proc.on('error', (error) => {
        runningProcesses.delete(projectId);
        reject(error);
      });

      proc.on('close', (code) => {
        runningProcesses.delete(projectId);
        resolve({
          stdout,
          stderr,
          code,
          success: code === 0,
        });
      });
    });
  });

  ipcMain.handle('terminal:cancelCommand', async (event, projectId) => {
    const proc = runningProcesses.get(projectId);
    if (proc) {
      const kill = require('tree-kill');
      kill(proc.pid, 'SIGTERM');
      runningProcesses.delete(projectId);
      return { success: true };
    }
    return { success: false };
  });

  // Resource monitoring interval
  setInterval(async () => {
    try {
      const usage = await service.getResourceUsage();
      mainWindow?.webContents.send('resource:update', usage);
    } catch (error) {
      console.error('Error getting resource usage:', error);
    }
  }, 5000);

  console.log('IPC handlers registered');
}

module.exports = { setupIpcHandlers };
