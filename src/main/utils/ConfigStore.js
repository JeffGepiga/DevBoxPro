const Store = require('electron-store');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');

class ConfigStore {
  constructor() {
    this.store = new Store({
      name: 'devbox-pro-config',
      defaults: this.getDefaults(),
    });

    // Ensure data directory exists
    const dataPath = this.get('dataPath');
    fs.ensureDirSync(dataPath);
  }

  getDefaults() {
    const dataPath = path.join(os.homedir(), '.devbox-pro');

    return {
      dataPath,
      settings: {
        autoStartServices: true,
        autoStartOnLaunch: true,
        portRangeStart: 8000,
        sslEnabled: true,
        defaultPhpVersion: '8.2',
        defaultEditor: 'vscode',
        theme: 'system',
        phpMyAdminPort: 8080,
        mailpitPort: 8025,
        mailpitSmtpPort: 1025,
        redisPort: 6379,
        mysqlPort: 3306,
      },
      projects: [],
      phpVersions: {},
      certificates: {},
      recentProjects: [],
    };
  }

  get(key, defaultValue = undefined) {
    const value = this.store.get(key);
    return value !== undefined ? value : defaultValue;
  }

  set(key, value) {
    this.store.set(key, value);
    return value;
  }

  delete(key) {
    this.store.delete(key);
  }

  has(key) {
    return this.store.has(key);
  }

  getAll() {
    return this.store.store;
  }

  reset() {
    this.store.clear();
    const defaults = this.getDefaults();
    for (const [key, value] of Object.entries(defaults)) {
      this.store.set(key, value);
    }
    return defaults;
  }

  // Project-specific helpers
  addRecentProject(projectId) {
    const recent = this.get('recentProjects', []);
    const filtered = recent.filter((id) => id !== projectId);
    filtered.unshift(projectId);
    this.set('recentProjects', filtered.slice(0, 10));
  }

  getRecentProjects() {
    const recentIds = this.get('recentProjects', []);
    const projects = this.get('projects', []);
    return recentIds
      .map((id) => projects.find((p) => p.id === id))
      .filter(Boolean);
  }

  // Settings helpers
  getSetting(key, defaultValue = undefined) {
    const settings = this.get('settings', {});
    return settings[key] !== undefined ? settings[key] : defaultValue;
  }

  setSetting(key, value) {
    const settings = this.get('settings', {});
    settings[key] = value;
    this.set('settings', settings);
    return value;
  }

  // Export/Import config
  async exportConfig(filePath) {
    const config = this.getAll();
    await fs.writeJson(filePath, config, { spaces: 2 });
    return { success: true, path: filePath };
  }

  async importConfig(filePath) {
    if (!(await fs.pathExists(filePath))) {
      throw new Error('Config file not found');
    }

    const config = await fs.readJson(filePath);

    // Validate config structure
    if (!config.settings || !Array.isArray(config.projects)) {
      throw new Error('Invalid config file format');
    }

    // Import settings (merge with defaults)
    const defaults = this.getDefaults();
    const mergedSettings = { ...defaults.settings, ...config.settings };
    this.set('settings', mergedSettings);

    // Import projects
    if (config.projects) {
      this.set('projects', config.projects);
    }

    return { success: true };
  }

  // Path helpers
  getDataPath() {
    return this.get('dataPath');
  }

  getLogsPath() {
    return path.join(this.get('dataPath'), 'logs');
  }

  getMysqlDataPath() {
    return path.join(this.get('dataPath'), 'mysql', 'data');
  }

  getRedisDataPath() {
    return path.join(this.get('dataPath'), 'redis');
  }

  getSslPath() {
    return path.join(this.get('dataPath'), 'ssl');
  }
}

module.exports = { ConfigStore };
