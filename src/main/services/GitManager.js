const path = require('path');
const { app } = require('electron');
const gitAvailability = require('./git/availability');
const gitClone = require('./git/clone');
const gitSsh = require('./git/ssh');
const gitProgress = require('./git/progress');

/**
 * GitManager - Handles Git operations for cloning repositories
 * Supports both system Git and portable Git downloaded via BinaryDownloadManager
 */
class GitManager {
    constructor(configStore, managers) {
        this.configStore = configStore;
        this.managers = managers;
        this.resourcesPath = typeof this.configStore.getResourcesPath === 'function'
            ? this.configStore.getResourcesPath()
            : typeof this.configStore.get === 'function' && this.configStore.get('resourcePath')
                ? this.configStore.get('resourcePath')
            : path.join(app.getPath('userData'), 'resources');
        this.gitPath = null; // Path to git executable
        this.progressListeners = new Set();
        this.sshKeyPath = typeof this.configStore.getSshPath === 'function'
            ? this.configStore.getSshPath()
            : path.join(app.getPath('userData'), 'ssh');
    }

}

Object.assign(
    GitManager.prototype,
    gitAvailability,
    gitClone,
    gitSsh,
    gitProgress
);

module.exports = { GitManager };
