const tunnelLifecycle = require('./tunnel/lifecycle');
const tunnelProviders = require('./tunnel/providers');
const tunnelStatus = require('./tunnel/status');

class TunnelManager {
  constructor(resourcePath, configStore, managers = {}) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.activeTunnels = new Map();
    this.statusEmitter = null;
  }
}

Object.assign(
  TunnelManager.prototype,
  tunnelProviders,
  tunnelLifecycle,
  tunnelStatus
);

module.exports = { TunnelManager };