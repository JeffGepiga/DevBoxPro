const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('devbox', {
  // Project operations
  projects: {
    getAll: () => ipcRenderer.invoke('projects:getAll'),
    getById: (id) => ipcRenderer.invoke('projects:getById', id),
    create: (config) => ipcRenderer.invoke('projects:create', config),
    update: (id, config) => ipcRenderer.invoke('projects:update', id, config),
    reorder: (projectIds) => ipcRenderer.invoke('projects:reorder', projectIds),
    delete: (id, deleteFiles) => ipcRenderer.invoke('projects:delete', id, deleteFiles),
    start: (id) => ipcRenderer.invoke('projects:start', id),
    stop: (id) => ipcRenderer.invoke('projects:stop', id),
    restart: (id) => ipcRenderer.invoke('projects:restart', id),
    getStatus: (id) => ipcRenderer.invoke('projects:getStatus', id),
    openInEditor: (id, editor) => ipcRenderer.invoke('projects:openInEditor', id, editor),
    openInBrowser: (id) => ipcRenderer.invoke('projects:openInBrowser', id),
    openFolder: (id) => ipcRenderer.invoke('projects:openFolder', id),
    move: (id, newPath) => ipcRenderer.invoke('projects:move', id, newPath),
    switchWebServer: (id, webServer) => ipcRenderer.invoke('projects:switchWebServer', id, webServer),
    regenerateVhost: (id) => ipcRenderer.invoke('projects:regenerateVhost', id),
    scanUnregistered: () => ipcRenderer.invoke('projects:scanUnregistered'),
    registerExisting: (config) => ipcRenderer.invoke('projects:registerExisting', config),
    detectType: (folderPath) => ipcRenderer.invoke('projects:detectType', folderPath),
    exportConfig: (id) => ipcRenderer.invoke('projects:exportConfig', id),
    // Service version operations
    getServiceVersions: (id) => ipcRenderer.invoke('projects:getServiceVersions', id),
    updateServiceVersions: (id, versions) => ipcRenderer.invoke('projects:updateServiceVersions', id, versions),
    checkCompatibility: (config) => ipcRenderer.invoke('projects:checkCompatibility', config),
    getCompatibilityRules: () => ipcRenderer.invoke('projects:getCompatibilityRules'),
    // Environment operations
    readEnv: (id) => ipcRenderer.invoke('projects:readEnv', id),
  },

  // Compatibility operations
  compatibility: {
    checkForUpdates: () => ipcRenderer.invoke('compatibility:checkForUpdates'),
    applyUpdates: () => ipcRenderer.invoke('compatibility:applyUpdates'),
    getConfigInfo: () => ipcRenderer.invoke('compatibility:getConfigInfo'),
  },

  // PHP operations
  php: {
    getVersions: () => ipcRenderer.invoke('php:getVersions'),
    getExtensions: (version) => ipcRenderer.invoke('php:getExtensions', version),
    toggleExtension: (version, extension, enabled) =>
      ipcRenderer.invoke('php:toggleExtension', version, extension, enabled),
    runCommand: (projectId, command) => ipcRenderer.invoke('php:runCommand', projectId, command),
    runArtisan: (projectId, artisanCommand) => ipcRenderer.invoke('php:runArtisan', projectId, artisanCommand),
  },

  // Service operations
  services: {
    getStatus: () => ipcRenderer.invoke('services:getStatus'),
    start: (service, version) => ipcRenderer.invoke('services:start', service, version),
    stop: (service, version) => ipcRenderer.invoke('services:stop', service, version),
    restart: (service, version) => ipcRenderer.invoke('services:restart', service, version),
    startAll: () => ipcRenderer.invoke('services:startAll'),
    stopAll: () => ipcRenderer.invoke('services:stopAll'),
    getResourceUsage: () => ipcRenderer.invoke('services:getResourceUsage'),
    getRunningVersions: (service) => ipcRenderer.invoke('services:getRunningVersions', service),
    isVersionRunning: (service, version) => ipcRenderer.invoke('services:isVersionRunning', service, version),
    getWebServerPorts: (webServerType) => ipcRenderer.invoke('services:getWebServerPorts', webServerType),
    getProjectNetworkPort: (projectId) => ipcRenderer.invoke('services:getProjectNetworkPort', projectId),
  },

  // Database operations
  database: {
    getConnections: () => ipcRenderer.invoke('database:getConnections'),
    getDatabases: () => ipcRenderer.invoke('database:getDatabases'),
    createDatabase: (name) => ipcRenderer.invoke('database:createDatabase', name),
    deleteDatabase: (name) => ipcRenderer.invoke('database:deleteDatabase', name),
    importDatabase: (name, filePath, mode) => ipcRenderer.invoke('database:importDatabase', name, filePath, mode),
    exportDatabase: (name, filePath) => ipcRenderer.invoke('database:exportDatabase', name, filePath),
    runQuery: (database, query) => ipcRenderer.invoke('database:runQuery', database, query),
    getPhpMyAdminUrl: (dbType, version) => ipcRenderer.invoke('database:getPhpMyAdminUrl', dbType, version),
    getActiveDatabaseType: () => ipcRenderer.invoke('database:getActiveDatabaseType'),
    setActiveDatabaseType: (dbType, version) => ipcRenderer.invoke('database:setActiveDatabaseType', dbType, version),
    getDatabaseInfo: () => ipcRenderer.invoke('database:getDatabaseInfo'),
    resetCredentials: (user, password) => ipcRenderer.invoke('database:resetCredentials', user, password),
    syncCredentialsToAllVersions: (newUser, newPassword, oldPassword) =>
      ipcRenderer.invoke('database:syncCredentialsToAllVersions', newUser, newPassword, oldPassword),
    cancelOperation: (operationId) => ipcRenderer.invoke('database:cancelOperation', operationId),
    getRunningOperations: () => ipcRenderer.invoke('database:getRunningOperations'),
    onImportProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('database:importProgress', handler);
      return () => ipcRenderer.removeListener('database:importProgress', handler);
    },
    onExportProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('database:exportProgress', handler);
      return () => ipcRenderer.removeListener('database:exportProgress', handler);
    },
  },

  // SSL operations
  ssl: {
    getCertificates: () => ipcRenderer.invoke('ssl:getCertificates'),
    createCertificate: (domains) => ipcRenderer.invoke('ssl:createCertificate', domains),
    deleteCertificate: (domain) => ipcRenderer.invoke('ssl:deleteCertificate', domain),
    trustCertificate: (domain) => ipcRenderer.invoke('ssl:trustCertificate', domain),
  },

  // Supervisor operations
  supervisor: {
    getProcesses: (projectId) => ipcRenderer.invoke('supervisor:getProcesses', projectId),
    addProcess: (projectId, config) => ipcRenderer.invoke('supervisor:addProcess', projectId, config),
    removeProcess: (projectId, processName) =>
      ipcRenderer.invoke('supervisor:removeProcess', projectId, processName),
    startProcess: (projectId, processName) =>
      ipcRenderer.invoke('supervisor:startProcess', projectId, processName),
    stopProcess: (projectId, processName) =>
      ipcRenderer.invoke('supervisor:stopProcess', projectId, processName),
    restartProcess: (projectId, processName) =>
      ipcRenderer.invoke('supervisor:restartProcess', projectId, processName),
    getWorkerLogs: (projectId, processName, lines) =>
      ipcRenderer.invoke('supervisor:getWorkerLogs', projectId, processName, lines),
    clearWorkerLogs: (projectId, processName) =>
      ipcRenderer.invoke('supervisor:clearWorkerLogs', projectId, processName),
    getAllWorkerLogs: (projectId, lines) =>
      ipcRenderer.invoke('supervisor:getAllWorkerLogs', projectId, lines),
    onOutput: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('supervisor:output', handler);
      return () => ipcRenderer.removeListener('supervisor:output', handler);
    },
  },

  // Log operations
  logs: {
    getProjectLogs: (projectId, lines) => ipcRenderer.invoke('logs:getProjectLogs', projectId, lines),
    getServiceLogs: (service, lines) => ipcRenderer.invoke('logs:getServiceLogs', service, lines),
    getSystemLogs: (lines) => ipcRenderer.invoke('logs:getSystemLogs', lines),
    clearProjectLogs: (projectId) => ipcRenderer.invoke('logs:clearProjectLogs', projectId),
    clearServiceLogs: (serviceName) => ipcRenderer.invoke('logs:clearServiceLogs', serviceName),
    clearSystemLogs: () => ipcRenderer.invoke('logs:clearSystemLogs'),
    streamLogs: (projectId) => ipcRenderer.invoke('logs:streamLogs', projectId),
  },

  // CLI operations
  cli: {
    getStatus: () => ipcRenderer.invoke('cli:getStatus'),
    getAlias: () => ipcRenderer.invoke('cli:getAlias'),
    setAlias: (alias) => ipcRenderer.invoke('cli:setAlias', alias),
    install: () => ipcRenderer.invoke('cli:install'),
    addToPath: () => ipcRenderer.invoke('cli:addToPath'),
    removeFromPath: () => ipcRenderer.invoke('cli:removeFromPath'),
    getInstructions: () => ipcRenderer.invoke('cli:getInstructions'),
    syncProjectConfigs: () => ipcRenderer.invoke('cli:syncProjectConfigs'),
    getDirectShimsEnabled: () => ipcRenderer.invoke('cli:getDirectShimsEnabled'),
    setDirectShimsEnabled: (enabled) => ipcRenderer.invoke('cli:setDirectShimsEnabled', enabled),
    getDefaultPhpVersion: () => ipcRenderer.invoke('cli:getDefaultPhpVersion'),
    setDefaultPhpVersion: (version) => ipcRenderer.invoke('cli:setDefaultPhpVersion', version),
    getDefaultNodeVersion: () => ipcRenderer.invoke('cli:getDefaultNodeVersion'),
    setDefaultNodeVersion: (version) => ipcRenderer.invoke('cli:setDefaultNodeVersion', version),
    getDefaultMysqlType: () => ipcRenderer.invoke('cli:getDefaultMysqlType'),
    getDefaultMysqlVersion: () => ipcRenderer.invoke('cli:getDefaultMysqlVersion'),
  },

  // Settings operations
  settings: {
    get: (key) => ipcRenderer.invoke('settings:get', key),
    set: (key, value) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
    reset: () => ipcRenderer.invoke('settings:reset'),
  },

  // System operations
  system: {
    selectDirectory: () => ipcRenderer.invoke('system:selectDirectory'),
    selectFile: (filters) => ipcRenderer.invoke('system:selectFile', filters),
    saveFile: (options) => ipcRenderer.invoke('system:saveFile', options),
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
    openPath: (path) => ipcRenderer.invoke('system:openPath', path),
    getAppDataPath: () => ipcRenderer.invoke('system:getAppDataPath'),
    getAppVersion: () => ipcRenderer.invoke('system:getAppVersion'),
    getPlatform: () => ipcRenderer.invoke('system:getPlatform'),
    getLocalIpAddresses: () => ipcRenderer.invoke('system:getLocalIpAddresses'),
    checkForUpdates: () => ipcRenderer.invoke('system:checkForUpdates'),
    clearAllData: (deleteProjectFiles) => ipcRenderer.invoke('system:clearAllData', deleteProjectFiles),
  },

  // Update operations
  update: {
    checkForUpdates: () => ipcRenderer.invoke('update:checkForUpdates'),
    downloadUpdate: () => ipcRenderer.invoke('update:downloadUpdate'),
    quitAndInstall: () => ipcRenderer.invoke('update:quitAndInstall'),
    getStatus: () => ipcRenderer.invoke('update:getStatus'),
    getReleasesHistory: () => ipcRenderer.invoke('update:getReleasesHistory'),
    downloadAndInstallVersion: (version, downloadUrl) => ipcRenderer.invoke('update:downloadAndInstallVersion', version, downloadUrl),
    onStatus: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('update:status', handler);
      return () => ipcRenderer.removeListener('update:status', handler);
    },
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('update:progress', handler);
      return () => ipcRenderer.removeListener('update:progress', handler);
    },
    onRollbackProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('update:rollbackProgress', handler);
      return () => ipcRenderer.removeListener('update:rollbackProgress', handler);
    },
  },

  // Terminal operations
  terminal: {
    runCommand: (projectId, command, options) => ipcRenderer.invoke('terminal:runCommand', projectId, command, options),
    cancelCommand: (projectId) => ipcRenderer.invoke('terminal:cancelCommand', projectId),
    sendInput: (projectId, input) => ipcRenderer.invoke('terminal:sendInput', projectId, input),
    ...(() => {
      return {
        onOutput: (callback) => {
          const handler = (event, data) => callback(data);
          ipcRenderer.on('terminal:output', handler);
          // Return cleanup so caller can remove the exact handler reference
          return () => ipcRenderer.removeListener('terminal:output', handler);
        },
        offOutput: (callback) => {
          // Legacy: best-effort removal (may not work across contextBridge boundary)
          ipcRenderer.removeListener('terminal:output', callback);
        },
      };
    })(),
    onInstallComplete: (callback) => {
      const handler = (event, data) => callback(event, data);
      ipcRenderer.on('installation:complete', handler);
      return () => ipcRenderer.removeListener('installation:complete', handler);
    },
  },

  // Binary download operations
  binaries: {
    getInstalled: () => ipcRenderer.invoke('binaries:getInstalled'),
    getActiveDownloads: () => ipcRenderer.invoke('binaries:getActiveDownloads'),
    getStatus: () => ipcRenderer.invoke('binaries:getStatus'),
    getAvailableVersions: () => ipcRenderer.invoke('binaries:getAvailableVersions'),
    getServiceConfig: () => ipcRenderer.invoke('binaries:getServiceConfig'),
    getDownloadUrls: () => ipcRenderer.invoke('binaries:getDownloadUrls'),
    checkForUpdates: () => ipcRenderer.invoke('binaries:checkForUpdates'),
    applyUpdates: () => ipcRenderer.invoke('binaries:applyUpdates'),
    downloadPhp: (version) => ipcRenderer.invoke('binaries:downloadPhp', version),
    downloadMysql: (version) => ipcRenderer.invoke('binaries:downloadMysql', version),
    downloadMariadb: (version) => ipcRenderer.invoke('binaries:downloadMariadb', version),
    downloadRedis: (version) => ipcRenderer.invoke('binaries:downloadRedis', version),
    downloadMailpit: () => ipcRenderer.invoke('binaries:downloadMailpit'),
    downloadPhpMyAdmin: () => ipcRenderer.invoke('binaries:downloadPhpMyAdmin'),
    downloadNginx: (version) => ipcRenderer.invoke('binaries:downloadNginx', version),
    downloadApache: (version) => ipcRenderer.invoke('binaries:downloadApache', version),
    importApache: (filePath, version) => ipcRenderer.invoke('binaries:importApache', filePath, version),
    importBinary: (serviceName, version, filePath) => ipcRenderer.invoke('binaries:import', serviceName, version, filePath),
    openApacheDownloadPage: () => ipcRenderer.invoke('binaries:openApacheDownloadPage'),
    downloadNodejs: (version) => ipcRenderer.invoke('binaries:downloadNodejs', version),
    downloadComposer: () => ipcRenderer.invoke('binaries:downloadComposer'),
    downloadGit: () => ipcRenderer.invoke('binaries:downloadGit'),
    downloadPostgresql: (version) => ipcRenderer.invoke('binaries:downloadPostgresql', version),
    downloadPython: (version) => ipcRenderer.invoke('binaries:downloadPython', version),
    downloadMongodb: (version) => ipcRenderer.invoke('binaries:downloadMongodb', version),
    downloadSqlite: (version) => ipcRenderer.invoke('binaries:downloadSqlite', version),
    downloadMinio: () => ipcRenderer.invoke('binaries:downloadMinio'),
    downloadMemcached: (version) => ipcRenderer.invoke('binaries:downloadMemcached', version),
    runPip: (version, args) => ipcRenderer.invoke('binaries:runPip', version, args),
    cancelDownload: (id) => ipcRenderer.invoke('binaries:cancelDownload', id),
    runComposer: (projectPath, command, phpVersion) => ipcRenderer.invoke('binaries:runComposer', projectPath, command, phpVersion),
    runNpm: (projectPath, command, nodeVersion) => ipcRenderer.invoke('binaries:runNpm', projectPath, command, nodeVersion),
    remove: (type, version) => ipcRenderer.invoke('binaries:remove', type, version),
    scanCustomVersions: () => ipcRenderer.invoke('binaries:scanCustomVersions'),
    getPhpIni: (version) => ipcRenderer.invoke('binaries:getPhpIni', version),
    savePhpIni: (version, content) => ipcRenderer.invoke('binaries:savePhpIni', version, content),
    resetPhpIni: (version) => ipcRenderer.invoke('binaries:resetPhpIni', version),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data.id, data.progress);
      ipcRenderer.on('binaries:progress', handler);
      return () => ipcRenderer.removeListener('binaries:progress', handler);
    },
  },

  // Git operations
  git: {
    isAvailable: () => ipcRenderer.invoke('git:isAvailable'),
    clone: (url, destPath, options) => ipcRenderer.invoke('git:clone', url, destPath, options),
    testAuth: (url, credentials) => ipcRenderer.invoke('git:testAuth', url, credentials),
    generateSshKey: () => ipcRenderer.invoke('git:generateSshKey'),
    regenerateSshKey: () => ipcRenderer.invoke('git:regenerateSshKey'),
    getSshPublicKey: () => ipcRenderer.invoke('git:getSshPublicKey'),
    validateUrl: (url) => ipcRenderer.invoke('git:validateUrl', url),
    onCloneProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('git:cloneProgress', handler);
      return () => ipcRenderer.removeListener('git:cloneProgress', handler);
    },
  },

  // Web server operations
  webServer: {
    getStatus: () => ipcRenderer.invoke('webserver:getStatus'),
    setServerType: (type) => ipcRenderer.invoke('webserver:setServerType', type),
    getServerType: () => ipcRenderer.invoke('webserver:getServerType'),
    startProject: (project) => ipcRenderer.invoke('webserver:startProject', project),
    stopProject: (projectId) => ipcRenderer.invoke('webserver:stopProject', projectId),
    reloadConfig: () => ipcRenderer.invoke('webserver:reloadConfig'),
    getRunningProjects: () => ipcRenderer.invoke('webserver:getRunningProjects'),
  },

  // Event subscriptions
  on: (channel, callback) => {
    const validChannels = [
      'project:statusChanged',
      'project:webServerChanged',
      'project:autoStarting',
      'project:autoStarted',
      'service:statusChanged',
      'log:newEntry',
      'terminal:output',
      'resource:update',
      'update:available',
      'update:downloaded',
      'update:status',
      'update:progress',
      'binaries:progress',
      'supervisor:output',
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
