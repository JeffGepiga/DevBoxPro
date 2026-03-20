const https = require('https');
const fs = require('fs-extra');

const REMOTE_COMPATIBILITY_URL = 'https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/config/compatibility.json';

module.exports = {
  async initialize() {
    if (this.rules.length === 0) {
      await this.loadBundledConfig();
    }
    await this.loadCachedConfig();
  },

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
  },

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
  },

  async checkForUpdates() {
    try {
      const remoteConfig = await this.fetchRemoteConfig();
      if (!remoteConfig) {
        return { success: false, error: 'Failed to fetch remote config' };
      }

      this.remoteConfig = remoteConfig;
      this.lastRemoteCheck = new Date().toISOString();

      const isNewerVersion = this.isVersionNewer(remoteConfig.version, this.configVersion);
      const updates = this.compareConfigs(remoteConfig);

      return {
        success: true,
        configVersion: remoteConfig.version,
        lastUpdated: remoteConfig.lastUpdated,
        currentVersion: this.configVersion,
        updates,
        hasUpdates: isNewerVersion,
      };
    } catch (error) {
      this.managers?.log?.systemError('Error checking for compatibility updates', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  isVersionNewer(version1, version2) {
    if (!version1 || !version2 || version2 === 'built-in') {
      return true;
    }
    if (version1 === version2) {
      return false;
    }

    const v1Parts = version1.split('.').map((part) => parseInt(part, 10) || 0);
    const v2Parts = version2.split('.').map((part) => parseInt(part, 10) || 0);

    for (let index = 0; index < Math.max(v1Parts.length, v2Parts.length); index++) {
      const p1 = v1Parts[index] || 0;
      const p2 = v2Parts[index] || 0;
      if (p1 > p2) {
        return true;
      }
      if (p1 < p2) {
        return false;
      }
    }

    return false;
  },

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
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(new Error('Invalid JSON in remote compatibility config'));
          }
        });
      }).on('error', reject);
    });
  },

  compareConfigs(remoteConfig) {
    const currentRuleIds = new Set(this.rules.map((rule) => rule.id));
    const remoteRuleIds = new Set(remoteConfig.rules?.map((rule) => rule.id) || []);

    const newRules = [];
    const updatedRules = [];
    const removedRules = [];

    for (const rule of (remoteConfig.rules || [])) {
      if (!currentRuleIds.has(rule.id)) {
        newRules.push({ id: rule.id, name: rule.name });
      } else {
        updatedRules.push({ id: rule.id, name: rule.name });
      }
    }

    for (const rule of this.rules) {
      if (!remoteRuleIds.has(rule.id)) {
        removedRules.push({ id: rule.id, name: rule.name });
      }
    }

    return {
      newRules,
      updatedRules,
      removedRules,
      versionChange: remoteConfig.version !== this.configVersion,
    };
  },

  async applyUpdates() {
    if (!this.remoteConfig) {
      return { success: false, error: 'No remote config loaded. Run checkForUpdates first.' };
    }

    try {
      this.applyConfigData(this.remoteConfig, this.remoteConfig.version);
      await this.saveCachedConfig(this.remoteConfig);

      return { success: true, ruleCount: this.rules.length, version: this.configVersion };
    } catch (error) {
      this.managers?.log?.systemError('Error applying compatibility updates', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  applyConfigData(config, version = config?.version || 'bundled') {
    this.applyRemoteRules(config);
    this.deprecatedServices = config.deprecatedServices || {};
    this.frameworkRequirements = config.frameworkRequirements || {};
    this.webServerRecommendations = config.webServerRecommendations || {};
    this.databaseRecommendations = config.databaseRecommendations || {};
    this.configVersion = version;
  },

  async loadCachedConfig() {
    try {
      if (await fs.pathExists(this.localConfigPath)) {
        const cachedData = await fs.readJson(this.localConfigPath);

        if (cachedData && cachedData.config) {
          this.remoteConfig = cachedData.config;
          this.applyConfigData(cachedData.config, cachedData.config.version);
          return true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to load cached compatibility config', { error: error.message });
    }
    return false;
  },

  async saveCachedConfig(config) {
    try {
      const cacheData = {
        savedAt: new Date().toISOString(),
        config,
      };
      await fs.writeJson(this.localConfigPath, cacheData, { spaces: 2 });
      return true;
    } catch (error) {
      this.managers?.log?.systemError('Failed to save compatibility config cache', { error: error.message });
      return false;
    }
  },

  getDeprecationInfo(service, version) {
    return this.deprecatedServices[service]?.[version] || null;
  },

  getFrameworkRequirements(framework, version) {
    return this.frameworkRequirements[framework]?.[version] || null;
  },

  getConfigInfo() {
    return {
      version: this.configVersion,
      ruleCount: this.rules.length,
      lastCheck: this.lastRemoteCheck,
      hasRemoteConfig: this.remoteConfig !== null,
    };
  },

  getRules() {
    return this.rules.map((rule) => ({
      id: rule.id,
      name: rule.name,
    }));
  },
};