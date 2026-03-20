/**
 * CliManager - Manages CLI functionality for terminal commands
 *
 * Provides a way for users to run PHP/Node/MySQL commands using project-specific versions
 * directly from their external terminal/editor.
 *
 * Example usage (after enabling in Settings):
 *   php artisan optimize
 *   npm install
 *   composer install
 *   node script.js
 *   mysql -u root
 *   mysqldump -u root mydb > backup.sql
 */

const path = require('path');
const cliBinaries = require('./cli/binaries');
const cliInstall = require('./cli/install');
const cliPath = require('./cli/path');
const cliProjects = require('./cli/projects');
const cliShims = require('./cli/shims');

class CliManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.resourcesPath = null;
  }

  async initialize(resourcesPath) {
    this.resourcesPath = resourcesPath;
  }

  getAlias() {
    return this.configStore.get('settings.cliAlias', 'dvp');
  }

  setAlias(alias) {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) {
      throw new Error('Invalid alias. Use only letters, numbers, underscores, and hyphens. Must start with a letter.');
    }

    this.configStore.set('settings.cliAlias', alias);
    return alias;
  }

  getCliPath() {
    const dataPath = typeof this.configStore.getDataPath === 'function'
      ? this.configStore.getDataPath()
      : this.configStore.get('dataPath');

    return path.join(dataPath, 'cli');
  }
}

Object.assign(CliManager.prototype, cliBinaries, cliInstall, cliPath, cliProjects, cliShims);

module.exports = CliManager;
