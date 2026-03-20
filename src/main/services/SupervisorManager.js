const supervisorHelpers = require('./supervisor/helpers');
const supervisorConfig = require('./supervisor/config');
const supervisorRuntime = require('./supervisor/runtime');
const supervisorLogs = require('./supervisor/logs');
const supervisorTemplates = require('./supervisor/templates');

class SupervisorManager {
  constructor(resourcePath, configStore, managers = {}) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.processes = new Map(); // projectId -> { processName -> processInfo }
    this.mainWindow = null; // Will be set by main.js
    this.logsPath = null; // Will be set in initialize()
  }
}

Object.assign(
  SupervisorManager.prototype,
  supervisorHelpers,
  supervisorConfig,
  supervisorRuntime,
  supervisorLogs,
  supervisorTemplates
);

module.exports = { SupervisorManager };
