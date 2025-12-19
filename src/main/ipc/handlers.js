console.log('[IPC] Loading handlers.js module...');

const { dialog, shell } = require('electron');
const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');

console.log('[IPC] Core modules loaded, loading serviceConfig...');

// Import centralized service configuration
const { 
  SERVICE_VERSIONS, 
  VERSION_PORT_OFFSETS, 
  DEFAULT_PORTS, 
  SERVICE_INFO,
  getServicePort,
  getDefaultVersion 
} = require('../../shared/serviceConfig');

console.log('[IPC] serviceConfig loaded successfully');

function setupIpcHandlers(ipcMain, managers, mainWindow) {
  console.log('[IPC] Setting up IPC handlers...');
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

  ipcMain.handle('system:saveFile', async (event, options) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: options?.defaultPath,
      filters: options?.filters || [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePath;
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
  // Note: binaryDownload may not be initialized immediately, access via managers object
  console.log('[IPC] Registering binary download handlers...');
  
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
  console.log('[IPC] Registered binaries:checkForUpdates handler');

  // Apply updates from remote config
  ipcMain.handle('binaries:applyUpdates', async () => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized yet');
    return managers.binaryDownload.applyUpdates();
  });

  ipcMain.handle('binaries:getStatus', async () => {
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

      return status;
  });

  // Get available versions for each service
  ipcMain.handle('binaries:getAvailableVersions', async () => {
    if (!managers.binaryDownload) return {};
    return managers.binaryDownload.getVersionMeta();
  });

  // Get full service configuration (versions, ports, offsets)
  ipcMain.handle('binaries:getServiceConfig', async () => {
    return {
      versions: SERVICE_VERSIONS,
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

  ipcMain.handle('binaries:importApache', async (event, filePath) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    return managers.binaryDownload.importApache(filePath);
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
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const phpPath = path.join(managers.binaryDownload.resourcesPath, 'php', version, platform);
    const iniPath = path.join(phpPath, 'php.ini');
    
    if (await fs.pathExists(iniPath)) {
      return await fs.readFile(iniPath, 'utf8');
    }
    return null;
  });

  ipcMain.handle('binaries:savePhpIni', async (event, version, content) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const phpPath = path.join(managers.binaryDownload.resourcesPath, 'php', version, platform);
    const iniPath = path.join(phpPath, 'php.ini');
    
    await fs.writeFile(iniPath, content, 'utf8');
    return { success: true };
  });

  ipcMain.handle('binaries:resetPhpIni', async (event, version) => {
    if (!managers.binaryDownload) throw new Error('Binary manager not initialized');
    const platform = process.platform === 'win32' ? 'win' : 'mac';
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
      const platform = process.platform === 'win32' ? 'win' : 'mac';
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

      console.log(`Running command: ${cmd} ${args.join(' ')} in ${cwd}`);

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
          // Force ANSI color output
          FORCE_COLOR: '1',
          TERM: 'xterm-256color',
          // Laravel/Symfony specific
          ANSICON: '1',
          ConEmuANSI: 'ON',
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'], // Enable stdin pipe for interactive commands
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

  ipcMain.handle('cli:getAlias', async () => {
    if (!managers.cli) return 'dvp';
    return managers.cli.getAlias();
  });

  ipcMain.handle('cli:setAlias', async (event, alias) => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    return managers.cli.setAlias(alias);
  });

  ipcMain.handle('cli:install', async () => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    return managers.cli.installCli();
  });

  ipcMain.handle('cli:addToPath', async () => {
    if (!managers.cli) throw new Error('CLI manager not initialized');
    return managers.cli.addToPath();
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
