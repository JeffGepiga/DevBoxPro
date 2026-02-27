
const { dialog, shell } = require('electron');
const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');


// Import centralized service configuration
const {
  SERVICE_VERSIONS,
  VERSION_PORT_OFFSETS,
  DEFAULT_PORTS,
  SERVICE_INFO,
  getServicePort,
  getDefaultVersion
} = require('../../shared/serviceConfig');


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

  ipcMain.handle('projects:readEnv', async (event, id) => {
    return project.readEnvFile(id);
  });

  ipcMain.handle('projects:delete', async (event, id, deleteFiles) => {
    return project.deleteProject(id, deleteFiles);
  });

  ipcMain.handle('projects:scanUnregistered', async () => {
    return project.scanUnregisteredProjects();
  });

  ipcMain.handle('projects:registerExisting', async (event, config) => {
    return project.registerExistingProject(config);
  });

  ipcMain.handle('projects:detectType', async (event, folderPath) => {
    return project.detectProjectTypeFromPath(folderPath);
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

    const editorConfigs = {
      vscode: { command: 'code', name: 'Visual Studio Code' },
      cursor: { command: 'cursor', name: 'Cursor' },
      antigravity: { command: 'antigravity', name: 'Antigravity' },
      zed: { command: 'zed', name: 'Zed' },
      phpstorm: { command: 'phpstorm', name: 'PhpStorm' },
      webstorm: { command: 'webstorm', name: 'WebStorm' },
      intellij: { command: 'idea', name: 'IntelliJ IDEA' },
      rider: { command: 'rider', name: 'Rider' },
      sublime: { command: 'subl', name: 'Sublime Text' },
      notepadpp: { command: 'notepad++', name: 'Notepad++' },
      nova: { command: 'nova', name: 'Nova' },
      atom: { command: 'atom', name: 'Atom' },
    };

    let editorConfig;

    // Handle custom editor
    if (editor === 'custom') {
      const customCommand = config.get('settings.customEditorCommand');
      if (!customCommand || customCommand.trim() === '') {
        throw new Error('Custom editor command not configured. Please set a custom editor command in Settings.');
      }
      editorConfig = { command: customCommand.trim(), name: 'Custom Editor' };
    } else {
      editorConfig = editorConfigs[editor] || editorConfigs.vscode;
    }

    const { spawn } = require('child_process');
    const { commandExists } = require('../utils/SpawnUtils');

    // Check if the editor command is available (uses spawn, no CMD window)
    if (!commandExists(editorConfig.command)) {
      throw new Error(`${editorConfig.name} is not installed or not in your system PATH. Please install ${editorConfig.name} or choose a different editor in Settings.`);
    }

    // Spawn the editor directly
    return new Promise((resolve, reject) => {
      try {
        // Clear Electron's ICU environment variables to prevent "Invalid file descriptor to ICU data" errors
        const cleanEnv = { ...process.env };
        delete cleanEnv.ICU_DATA;
        delete cleanEnv.ELECTRON_RUN_AS_NODE;

        // On Windows, 'code' is actually 'code.cmd' batch script, so we need shell: true
        // Combined with windowsHide: true, this prevents the CMD window flash
        const child = spawn(editorConfig.command, [projectData.path], {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
          env: cleanEnv,
          shell: process.platform === 'win32', // Required on Windows for .cmd scripts like 'code'
        });
        child.unref();

        // Small delay to ensure process started
        setTimeout(() => resolve(true), 100);
      } catch (error) {
        reject(error);
      }
    });
  });

  ipcMain.handle('projects:openInBrowser', async (event, id) => {
    const projectData = project.getProject(id);
    if (!projectData) throw new Error('Project not found');

    const webServer = projectData.webServer || 'nginx';

    // Get dynamic ports from service manager for the project's web server
    // With first-come-first-served, either server could have 80/443 or 8081/8444
    const ports = service?.getServicePorts(webServer);

    const httpPort = ports?.httpPort || 80;
    const sslPort = ports?.sslPort || 443;


    // Build URL with appropriate port
    let url;
    if (projectData.ssl) {
      const portSuffix = sslPort === 443 ? '' : `:${sslPort}`;
      url = `https://${projectData.domain}${portSuffix}`;
    } else {
      const portSuffix = httpPort === 80 ? '' : `:${httpPort}`;
      url = `http://${projectData.domain}${portSuffix}`;
    }

    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('projects:openFolder', async (event, id) => {
    const projectData = project.getProject(id);
    if (!projectData) throw new Error('Project not found');
    await shell.openPath(projectData.path);
    return true;
  });

  ipcMain.handle('projects:exportConfig', async (event, id) => {
    return project.exportProjectConfig(id, mainWindow);
  });

  ipcMain.handle('projects:move', async (event, id, newPath) => {
    return project.moveProject(id, newPath);
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

  // Project service version handlers
  ipcMain.handle('projects:getServiceVersions', async (event, id) => {
    return project.getProjectServiceVersions(id);
  });

  ipcMain.handle('projects:updateServiceVersions', async (event, id, versions) => {
    return project.updateProjectServiceVersions(id, versions);
  });

  ipcMain.handle('projects:checkCompatibility', async (event, config) => {
    return project.checkCompatibility(config);
  });

  ipcMain.handle('projects:getCompatibilityRules', async () => {
    return project.getCompatibilityRules();
  });

  // ============ COMPATIBILITY HANDLERS ============
  ipcMain.handle('compatibility:checkForUpdates', async () => {
    return project.checkCompatibilityUpdates();
  });

  ipcMain.handle('compatibility:applyUpdates', async () => {
    return project.applyCompatibilityUpdates();
  });

  ipcMain.handle('compatibility:getConfigInfo', async () => {
    return project.getCompatibilityConfigInfo();
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

  ipcMain.handle('php:runArtisan', async (event, projectId, artisanCommand) => {
    const projectData = project.getProject(projectId);
    if (!projectData) throw new Error('Project not found');
    return php.runArtisan(projectData.phpVersion, projectData.path, artisanCommand);
  });

  // ============ SERVICE HANDLERS ============
  ipcMain.handle('services:getStatus', async () => {
    return service.getAllServicesStatus();
  });

  ipcMain.handle('services:start', async (event, serviceName, version = null) => {
    const result = await service.startService(serviceName, version);
    mainWindow?.webContents.send('service:statusChanged', {
      service: serviceName,
      version,
      status: 'running',
    });
    return result;
  });

  ipcMain.handle('services:stop', async (event, serviceName, version = null) => {
    const result = await service.stopService(serviceName, version);
    mainWindow?.webContents.send('service:statusChanged', {
      service: serviceName,
      version,
      status: 'stopped',
    });
    return result;
  });

  ipcMain.handle('services:restart', async (event, serviceName, version = null) => {
    return service.restartService(serviceName, version);
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

  // Get actual web server ports for a specific web server type
  ipcMain.handle('services:getWebServerPorts', async (event, webServerType) => {
    const ports = service?.getServicePorts(webServerType);
    return ports || { httpPort: 80, sslPort: 443 };
  });

  // Get actual network access port for a specific project
  // This considers per-project port 80 ownership for network access
  ipcMain.handle('services:getProjectNetworkPort', async (event, projectId) => {
    const projectData = project.getProject(projectId);
    if (!projectData) {
      return { httpPort: 80, sslPort: 443 };
    }

    const webServer = projectData.webServer || 'nginx';
    const webServerPorts = service?.getServicePorts(webServer) || { httpPort: 80, sslPort: 443 };

    // Check if this project owns port 80 for network access
    if (projectData.networkAccess) {
      if (project.networkPort80Owner === projectId) {
        // This project owns port 80
        return { httpPort: 80, sslPort: webServerPorts.sslPort };
      } else if (project.networkPort80Owner !== null) {
        // Another project owns port 80, use this project's unique port
        return { httpPort: projectData.port || webServerPorts.httpPort, sslPort: webServerPorts.sslPort };
      }
    }

    // No network access or first project, return web server ports
    return webServerPorts;
  });

  // Get running versions for a service (or all services if no name provided)
  ipcMain.handle('services:getRunningVersions', async (event, serviceName) => {
    if (serviceName) {
      const versions = service.getRunningVersions(serviceName);
      // Convert Map to object for IPC
      const result = {};
      for (const [version, info] of versions) {
        result[version] = info;
      }
      return result;
    } else {
      // Return all running versions for all services
      const allVersions = service.getAllRunningVersions();
      const result = {};
      for (const [svcName, versions] of allVersions) {
        result[svcName] = [];
        for (const [version, info] of versions) {
          result[svcName].push(version);
        }
      }
      return result;
    }
  });

  // Check if a specific version is running
  ipcMain.handle('services:isVersionRunning', async (event, serviceName, version) => {
    return service.isVersionRunning(serviceName, version);
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

  ipcMain.handle('database:importDatabase', async (event, name, filePath, mode) => {
    const progressCallback = (progress) => {
      mainWindow?.webContents.send('database:importProgress', progress);
    };
    return database.importDatabase(name, filePath, progressCallback, mode);
  });

  ipcMain.handle('database:exportDatabase', async (event, name, filePath) => {
    const progressCallback = (progress) => {
      mainWindow?.webContents.send('database:exportProgress', progress);
    };
    return database.exportDatabase(name, filePath, progressCallback);
  });

  ipcMain.handle('database:runQuery', async (event, databaseName, query) => {
    return database.runQuery(databaseName, query);
  });

  ipcMain.handle('database:getPhpMyAdminUrl', async (event, dbType, version) => {
    return database.getPhpMyAdminUrl(dbType, version);
  });

  ipcMain.handle('database:getActiveDatabaseType', async () => {
    return database.getActiveDatabaseType();
  });

  ipcMain.handle('database:setActiveDatabaseType', async (event, dbType, version) => {
    return database.setActiveDatabaseType(dbType, version);
  });

  ipcMain.handle('database:getDatabaseInfo', async () => {
    return database.getDatabaseInfo();
  });

  ipcMain.handle('database:resetCredentials', async (event, user, password) => {
    return database.resetCredentials(user, password);
  });

  // Sync credentials to all initialized database versions (MySQL + MariaDB)
  // Called when user changes credentials in Settings
  ipcMain.handle('database:syncCredentialsToAllVersions', async (event, newUser, newPassword, oldPassword) => {
    return service.syncCredentialsToAllVersions(newUser, newPassword, oldPassword);
  });

  // Cancel a running import/export operation
  ipcMain.handle('database:cancelOperation', async (event, operationId) => {
    return database.cancelOperation(operationId);
  });

  // Get list of running database operations
  ipcMain.handle('database:getRunningOperations', async () => {
    return database.getRunningOperations();
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

  // Trust the Root CA certificate (for browser to trust all DevBox certificates)
  ipcMain.handle('ssl:trustRootCA', async () => {
    return ssl.promptTrustRootCA();
  });

  // Get Root CA path for manual trust instructions
  ipcMain.handle('ssl:getRootCAPath', async () => {
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    return path.join(dataPath, 'ssl', 'ca', 'rootCA.pem');
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

  ipcMain.handle('supervisor:getWorkerLogs', async (event, projectId, processName, lines) => {
    return supervisor.getWorkerLogs(projectId, processName, lines);
  });

  ipcMain.handle('supervisor:clearWorkerLogs', async (event, projectId, processName) => {
    return supervisor.clearWorkerLogs(projectId, processName);
  });

  ipcMain.handle('supervisor:getAllWorkerLogs', async (event, projectId, lines) => {
    return supervisor.getAllWorkerLogsForProject(projectId, lines);
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

  ipcMain.handle('logs:clearServiceLogs', async (event, serviceName) => {
    return log.clearServiceLogs(serviceName);
  });

  ipcMain.handle('logs:streamLogs', async (event, projectId) => {
    log.streamLogs(projectId, (entry) => {
      mainWindow?.webContents.send('log:newEntry', { projectId, entry });
    });
    return true;
  });

  // System logs - for critical errors users can export
  ipcMain.handle('logs:getSystemLogs', async (event, lines = 100) => {
    return log.getSystemLogs(lines);
  });

  ipcMain.handle('logs:clearSystemLogs', async () => {
    return log.clearSystemLogs();
  });

  // ============ SETTINGS HANDLERS ============
  ipcMain.handle('settings:get', async (event, key) => {
    return config.get(key);
  });

  ipcMain.handle('settings:set', async (event, key, value) => {
    const result = config.set(key, value);

    // Handle launch on system startup setting
    if (key === 'settings.autoStartOnLaunch') {
      try {
        app.setLoginItemSettings({
          openAtLogin: value === true,
          // On macOS, we can hide the app window on startup (optional)
          // openAsHidden: process.platform === 'darwin' ? false : undefined,
        });
      } catch (err) {
        managers.log?.systemError('Failed to set login item settings', { error: err.message });
      }
    }

    return result;
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

  ipcMain.handle('system:saveFile', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePath;
  });

  ipcMain.handle('system:openExternal', async (event, url) => {
    if (!url) return false;
    await shell.openExternal(url);
    return true;
  });

  ipcMain.handle('system:openPath', async (event, folderPath) => {
    // shell.openPath returns an error string if it fails, empty string on success
    const error = await shell.openPath(folderPath);
    if (error) {
      throw new Error(error);
    }
    return true;
  });

  ipcMain.handle('system:getAppDataPath', async () => {
    return app.getPath('userData');
  });

  ipcMain.handle('system:getAppVersion', async () => {
    return app.getVersion();
  });

  ipcMain.handle('system:getPlatform', async () => {
    return process.platform;
  });

  ipcMain.handle('system:getLocalIpAddresses', async () => {
    if (!managers.webServer) return [];
    return managers.webServer.getLocalIpAddresses();
  });

  // ============ UPDATE HANDLERS ============
  ipcMain.handle('update:checkForUpdates', async () => {
    if (!managers.update) {
      return { success: false, error: 'Update manager not initialized' };
    }
    return managers.update.checkForUpdates();
  });

  ipcMain.handle('update:downloadUpdate', async () => {
    if (!managers.update) {
      return { success: false, error: 'Update manager not initialized' };
    }
    return managers.update.downloadUpdate();
  });

  ipcMain.handle('update:quitAndInstall', async () => {
    if (!managers.update) {
      return { success: false, error: 'Update manager not initialized' };
    }
    managers.update.quitAndInstall();
    return { success: true };
  });

  ipcMain.handle('update:getStatus', async () => {
    if (!managers.update) {
      return { success: false, error: 'Update manager not initialized' };
    }
    return managers.update.getStatus();
  });

  // Keep legacy handler for backward compatibility
  ipcMain.handle('system:checkForUpdates', async () => {
    if (!managers.update) {
      return { updateAvailable: false };
    }
    const result = await managers.update.checkForUpdates();
    return { updateAvailable: result.updateAvailable || false };
  });

  ipcMain.handle('system:clearAllData', async (event, deleteProjectFiles = false) => {
    const fs = require('fs-extra');

    try {
      // Get all projects first if we need to delete their files
      const projects = config.get('projects', []);

      // Force kill all processes FIRST on Windows before trying graceful stop
      // This prevents errors from trying to read config files during graceful shutdown
      if (process.platform === 'win32') {
        const { killProcessByName, killProcessesByPath } = require('../utils/SpawnUtils');
        // Kill DevBox-specific processes globally
        const processNames = ['php-cgi.exe', 'nginx.exe', 'httpd.exe', 'mysqld.exe', 'mariadbd.exe', 'redis-server.exe', 'mailpit.exe'];
        for (const procName of processNames) {
          try {
            await killProcessByName(procName, true);
          } catch (e) {
            // Ignore errors - process might not be running
          }
        }

        // Kill PHP and Node processes from our path only
        const userDataPath = app.getPath('userData');
        try {
          await killProcessesByPath('php.exe', userDataPath);
        } catch (e) { }
        try {
          await killProcessesByPath('node.exe', userDataPath);
        } catch (e) { }

        // Wait a moment for processes to terminate
        await new Promise(resolve => setTimeout(resolve, 1000));
      }

      // Now clear the service manager's internal state (without trying to gracefully stop)
      if (service) {
        try {
          // Just clear the internal tracking - processes are already force-killed
          service.processes?.clear();
          for (const [serviceName, versions] of service.runningVersions || []) {
            versions.clear();
          }
          for (const [serviceName, status] of service.serviceStatus || []) {
            status.status = 'stopped';
            status.pid = null;
            status.startedAt = null;
            status.version = null;
          }
        } catch (e) {
          managers.log?.systemError('Error clearing service state', { error: e.message });
        }
      }

      // Clear project manager state
      if (project) {
        try {
          project.runningProjects?.clear();
        } catch (e) {
          managers.log?.systemError('Error clearing project state', { error: e.message });
        }
      }

      // Delete project files if requested
      if (deleteProjectFiles) {
        for (const proj of projects) {
          if (proj.path && await fs.pathExists(proj.path)) {
            try {
              await fs.remove(proj.path);
              // Deleted project files
            } catch (error) {
              managers.log?.systemError('Failed to delete project files', { path: proj.path, error: error.message });
            }
          }
        }
      }

      // Clear ALL resources (binaries, configs, everything)
      const resourcesPath = path.join(app.getPath('userData'), 'resources');
      if (await fs.pathExists(resourcesPath)) {
        try {
          // Remove the entire resources directory
          await fs.remove(resourcesPath);
          // Cleared all resources
        } catch (e) {
          managers.log?.systemError('Error clearing resources directory', { error: e.message });
          // If we can't delete the whole thing, try to delete subdirectories
          const subdirs = ['php', 'mysql', 'mariadb', 'redis', 'nginx', 'apache', 'nodejs', 'mailpit', 'phpmyadmin', 'composer', 'ssl', 'cli', 'postgresql', 'python', 'mongodb', 'sqlite', 'minio', 'memcached'];
          for (const subdir of subdirs) {
            try {
              const subdirPath = path.join(resourcesPath, subdir);
              if (await fs.pathExists(subdirPath)) {
                await fs.remove(subdirPath);
                // Cleared subdirectory
              }
            } catch (err) {
              managers.log?.systemError(`Error clearing ${subdir}`, { error: err.message });
            }
          }
        }
      }

      // Clear CLI directory
      const cliPath = path.join(app.getPath('userData'), 'cli');
      if (await fs.pathExists(cliPath)) {
        try {
          await fs.remove(cliPath);
          // Cleared CLI directory
        } catch (e) {
          managers.log?.systemError('Error clearing CLI directory', { error: e.message });
        }
      }

      // Clear data directory (database files, web server configs, SSL certs, logs)
      const dataPath = path.join(app.getPath('userData'), 'data');
      if (await fs.pathExists(dataPath)) {
        try {
          await fs.remove(dataPath);
          // Cleared data directory including database files
        } catch (e) {
          managers.log?.systemError('Error clearing data directory', { error: e.message });
          // If we can't delete the whole thing, try to delete subdirectories
          const subdirs = ['mysql', 'mariadb', 'nginx', 'apache', 'ssl', 'logs', 'postgresql', 'mongodb', 'memcached', 'minio'];
          for (const subdir of subdirs) {
            try {
              const subdirPath = path.join(dataPath, subdir);
              if (await fs.pathExists(subdirPath)) {
                await fs.remove(subdirPath);
              }
            } catch (err) {
              managers.log?.systemError(`Error clearing data/${subdir}`, { error: err.message });
            }
          }
        }
      }

      // Clear cached binary config
      const cachedConfigPath = path.join(app.getPath('userData'), 'binaries-config.json');
      if (await fs.pathExists(cachedConfigPath)) {
        try {
          await fs.remove(cachedConfigPath);
          // Cleared cached binary config
        } catch (e) {
          managers.log?.systemError('Error clearing cached binary config', { error: e.message });
        }
      }

      // Clear all configuration
      config.set('projects', []);
      config.delete('databases');
      config.delete('services');
      config.delete('settings.cliAlias');

      // Keep some basic settings but reset others
      const currentSettings = config.get('settings', {});
      config.set('settings', {
        defaultProjectsPath: currentSettings.defaultProjectsPath, // Keep this
        theme: currentSettings.theme, // Keep theme preference
      });

      return {
        success: true,
        message: deleteProjectFiles
          ? 'All data, binaries, and project files have been cleared. Please restart the application.'
          : 'All data and binaries have been cleared. Project files were preserved. Please restart the application.',
        requiresRestart: true
      };
    } catch (error) {
      managers.log?.systemError('Error clearing all data', { error: error.message });
      throw new Error(`Failed to clear data: ${error.message}`);
    }
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
  // Note: binaryDownload may not be initialized immediately, access via managers object

  ipcMain.handle('binaries:getInstalled', async () => {
    if (!managers.binaryDownload) return {};
    return managers.binaryDownload.getInstalledBinaries();
  });

  ipcMain.handle('binaries:getActiveDownloads', async () => {
    if (!managers.binaryDownload) return {};
    return managers.binaryDownload.getActiveDownloads();
  });

  // Check for binary updates from remote GitHub config
  ipcMain.handle('binaries:checkForUpdates', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized yet');
    return managers.binaryDownload.checkForUpdates();
  });

  // Apply updates from remote config
  ipcMain.handle('binaries:applyUpdates', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized yet');
    return managers.binaryDownload.applyUpdates();
  });

  ipcMain.handle('binaries:getStatus', async () => {
    // During Playwright tests, stub installed binaries so project creation form renders Next button
    if (process.env.PLAYWRIGHT_TEST === 'true') {
      return {
        php: { '8.2': { installed: true, version: '8.2.0' } },
        mysql: { '8.0': { installed: true, version: '8.0.32' } },
        mariadb: {},
        redis: {},
        mailpit: { installed: true },
        phpmyadmin: { installed: true },
        nginx: { '1.24': { installed: true, version: '1.24.0' } },
        apache: {},
        nodejs: {},
        composer: { installed: true }
      };
    }

    if (!managers.binaryDownload) return { php: {}, mysql: {}, mariadb: {}, redis: {}, nginx: {}, apache: {}, nodejs: {}, mailpit: false, phpmyadmin: false, composer: false };
    const installed = await managers.binaryDownload.getInstalledBinaries();

    // Transform to a more detailed status format for versioned services
    const status = {
      php: {},
      mysql: {},       // Now versioned
      mariadb: {},     // Now versioned
      redis: {},       // Now versioned
      mailpit: { installed: installed.mailpit },
      phpmyadmin: { installed: installed.phpmyadmin },
      nginx: {},       // Now versioned
      apache: {},      // Now versioned
      nodejs: {},
      composer: { installed: installed.composer },
      postgresql: {},
      python: {},
      mongodb: {},
      sqlite: { installed: !!installed.sqlite },
      minio: { installed: !!installed.minio },
      memcached: {},
    };

    // Transform PHP versions
    for (const [version, isInstalled] of Object.entries(installed.php || {})) {
      status.php[version] = { installed: isInstalled };
    }

    // Transform Node.js versions
    for (const [version, isInstalled] of Object.entries(installed.nodejs || {})) {
      status.nodejs[version] = { installed: isInstalled };
    }

    // Transform MySQL versions
    for (const [version, isInstalled] of Object.entries(installed.mysql || {})) {
      status.mysql[version] = { installed: isInstalled };
    }

    // Transform MariaDB versions
    for (const [version, isInstalled] of Object.entries(installed.mariadb || {})) {
      status.mariadb[version] = { installed: isInstalled };
    }

    // Transform Redis versions
    for (const [version, isInstalled] of Object.entries(installed.redis || {})) {
      status.redis[version] = { installed: isInstalled };
    }

    // Transform Nginx versions
    for (const [version, isInstalled] of Object.entries(installed.nginx || {})) {
      status.nginx[version] = { installed: isInstalled };
    }

    // Transform Apache versions
    for (const [version, isInstalled] of Object.entries(installed.apache || {})) {
      status.apache[version] = { installed: isInstalled };
    }

    // Transform PostgreSQL versions
    for (const [version, isInstalled] of Object.entries(installed.postgresql || {})) {
      status.postgresql[version] = { installed: isInstalled };
    }

    // Transform Python versions
    for (const [version, isInstalled] of Object.entries(installed.python || {})) {
      status.python[version] = { installed: isInstalled };
    }

    // Transform MongoDB versions
    for (const [version, isInstalled] of Object.entries(installed.mongodb || {})) {
      status.mongodb[version] = { installed: isInstalled };
    }

    // Transform Memcached versions
    for (const [version, isInstalled] of Object.entries(installed.memcached || {})) {
      status.memcached[version] = { installed: isInstalled };
    }

    return status;
  });

  // Get available versions for each service
  ipcMain.handle('binaries:getAvailableVersions', async () => {
    if (!managers.binaryDownload) return {};
    return managers.binaryDownload.getVersionMeta();
  });

  // Get full service configuration (versions, ports, offsets)
  // Use dynamic versionMeta from BinaryDownloadManager when available (updated by remote config),
  // falling back to static SERVICE_VERSIONS as defaults
  ipcMain.handle('binaries:getServiceConfig', async () => {
    const dynamicVersions = managers.binaryDownload?.versionMeta;
    return {
      versions: dynamicVersions || SERVICE_VERSIONS,
      portOffsets: VERSION_PORT_OFFSETS,
      defaultPorts: DEFAULT_PORTS,
      serviceInfo: SERVICE_INFO,
    };
  });

  ipcMain.handle('binaries:getDownloadUrls', async () => {
    if (!managers.binaryDownload) return {};
    return managers.binaryDownload.getDownloadUrls();
  });

  ipcMain.handle('binaries:downloadPhp', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadPhp(version);
  });

  ipcMain.handle('binaries:downloadMysql', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadMysql(version);
  });

  ipcMain.handle('binaries:downloadMariadb', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadMariadb(version);
  });

  ipcMain.handle('binaries:downloadRedis', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadRedis(version);
  });

  ipcMain.handle('binaries:downloadMailpit', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadMailpit();
  });

  ipcMain.handle('binaries:downloadPhpMyAdmin', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadPhpMyAdmin();
  });

  ipcMain.handle('binaries:downloadNginx', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadNginx(version);
  });

  ipcMain.handle('binaries:downloadApache', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadApache(version);
  });

  ipcMain.handle('binaries:importApache', async (event, filePath, version = '2.4') => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.importApache(filePath, version);
  });

  // Generic binary import for any service
  ipcMain.handle('binaries:import', async (event, serviceName, version, filePath) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.importBinary(serviceName, version, filePath);
  });

  ipcMain.handle('binaries:openApacheDownloadPage', async () => {
    const { shell } = require('electron');
    await shell.openExternal('https://www.apachelounge.com/download/');
    return { success: true };
  });

  ipcMain.handle('binaries:downloadNodejs', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadNodejs(version);
  });

  ipcMain.handle('binaries:downloadComposer', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadComposer();
  });

  ipcMain.handle('binaries:downloadGit', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadGit();
  });

  ipcMain.handle('binaries:downloadPostgresql', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadPostgresql(version);
  });

  ipcMain.handle('binaries:downloadPython', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadPython(version);
  });

  ipcMain.handle('binaries:downloadMongodb', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadMongodb(version);
  });

  ipcMain.handle('binaries:downloadSqlite', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadSqlite(version);
  });

  ipcMain.handle('binaries:downloadMinio', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadMinio();
  });

  ipcMain.handle('binaries:downloadMemcached', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.downloadMemcached(version);
  });

  ipcMain.handle('binaries:runPip', async (event, version, args) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.runPip(version, args);
  });

  ipcMain.handle('binaries:cancelDownload', async (event, id) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.cancelDownload(id);
  });

  ipcMain.handle('binaries:runComposer', async (event, projectPath, command, phpVersion) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.runComposer(projectPath, command, phpVersion);
  });

  ipcMain.handle('binaries:runNpm', async (event, projectPath, command, nodeVersion) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.runNpm(projectPath, command, nodeVersion);
  });

  ipcMain.handle('binaries:remove', async (event, type, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.removeBinary(type, version);
  });

  // Scan for custom imported versions
  ipcMain.handle('binaries:scanCustomVersions', async () => {
    if (!managers.binaryDownload) return {};
    return managers.binaryDownload.scanCustomVersions();
  });

  // PHP.ini handlers
  ipcMain.handle('binaries:getPhpIni', async (event, version) => {
    if (!managers.binaryDownload) return null;
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpPath = path.join(managers.binaryDownload.resourcesPath, 'php', version, platform);
    const iniPath = path.join(phpPath, 'php.ini');

    if (await fs.pathExists(iniPath)) {
      return await fs.readFile(iniPath, 'utf8');
    }
    return null;
  });

  ipcMain.handle('binaries:savePhpIni', async (event, version, content) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpPath = path.join(managers.binaryDownload.resourcesPath, 'php', version, platform);
    const iniPath = path.join(phpPath, 'php.ini');

    await fs.writeFile(iniPath, content, 'utf8');
    return { success: true };
  });

  ipcMain.handle('binaries:resetPhpIni', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpPath = path.join(managers.binaryDownload.resourcesPath, 'php', version, platform);

    await managers.binaryDownload.createPhpIni(phpPath, version);
    return { success: true };
  });

  // Setup progress listener when binaryDownload becomes available
  const setupBinaryProgressListener = () => {
    if (managers.binaryDownload) {
      managers.binaryDownload.addProgressListener((id, progress) => {
        mainWindow?.webContents.send('binaries:progress', { id, progress });
      });
    } else {
      // Retry after a delay if not ready yet
      setTimeout(setupBinaryProgressListener, 500);
    }
  };
  setupBinaryProgressListener();

  // ============ WEB SERVER HANDLERS ============
  ipcMain.handle('webserver:getStatus', async () => {
    if (!managers.webServer) return {};
    return managers.webServer.getStatus();
  });

  ipcMain.handle('webserver:setServerType', async (event, type) => {
    if (!managers.webServer) throw new Error('WebServer manager not initialized');
    return managers.webServer.setServerType(type);
  });

  ipcMain.handle('webserver:getServerType', async () => {
    if (!managers.webServer) return 'nginx';
    return managers.webServer.getServerType();
  });

  ipcMain.handle('webserver:startProject', async (event, project) => {
    if (!managers.webServer) throw new Error('WebServer manager not initialized');
    return managers.webServer.startProject(project);
  });

  ipcMain.handle('webserver:stopProject', async (event, projectId) => {
    if (!managers.webServer) throw new Error('WebServer manager not initialized');
    return managers.webServer.stopProject(projectId);
  });

  ipcMain.handle('webserver:reloadConfig', async () => {
    if (!managers.webServer) throw new Error('WebServer manager not initialized');
    return managers.webServer.reloadConfig();
  });

  ipcMain.handle('webserver:getRunningProjects', async () => {
    if (!managers.webServer) return [];
    return managers.webServer.getRunningProjects();
  });

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
      const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
      const resourcePath = config.get('resourcePath') || path.join(app.getPath('userData'), 'resources');
      const phpExe = platform === 'win' ? 'php.exe' : 'php';
      const phpBinary = path.join(resourcePath, 'php', phpVersion, platform, phpExe);

      if (command.startsWith('php ') || command === 'php') {
        // Use project's PHP version
        cmd = phpBinary;
        args = command === 'php' ? [] : command.substring(4).split(' ').filter(Boolean);
      } else if (command.startsWith('artisan ') || command === 'artisan') {
        // Shortcut for php artisan - use project's PHP version
        cmd = phpBinary;
        args = command === 'artisan' ? ['artisan'] : ['artisan', ...command.substring(8).split(' ').filter(Boolean)];
      } else if (command.startsWith('composer ')) {
        // Use Composer with project's PHP version
        cmd = phpBinary;
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
        // Generic command - inject PHP path into PATH for scripts that might call php
        if (platform === 'win') {
          cmd = 'cmd.exe';
          args = ['/c', command];
        } else {
          cmd = '/bin/bash';
          args = ['-c', command];
        }
      }

      // Running command in terminal

      // Add PHP to PATH so scripts that call 'php' use the correct version
      const phpDir = path.join(resourcePath, 'php', phpVersion, platform);
      const pathSeparator = platform === 'win' ? ';' : ':';
      const enhancedPath = `${phpDir}${pathSeparator}${process.env.PATH || process.env.Path || ''}`;

      const proc = spawn(cmd, args, {
        cwd,
        env: {
          ...process.env,
          PATH: enhancedPath,
          Path: enhancedPath, // Windows uses Path
          COMPOSER_HOME: path.join(resourcePath, 'composer'),
          // Force ANSI color codes only — do NOT set ANSICON/ConEmuANSI/TERM
          // Those flags make npm think it has an interactive PTY and emit
          // cursor-positioning escape codes (\x1b[NG) that break alignment
          // when piped through stdio without a real PTY.
          FORCE_COLOR: '1',
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin pipe for interactive commands
      });

      // Store process reference for potential cancellation
      runningProcesses.set(projectId, proc);

      // Strip cursor-column positioning codes (\x1b[NG) that appear when a
      // subprocess thinks it has a PTY — these cause cascading indentation in xterm.
      const stripCursorCodes = (text) =>
        text
          .replace(/\x1b\[\d+G/g, '') // cursor to absolute column N
          .replace(/\x1b\[\d+;\d+H/g, '') // cursor to row;col
          .replace(/\x1b\[\d+C/g, ''); // cursor forward N cols

      proc.stdout.on('data', (data) => {
        const text = stripCursorCodes(data.toString());
        stdout += text;
        // Send real-time output to renderer
        mainWindow?.webContents.send('terminal:output', {
          projectId,
          text,
          type: 'stdout',
        });
      });

      proc.stderr.on('data', (data) => {
        const text = stripCursorCodes(data.toString());
        stderr += text;
        mainWindow?.webContents.send('terminal:output', {
          projectId,
          text,
          type: 'stderr',
        });
      });

      proc.on('error', (error) => {
        // Only clean up if this process is still the active one for this projectId
        if (runningProcesses.get(projectId) === proc) {
          runningProcesses.delete(projectId);
        }
        reject(error);
      });

      proc.on('close', (code) => {
        // Only clean up if this process is still the active one for this projectId
        if (runningProcesses.get(projectId) === proc) {
          runningProcesses.delete(projectId);
        }
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
      // Use SIGKILL on Windows since SIGTERM is not reliably handled
      const signal = process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM';
      kill(proc.pid, signal);
      runningProcesses.delete(projectId);
      return { success: true };
    }
    return { success: false };
  });

  ipcMain.handle('terminal:sendInput', async (event, projectId, input) => {
    const proc = runningProcesses.get(projectId);
    if (proc && proc.stdin && !proc.stdin.destroyed) {
      proc.stdin.write(input);
      return { success: true };
    }
    return { success: false };
  });

  // ============ CLI HANDLERS ============
  ipcMain.handle('cli:getStatus', async () => {
    if (!managers.cli) return { installed: false, inPath: false };
    return managers.cli.checkCliInstalled();
  });

  ipcMain.handle('cli:install', async () => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    return managers.cli.installCli();
  });

  ipcMain.handle('cli:addToPath', async () => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    return managers.cli.addToPath();
  });

  ipcMain.handle('cli:removeFromPath', async () => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    return managers.cli.removeFromPath();
  });

  ipcMain.handle('cli:getInstructions', async () => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    const cliPath = managers.cli.getCliPath();
    return managers.cli.getInstallInstructions(cliPath);
  });

  ipcMain.handle('cli:syncProjectConfigs', async () => {
    if (!managers.cli) throw new Error('CLI manager not initialized');

    // Get projects count and sync
    const projects = managers.cli.configStore.get('projects', []);
    await managers.cli.syncProjectsFile();

    // Return array format for UI compatibility
    return projects.map(p => ({ id: p.id, success: true }));
  });

  ipcMain.handle('cli:getDirectShimsEnabled', async () => {
    if (!managers.cli) return false;
    return managers.cli.getDirectShimsEnabled();
  });

  ipcMain.handle('cli:setDirectShimsEnabled', async (event, enabled) => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    return managers.cli.setDirectShimsEnabled(enabled);
  });

  ipcMain.handle('cli:getDefaultPhpVersion', async () => {
    if (!managers.cli) return null;
    return managers.cli.getDefaultPhpVersion();
  });

  ipcMain.handle('cli:setDefaultPhpVersion', async (event, version) => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    managers.cli.setDefaultPhpVersion(version);
    // Reinstall shims if enabled
    if (managers.cli.getDirectShimsEnabled()) {
      await managers.cli.installDirectShims();
    }
    return version;
  });

  ipcMain.handle('cli:getDefaultNodeVersion', async () => {
    if (!managers.cli) return null;
    return managers.cli.getDefaultNodeVersion();
  });

  ipcMain.handle('cli:setDefaultNodeVersion', async (event, version) => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    managers.cli.setDefaultNodeVersion(version);
    // Reinstall shims if enabled
    if (managers.cli.getDirectShimsEnabled()) {
      await managers.cli.installDirectShims();
    }
    return version;
  });

  ipcMain.handle('cli:getDefaultMysqlType', async () => {
    if (!managers.cli) return 'mysql';
    return managers.cli.getDefaultMysqlType();
  });

  ipcMain.handle('cli:getDefaultMysqlVersion', async () => {
    if (!managers.cli) return '8.4';
    return managers.cli.getDefaultMysqlVersion();
  });

  // Resource monitoring interval
  const resourceInterval = setInterval(async () => {
    try {
      // Check if window still exists and is not destroyed
      if (!mainWindow || mainWindow.isDestroyed()) {
        clearInterval(resourceInterval);
        return;
      }
      const usage = await service.getResourceUsage();
      mainWindow.webContents.send('resource:update', usage);
    } catch (error) {
      // Silently ignore errors during shutdown
      if (!error.message?.includes('destroyed')) {
        managers.log?.systemError('Error getting resource usage', { error: error.message });
      }
    }
  }, 5000);

  // ============ GIT HANDLERS ============
  ipcMain.handle('git:isAvailable', async () => {
    if (!managers.git) return { available: false, path: null, source: null };
    return managers.git.isGitAvailable();
  });

  ipcMain.handle('git:clone', async (event, url, destPath, options = {}) => {
    if (!managers.git) throw new Error('Git manager not initialized');

    // Set up progress callback to send to renderer
    const onProgress = (progress) => {
      mainWindow?.webContents.send('git:cloneProgress', progress);
    };

    return managers.git.cloneRepository(url, destPath, { ...options, onProgress });
  });

  ipcMain.handle('git:testAuth', async (event, url, credentials) => {
    if (!managers.git) throw new Error('Git manager not initialized');
    return managers.git.testAuthentication(url, credentials);
  });

  ipcMain.handle('git:generateSshKey', async () => {
    if (!managers.git) throw new Error('Git manager not initialized');
    return managers.git.generateSshKey();
  });

  ipcMain.handle('git:getSshPublicKey', async () => {
    if (!managers.git) throw new Error('Git manager not initialized');
    return managers.git.getSshPublicKey();
  });

  ipcMain.handle('git:regenerateSshKey', async () => {
    if (!managers.git) throw new Error('Git manager not initialized');
    return managers.git.regenerateSshKey();
  });

  ipcMain.handle('git:validateUrl', async (event, url) => {
    if (!managers.git) throw new Error('Git manager not initialized');
    return managers.git.validateRepositoryUrl(url);
  });

  // IPC handlers registered
}

module.exports = { setupIpcHandlers };
