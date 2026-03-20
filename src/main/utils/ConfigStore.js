const Store = require('electron-store');
const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const { app } = require('electron');
const { getDataPath, getResourcesPath, getAppCachePath, getPortableRoot } = require('./PathResolver');

class ConfigStore {
  constructor() {
    try {
      const defaultData = this.getDefaults();
      this.resolvedDataPath = defaultData.dataPath;
      this.store = new Store({
        name: 'devbox-pro-config',
        defaults: defaultData,
        cwd: defaultData.dataPath
      });

      this.normalizeDataPath();

      // Ensure data directory exists
      const dataPath = this.getDataPath();
      try {
        fs.ensureDirSync(dataPath);
      } catch (err) {
        // Failed to create data directory - initialization may fail
      }
    } catch (err) {
      // Failed to initialize store - this is a critical error but we can't log to system yet
      // Create a fallback in-memory store
      this._fallbackData = this.getDefaults();
      this.resolvedDataPath = this._fallbackData.dataPath;
      this.store = null;
    }
  }

  normalizeDataPath() {
    if (!this.resolvedDataPath) {
      this.resolvedDataPath = this.getDefaults().dataPath;
    }

    if (!this.store) {
      if (this._fallbackData) {
        this._fallbackData.dataPath = this.resolvedDataPath;
      }
      return;
    }

    const storedDataPath = this.store.get('dataPath');
    if (storedDataPath !== this.resolvedDataPath) {
      this.store.set('dataPath', this.resolvedDataPath);
    }

    this.normalizeDefaultProjectsPath();
  }

  normalizeDefaultProjectsPath() {
    const normalizedProjectsPath = this.getNormalizedDefaultProjectsPath();
    if (!normalizedProjectsPath) {
      return;
    }

    if (!this.store) {
      if (this._fallbackData?.settings) {
        this._fallbackData.settings.defaultProjectsPath = normalizedProjectsPath;
      }
      return;
    }

    const currentProjectsPath = this.store.get('settings.defaultProjectsPath');
    if (currentProjectsPath !== normalizedProjectsPath) {
      this.store.set('settings.defaultProjectsPath', normalizedProjectsPath);
    }
  }

  isTestEnvironment() {
    return process.env.PLAYWRIGHT_TEST === 'true'
      || process.argv.includes('--playwright-e2e')
      || process.env.NODE_ENV === 'test'
      || process.env.VITEST === 'true';
  }

  getPlatformDefaultProjectsPath() {
    return process.platform === 'win32'
      ? 'C:/Projects'
      : path.join(os.homedir(), 'Projects');
  }

  getResolvedStandardProjectsPath() {
    if (this.isTestEnvironment()) {
      const baseDir = process.env.TEST_USER_DATA_DIR || os.tmpdir();
      return path.join(baseDir, '.devbox-pro-test', 'Projects');
    }

    return this.getPlatformDefaultProjectsPath();
  }

  getNormalizedDefaultProjectsPath() {
    const portableRoot = getPortableRoot(app);
    const currentProjectsPath = this.store
      ? this.store.get('settings.defaultProjectsPath')
      : this._fallbackData?.settings?.defaultProjectsPath;

    if (!portableRoot) {
      const standardProjectsPath = this.getResolvedStandardProjectsPath();
      const currentDataPath = this.getDataPath();
      const legacyDataProjectsPath = path.join(currentDataPath, 'Projects');

      if (!currentProjectsPath) {
        return standardProjectsPath;
      }

      if (currentProjectsPath === standardProjectsPath) {
        return standardProjectsPath;
      }

      if (currentProjectsPath === legacyDataProjectsPath) {
        return standardProjectsPath;
      }

      return currentProjectsPath;
    }

    const portableProjectsPath = path.join(portableRoot, 'Projects');

    if (!currentProjectsPath) {
      return portableProjectsPath;
    }

    if (currentProjectsPath === portableProjectsPath) {
      return portableProjectsPath;
    }

    const legacyPortableDefault = this.getPlatformDefaultProjectsPath();
    const defaultData = this.getDefaults();
    const legacyTestDefault = path.join(defaultData.dataPath, 'Projects');

    if (currentProjectsPath === legacyPortableDefault || currentProjectsPath === legacyTestDefault) {
      return portableProjectsPath;
    }

    return currentProjectsPath;
  }

  getDefaults() {
    let dataPath;
    let defaultProjectsPath;
    const portableRoot = getPortableRoot(app);
    const portableDataPath = portableRoot ? getDataPath(app) : null;

    // Accept both env var (set by test runner) and CLI arg (set by main.js from --playwright-e2e)
    const isTestEnv = this.isTestEnvironment();

    if (portableDataPath) {
      dataPath = portableDataPath;
      defaultProjectsPath = path.join(portableRoot, 'Projects');
    } else if (isTestEnv) {
      const baseDir = process.env.TEST_USER_DATA_DIR || os.tmpdir();
      dataPath = path.join(baseDir, '.devbox-pro-test');
      defaultProjectsPath = path.join(dataPath, 'Projects');
    } else {
      dataPath = getDataPath(app);
      defaultProjectsPath = this.getPlatformDefaultProjectsPath();
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
        postgresqlPort: 5432,
        mongodbPort: 27017,
        minioPort: 9000,
        minioConsolePort: 9001,
        memcachedPort: 11211,
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
    if (!this.resolvedDataPath) {
      this.resolvedDataPath = this.getDefaults().dataPath;
    }

    return this.resolvedDataPath;
  }

  getResourcesPath() {
    return getResourcesPath(app);
  }

  getAppCachePath(...segments) {
    return getAppCachePath(app, ...segments);
  }

  getBinaryConfigPath() {
    return this.getAppCachePath('binaries-config.json');
  }

  getCliPath() {
    return path.join(this.getDataPath(), 'cli');
  }

  getSshPath() {
    return path.join(this.getDataPath(), 'ssh');
  }

  getLogsPath() {
    return path.join(this.getDataPath(), 'logs');
  }

  getMysqlDataPath() {
    return path.join(this.getDataPath(), 'mysql', 'data');
  }

  getRedisDataPath() {
    return path.join(this.getDataPath(), 'redis');
  }

  getPostgresqlDataPath(version = '17') {
    return path.join(this.getDataPath(), 'postgresql', version, 'data');
  }

  getMongodbDataPath(version = '8.0') {
    return path.join(this.getDataPath(), 'mongodb', version, 'data');
  }

  getMinioDataPath() {
    return path.join(this.getDataPath(), 'minio', 'data');
  }

  getSslPath() {
    return path.join(this.getDataPath(), 'ssl');
  }
}

module.exports = { ConfigStore };
