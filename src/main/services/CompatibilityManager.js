/**
 * CompatibilityManager - Validates service version compatibility
 * 
 * Checks for known compatibility issues between different service versions
 * and provides warnings (not blockers) to help users make informed decisions.
 * 
 * Supports remote config updates from GitHub for keeping rules current.
 */

const https = require('https');
const fs = require('fs-extra');
const path = require('path');
const { app } = require('electron');
const { getAppCachePath } = require('../utils/PathResolver');

const REMOTE_COMPATIBILITY_URL = 'https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/config/compatibility.json';

class CompatibilityManager {
  constructor() {
    // Local config cache path
    this.localConfigPath = getAppCachePath(app, 'compatibility-config.json');

    // Remote config state
    this.remoteConfig = null;
    this.lastRemoteCheck = null;

    // Active rules come from the bundled compatibility config and may later be
    // overridden by a cached remote config.
    this.rules = [];

    // Remote config data
    this.deprecatedServices = {};
    this.frameworkRequirements = {};
    this.webServerRecommendations = {};
    this.databaseRecommendations = {};
    this.configVersion = 'uninitialized';

    this.loadBundledConfigSync();
  }

  /**
   * Initialize the compatibility manager and load cached config
   */
  async initialize() {
    if (this.rules.length === 0) {
      await this.loadBundledConfig();
    }
    await this.loadCachedConfig();
  }

  getBundledConfigPath() {
    const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    return path.join(appPath, 'config', 'compatibility.json');
  }

  loadBundledConfigSync() {
    try {
      const bundledConfigPath = this.getBundledConfigPath();

      if (fs.pathExistsSync(bundledConfigPath)) {
        const bundledConfig = fs.readJsonSync(bundledConfigPath);
        this.applyConfigData(bundledConfig, bundledConfig.version || 'bundled');
        return true;
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to synchronously load bundled compatibility config', { error: error.message });
    }

    return false;
  }

  /**
   * Load bundled config/compatibility.json from the app directory.
   * This is the service-owned source of truth before any cached remote override.
   */
  async loadBundledConfig() {
    try {
      const bundledConfigPath = this.getBundledConfigPath();

      if (await fs.pathExists(bundledConfigPath)) {
        const bundledConfig = await fs.readJson(bundledConfigPath);
        this.applyConfigData(bundledConfig, bundledConfig.version || 'bundled');
        return true;
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to load bundled compatibility config', { error: error.message });
    }

    return false;
  }

  /**
   * Check for rule updates from remote GitHub config
   */
  async checkForUpdates() {
    try {
      // Checking for compatibility rule updates

      const remoteConfig = await this.fetchRemoteConfig();
      if (!remoteConfig) {
        return { success: false, error: 'Failed to fetch remote config' };
      }

      this.remoteConfig = remoteConfig;
      this.lastRemoteCheck = new Date().toISOString();

      // Compare versions - if same version, no updates needed
      const isNewerVersion = this.isVersionNewer(remoteConfig.version, this.configVersion);

      // Compare with current config for details
      const updates = this.compareConfigs(remoteConfig);

      return {
        success: true,
        configVersion: remoteConfig.version,
        lastUpdated: remoteConfig.lastUpdated,
        currentVersion: this.configVersion,
        updates,
        // Only show updates if remote version is newer than current
        hasUpdates: isNewerVersion
      };
    } catch (error) {
      this.managers?.log?.systemError('Error checking for compatibility updates', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Check if version1 is newer than version2 (semver comparison)
   */
  isVersionNewer(version1, version2) {
    if (!version1 || !version2 || version2 === 'built-in') return true;
    if (version1 === version2) return false;

    const v1Parts = version1.split('.').map(p => parseInt(p, 10) || 0);
    const v2Parts = version2.split('.').map(p => parseInt(p, 10) || 0);

    for (let i = 0; i < Math.max(v1Parts.length, v2Parts.length); i++) {
      const p1 = v1Parts[i] || 0;
      const p2 = v2Parts[i] || 0;
      if (p1 > p2) return true;
      if (p1 < p2) return false;
    }
    return false;
  }

  /**
   * Fetch remote config JSON from GitHub
   */
  async fetchRemoteConfig() {
    return new Promise((resolve, reject) => {
      https.get(REMOTE_COMPATIBILITY_URL, {
        headers: { 'User-Agent': 'DevBoxPro' }
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: Failed to fetch compatibility config`));
          return;
        }

        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const config = JSON.parse(data);
            resolve(config);
          } catch (e) {
            reject(new Error('Invalid JSON in remote compatibility config'));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Compare remote config with current rules
   */
  compareConfigs(remoteConfig) {
    const currentRuleIds = new Set(this.rules.map(r => r.id));
    const remoteRuleIds = new Set(remoteConfig.rules?.map(r => r.id) || []);

    const newRules = [];
    const updatedRules = [];
    const removedRules = [];

    // Find new and potentially updated rules
    for (const rule of (remoteConfig.rules || [])) {
      if (!currentRuleIds.has(rule.id)) {
        newRules.push({ id: rule.id, name: rule.name });
      } else {
        // Mark as updated if it exists (we can't easily diff the check function)
        updatedRules.push({ id: rule.id, name: rule.name });
      }
    }

    // Find removed rules (rules that exist locally but not in remote)
    for (const rule of this.rules) {
      if (!remoteRuleIds.has(rule.id)) {
        removedRules.push({ id: rule.id, name: rule.name });
      }
    }

    return {
      newRules,
      updatedRules,
      removedRules,
      versionChange: remoteConfig.version !== this.configVersion
    };
  }

  /**
   * Apply remote config updates
   */
  async applyUpdates() {
    if (!this.remoteConfig) {
      return { success: false, error: 'No remote config loaded. Run checkForUpdates first.' };
    }

    try {
      this.applyConfigData(this.remoteConfig, this.remoteConfig.version);

      // Save to local cache
      await this.saveCachedConfig(this.remoteConfig);

      const ruleCount = this.rules.length;
      // Compatibility rules applied

      return { success: true, ruleCount, version: this.configVersion };
    } catch (error) {
      this.managers?.log?.systemError('Error applying compatibility updates', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Convert JSON rules to executable check functions
   */
  applyRemoteRules(config) {
    const newRules = [];

    for (const rule of (config.rules || [])) {
      if (!rule.enabled) continue;

      newRules.push({
        id: rule.id,
        name: rule.name,
        check: this.createRuleChecker(rule)
      });
    }

    this.rules = newRules;
  }

  applyConfigData(config, version = config?.version || 'bundled') {
    this.applyRemoteRules(config);
    this.deprecatedServices = config.deprecatedServices || {};
    this.frameworkRequirements = config.frameworkRequirements || {};
    this.webServerRecommendations = config.webServerRecommendations || {};
    this.databaseRecommendations = config.databaseRecommendations || {};
    this.configVersion = version;
  }

  /**
   * Create a check function from JSON rule definition
   */
  createRuleChecker(rule) {
    return (config) => {
      const conditions = rule.conditions || {};
      let allConditionsMet = true;

      // Check each condition
      for (const [key, condition] of Object.entries(conditions)) {
        const value = this.getConfigValue(config, key);

        if (!this.evaluateCondition(value, condition)) {
          allConditionsMet = false;
          break;
        }
      }

      if (allConditionsMet) {
        return {
          level: rule.result.level,
          message: this.interpolateMessage(rule.result.message, config),
          suggestion: rule.result.suggestion
        };
      }

      return null;
    };
  }

  /**
   * Normalize compatibility config so callers can pass either saved-project
   * shape or flattened UI payloads.
   */
  normalizeConfig(config = {}) {
    const services = { ...(config.services || {}) };
    const projectType = config.type || config.projectType;

    const getServiceVersion = (serviceName) => {
      const flatVersionKey = `${serviceName}Version`;

      if (config[flatVersionKey] !== undefined && config[flatVersionKey] !== null) {
        return config[flatVersionKey];
      }

      if (services[flatVersionKey] !== undefined && services[flatVersionKey] !== null) {
        return services[flatVersionKey];
      }

      if (typeof services[serviceName] === 'string') {
        return services[serviceName];
      }

      return null;
    };

    for (const serviceName of ['mysql', 'mariadb', 'redis', 'postgresql', 'mongodb', 'python', 'memcached', 'minio']) {
      const version = getServiceVersion(serviceName);
      if (version !== null) {
        services[serviceName] = version;
      }
    }

    return {
      ...config,
      type: projectType,
      projectType: config.projectType || config.type,
      nodeVersion: config.nodeVersion || config.nodejsVersion || getServiceVersion('nodejs'),
      frameworkVersion: config.frameworkVersion || config.projectVersion || this.getFreshFrameworkVersion(projectType, config.installFresh),
      services,
    };
  }

  getFreshFrameworkVersion(projectType, installFresh) {
    if (!installFresh || !projectType) {
      return null;
    }

    const knownVersions = this.frameworkRequirements?.[projectType];
    const configuredVersions = knownVersions ? Object.keys(knownVersions) : [];

    if (configuredVersions.length > 0) {
      return configuredVersions.sort((left, right) => this.compareVersions(right, left))[0];
    }

    return null;
  }

  /**
   * Get a value from config by key
   */
  getConfigValue(config, key) {
    switch (key) {
      case 'phpVersion':
        return config.phpVersion;
      case 'nodeVersion':
      case 'nodejs':
        return config.nodeVersion || config.nodejsVersion;
      case 'mysql':
        return config.services?.mysql || config.mysqlVersion;
      case 'mariadb':
        return config.services?.mariadb || config.mariadbVersion;
      case 'redis':
        return config.services?.redis || config.redisVersion;
      case 'postgresql':
        return config.services?.postgresql || config.postgresqlVersion;
      case 'mongodb':
        return config.services?.mongodb || config.mongodbVersion;
      case 'python':
        return config.services?.python || config.pythonVersion;
      case 'nginx':
        return config.webServer === 'nginx' ? config.webServerVersion : config.services?.nginx;
      case 'apache':
        return config.webServer === 'apache' ? config.webServerVersion : config.services?.apache;
      case 'webServer':
        return config.webServer;
      case 'webServerVersion':
        return config.webServerVersion;
      case 'projectType':
        return config.type || config.projectType;
      case 'frameworkVersion':
        return config.frameworkVersion || config.projectVersion;
      default:
        return config[key] || config.services?.[key];
    }
  }

  /**
   * Evaluate a condition against a value
   */
  evaluateCondition(value, condition) {
    // Handle "any" condition (just check if value exists)
    if (condition.any === true) {
      return value !== null && value !== undefined;
    }

    // Handle exact match
    if (condition.exact !== undefined) {
      return value === condition.exact;
    }

    // Handle explicit version comparisons
    if (
      condition.gt !== undefined
      || condition.gte !== undefined
      || condition.lt !== undefined
      || condition.lte !== undefined
    ) {
      if (!value) return false;

      if (condition.gt !== undefined && this.compareVersions(value, condition.gt) <= 0) {
        return false;
      }

      if (condition.gte !== undefined && this.compareVersions(value, condition.gte) < 0) {
        return false;
      }

      if (condition.lt !== undefined && this.compareVersions(value, condition.lt) >= 0) {
        return false;
      }

      if (condition.lte !== undefined && this.compareVersions(value, condition.lte) > 0) {
        return false;
      }

      return true;
    }

    // Handle version comparisons
    if (condition.min !== undefined || condition.max !== undefined) {
      if (!value) return false;

      if (condition.min !== undefined) {
        if (this.compareVersions(value, condition.min) < 0) return false;
      }

      if (condition.max !== undefined) {
        if (this.compareVersions(value, condition.max) > 0) return false;
      }

      return true;
    }

    return false;
  }

  /**
   * Interpolate placeholders in message strings
   */
  interpolateMessage(message, config) {
    const nginxVersion = config.webServer === 'nginx' ? config.webServerVersion : config.services?.nginx;
    const apacheVersion = config.webServer === 'apache' ? config.webServerVersion : config.services?.apache;

    return message
      .replace('{phpVersion}', config.phpVersion || '')
      .replace('{nodeVersion}', config.nodeVersion || '')
      .replace('{mysqlVersion}', config.services?.mysql || '')
      .replace('{mariadbVersion}', config.services?.mariadb || '')
      .replace('{redisVersion}', config.services?.redis || '')
      .replace('{nginxVersion}', nginxVersion || '')
      .replace('{apacheVersion}', apacheVersion || '')
      .replace('{webServer}', config.webServer || '')
      .replace('{webServerVersion}', config.webServerVersion || '')
      .replace('{projectType}', config.type || '');
  }

  /**
   * Load cached config from local storage
   */
  async loadCachedConfig() {
    try {
      if (await fs.pathExists(this.localConfigPath)) {
        const cachedData = await fs.readJson(this.localConfigPath);

        if (cachedData && cachedData.config) {
          // Loading cached compatibility config

          this.remoteConfig = cachedData.config;
          this.applyConfigData(cachedData.config, cachedData.config.version);

          return true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to load cached compatibility config', { error: error.message });
    }
    return false;
  }

  /**
   * Save config to local cache
   */
  async saveCachedConfig(config) {
    try {
      const cacheData = {
        savedAt: new Date().toISOString(),
        config: config
      };
      await fs.writeJson(this.localConfigPath, cacheData, { spaces: 2 });
      // Saved compatibility config to cache
      return true;
    } catch (error) {
      this.managers?.log?.systemError('Failed to save compatibility config cache', { error: error.message });
      return false;
    }
  }

  /**
   * Get deprecation info for a service version
   */
  getDeprecationInfo(service, version) {
    return this.deprecatedServices[service]?.[version] || null;
  }

  /**
   * Get framework requirements
   */
  getFrameworkRequirements(framework, version) {
    return this.frameworkRequirements[framework]?.[version] || null;
  }

  /**
   * Get current config version info
   */
  getConfigInfo() {
    return {
      version: this.configVersion,
      ruleCount: this.rules.length,
      lastCheck: this.lastRemoteCheck,
      hasRemoteConfig: this.remoteConfig !== null
    };
  }

  /**
   * Check configuration for compatibility issues
   * @param {Object} config - Project configuration
   * @param {string} config.phpVersion - PHP version (e.g., '8.3')
   * @param {string} config.type - Project type (e.g., 'laravel', 'wordpress')
   * @param {string} config.nodeVersion - Node.js version (e.g., '20')
   * @param {string} config.webServer - Web server type ('nginx' or 'apache')
   * @param {string} config.webServerVersion - Web server version
   * @param {Object} config.services - Services configuration
   * @param {string} config.services.mysql - MySQL version or null
   * @param {string} config.services.mariadb - MariaDB version or null
   * @param {string} config.services.redis - Redis version or null
   * @returns {Object} - { valid: boolean, warnings: Array, errors: Array }
   */
  checkCompatibility(config) {
    const normalizedConfig = this.normalizeConfig(config);
    const warnings = [];
    const errors = [];

    for (const rule of this.rules) {
      try {
        const result = rule.check(normalizedConfig);
        if (result) {
          const item = {
            id: rule.id,
            name: rule.name,
            level: result.level,
            message: result.message,
            suggestion: result.suggestion,
          };

          if (result.level === 'error') {
            errors.push(item);
          } else {
            warnings.push(item);
          }
        }
      } catch (error) {
        this.managers?.log?.systemWarn(`Error checking rule ${rule.id}`, { error: error.message });
      }
    }

    return {
      valid: errors.length === 0,
      warnings,
      errors,
      hasIssues: warnings.length > 0 || errors.length > 0,
    };
  }

  /**
   * Get major version number from version string
   * @param {string} version - Version string (e.g., '8.3', '8.0.30')
   * @returns {number} - Major version number
   */
  getMajorVersion(version) {
    if (!version) return 0;
    const parts = version.toString().split('.');
    return parseInt(parts[0], 10) || 0;
  }

  /**
   * Compare two version strings
   * @param {string} v1 - First version
   * @param {string} v2 - Second version
   * @returns {number} - -1 if v1 < v2, 0 if equal, 1 if v1 > v2
   */
  compareVersions(v1, v2) {
    if (!v1 || !v2) return 0;

    const parts1 = v1.toString().split('.').map(p => parseInt(p, 10) || 0);
    const parts2 = v2.toString().split('.').map(p => parseInt(p, 10) || 0);

    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;

      if (p1 < p2) return -1;
      if (p1 > p2) return 1;
    }

    return 0;
  }

  /**
   * Get all compatibility rules (for UI display)
   * @returns {Array} - List of rule definitions
   */
  getRules() {
    return this.rules.map(rule => ({
      id: rule.id,
      name: rule.name,
    }));
  }

  /**
   * Quick check if a specific combination has known issues
   * @param {string} phpVersion - PHP version
   * @param {string} dbType - Database type ('mysql' or 'mariadb')
   * @param {string} dbVersion - Database version
   * @returns {boolean} - True if there are known issues
   */
  hasKnownIssues(phpVersion, dbType, dbVersion) {
    const config = {
      phpVersion,
      services: {
        [dbType]: dbVersion,
      },
    };

    const result = this.checkCompatibility(config);
    return result.warnings.some(w => w.level === 'warning') || result.errors.length > 0;
  }
}

module.exports = CompatibilityManager;
