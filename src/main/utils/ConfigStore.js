const Store = require('electron-store');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');

class ConfigStore {
  constructor() {
    try {
      const defaultData = this.getDefaults();
      this.store = new Store({
        name: 'devbox-pro-config',
        defaults: defaultData,
        cwd: defaultData.dataPath
      });

      // Ensure data directory exists
      const dataPath = this.get('dataPath');
      try {
        fs.ensureDirSync(dataPath);
      } catch (err) {
        // Failed to create data directory - initialization may fail
      }
    } catch (err) {
      // Failed to initialize store - this is a critical error but we can't log to system yet
      // Create a fallback in-memory store
      this._fallbackData = this.getDefaults();
      this.store = null;
    }
  }

  getDefaults() {
    let dataPath;
    let defaultProjectsPath;

    // Accept both env var (set by test runner) and CLI arg (set by main.js from --playwright-e2e)
    const isTestEnv = process.env.PLAYWRIGHT_TEST === 'true'
      || process.argv.includes('--playwright-e2e')
      || process.env.NODE_ENV === 'test'
      || process.env.VITEST === 'true';

    if (isTestEnv) {
      const baseDir = process.env.TEST_USER_DATA_DIR || os.tmpdir();
      dataPath = path.join(baseDir, '.devbox-pro-test');
      defaultProjectsPath = path.join(dataPath, 'Projects');
    } else {
      dataPath = path.join(os.homedir(), '.devbox-pro');
      defaultProjectsPath = process.platform === 'win32'
        ? 'C:/Projects'
        : path.join(os.homedir(), 'Projects');
    }

    return {
      dataPath,
      settings: {
        autoStartServices: true,
        autoStartOnLaunch: false,
        portRangeStart: 8000,
        sslEnabled: true,
        defaultPhpVersion: null,
        defaultEditor: 'vscode',
        customEditorCommand: '',
        theme: 'system',
        phpMyAdminPort: 8080,
        mailpitPort: 8025,
        mailpitSmtpPort: 1025,
        redisPort: 6379,
        mysqlPort: 3306,
        activeDatabaseType: 'mysql',
        dbUser: 'root',
        dbPassword: '',
        serverTimezone: 'UTC', // IANA timezone for PHP, MySQL, MariaDB
        defaultProjectsPath, // Platform-specific default
      },
      projects: [],
      phpVersions: {},
      certificates: {},
      recentProjects: [],
    };
  }

  get(key, defaultValue = undefined) {
    if (!this.store) {
      // Fallback mode
      const keys = key.split('.');
      let value = this._fallbackData;
      for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
          value = value[k];
        } else {
          return defaultValue;
        }
      }
      return value !== undefined ? value : defaultValue;
    }
    const value = this.store.get(key);
    return value !== undefined ? value : defaultValue;
  }

  set(key, value) {
    if (!this.store) {
      // Fallback mode - set in memory
      const keys = key.split('.');
      let obj = this._fallbackData;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!(keys[i] in obj)) obj[keys[i]] = {};
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return value;
    }
    this.store.set(key, value);
    return value;
  }

  delete(key) {
    if (!this.store) return;
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
