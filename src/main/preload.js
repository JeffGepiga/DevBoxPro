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
    delete: (id) => ipcRenderer.invoke('projects:delete', id),
    start: (id) => ipcRenderer.invoke('projects:start', id),
    stop: (id) => ipcRenderer.invoke('projects:stop', id),
    restart: (id) => ipcRenderer.invoke('projects:restart', id),
    getStatus: (id) => ipcRenderer.invoke('projects:getStatus', id),
    openInEditor: (id, editor) => ipcRenderer.invoke('projects:openInEditor', id, editor),
    openInBrowser: (id) => ipcRenderer.invoke('projects:openInBrowser', id),
    openFolder: (id) => ipcRenderer.invoke('projects:openFolder', id),
  },

  // PHP operations
  php: {
    getVersions: () => ipcRenderer.invoke('php:getVersions'),
    getExtensions: (version) => ipcRenderer.invoke('php:getExtensions', version),
    toggleExtension: (version, extension, enabled) =>
      ipcRenderer.invoke('php:toggleExtension', version, extension, enabled),
    runCommand: (projectId, command) => ipcRenderer.invoke('php:runCommand', projectId, command),
  },

  // Service operations
  services: {
    getStatus: () => ipcRenderer.invoke('services:getStatus'),
    start: (service) => ipcRenderer.invoke('services:start', service),
    stop: (service) => ipcRenderer.invoke('services:stop', service),
    restart: (service) => ipcRenderer.invoke('services:restart', service),
    startAll: () => ipcRenderer.invoke('services:startAll'),
    stopAll: () => ipcRenderer.invoke('services:stopAll'),
    getResourceUsage: () => ipcRenderer.invoke('services:getResourceUsage'),
  },

  // Database operations
  database: {
    getConnections: () => ipcRenderer.invoke('database:getConnections'),
    getDatabases: () => ipcRenderer.invoke('database:getDatabases'),
    createDatabase: (name) => ipcRenderer.invoke('database:createDatabase', name),
    deleteDatabase: (name) => ipcRenderer.invoke('database:deleteDatabase', name),
    importDatabase: (name, filePath) => ipcRenderer.invoke('database:importDatabase', name, filePath),
    exportDatabase: (name, filePath) => ipcRenderer.invoke('database:exportDatabase', name, filePath),
    runQuery: (database, query) => ipcRenderer.invoke('database:runQuery', database, query),
    getPhpMyAdminUrl: () => ipcRenderer.invoke('database:getPhpMyAdminUrl'),
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
  },

  // Log operations
  logs: {
    getProjectLogs: (projectId, lines) => ipcRenderer.invoke('logs:getProjectLogs', projectId, lines),
    getServiceLogs: (service, lines) => ipcRenderer.invoke('logs:getServiceLogs', service, lines),
    clearProjectLogs: (projectId) => ipcRenderer.invoke('logs:clearProjectLogs', projectId),
    streamLogs: (projectId) => ipcRenderer.invoke('logs:streamLogs', projectId),
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
    openExternal: (url) => ipcRenderer.invoke('system:openExternal', url),
    getAppVersion: () => ipcRenderer.invoke('system:getAppVersion'),
    getPlatform: () => ipcRenderer.invoke('system:getPlatform'),
    checkForUpdates: () => ipcRenderer.invoke('system:checkForUpdates'),
  },

  // Terminal operations
  terminal: {
    create: (projectId) => ipcRenderer.invoke('terminal:create', projectId),
    write: (terminalId, data) => ipcRenderer.invoke('terminal:write', terminalId, data),
    resize: (terminalId, cols, rows) => ipcRenderer.invoke('terminal:resize', terminalId, cols, rows),
    close: (terminalId) => ipcRenderer.invoke('terminal:close', terminalId),
  },

  // Binary download operations
  binaries: {
    getInstalled: () => ipcRenderer.invoke('binaries:getInstalled'),
    getDownloadUrls: () => ipcRenderer.invoke('binaries:getDownloadUrls'),
    downloadPhp: (version) => ipcRenderer.invoke('binaries:downloadPhp', version),
    downloadMysql: () => ipcRenderer.invoke('binaries:downloadMysql'),
    downloadRedis: () => ipcRenderer.invoke('binaries:downloadRedis'),
    downloadMailpit: () => ipcRenderer.invoke('binaries:downloadMailpit'),
    downloadPhpMyAdmin: () => ipcRenderer.invoke('binaries:downloadPhpMyAdmin'),
    downloadNginx: () => ipcRenderer.invoke('binaries:downloadNginx'),
    downloadApache: () => ipcRenderer.invoke('binaries:downloadApache'),
    remove: (type, version) => ipcRenderer.invoke('binaries:remove', type, version),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data.id, data.progress);
      ipcRenderer.on('binaries:progress', handler);
      return () => ipcRenderer.removeListener('binaries:progress', handler);
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
      'service:statusChanged',
      'log:newEntry',
      'terminal:output',
      'resource:update',
      'update:available',
      'update:downloaded',
      'binaries:progress',
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  },
});
