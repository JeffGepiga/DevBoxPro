const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const https = require('https');

const REMOTE_CONFIG_URL = 'https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/config/binaries.json';

module.exports = {
  isConfigMetadataNewer(candidateConfig, currentConfig) {
    if (!candidateConfig) {
      return false;
    }

    if (!currentConfig) {
      return true;
    }

    const candidateVersion = candidateConfig.version;
    const currentVersion = currentConfig.version;

    if (this.isVersionNewer(candidateVersion, currentVersion)) {
      return true;
    }

    if (this.isVersionNewer(currentVersion, candidateVersion)) {
      return false;
    }

    const candidateUpdatedAt = Date.parse(candidateConfig.lastUpdated || '');
    const currentUpdatedAt = Date.parse(currentConfig.lastUpdated || '');

    if (Number.isNaN(candidateUpdatedAt)) {
      return false;
    }

    if (Number.isNaN(currentUpdatedAt)) {
      return true;
    }

    return candidateUpdatedAt > currentUpdatedAt;
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
        currentVersion: this.configVersion,
        lastUpdated: remoteConfig.lastUpdated,
        updates,
        hasUpdates: isNewerVersion,
      };
    } catch (error) {
      this.managers?.log?.systemError('Error checking for updates', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  isVersionNewer(version1, version2) {
    if (!version1 || !version2 || version2 === 'built-in') return true;
    if (version1 === version2) return false;

    const v1Parts = version1.split('.').map((part) => parseInt(part, 10) || 0);
    const v2Parts = version2.split('.').map((part) => parseInt(part, 10) || 0);

    for (let index = 0; index < Math.max(v1Parts.length, v2Parts.length); index += 1) {
      const p1 = v1Parts[index] || 0;
      const p2 = v2Parts[index] || 0;
      if (p1 > p2) return true;
      if (p1 < p2) return false;
    }
    return false;
  },

  async fetchRemoteConfig() {
    return new Promise((resolve, reject) => {
      https.get(REMOTE_CONFIG_URL, {
        headers: { 'User-Agent': 'DevBoxPro' },
      }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: Failed to fetch config`));
          return;
        }

        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON in remote config'));
          }
        });
      }).on('error', reject);
    });
  },

  compareConfigs(remoteConfig) {
    const updates = [];
    const platform = this.getPlatform();

    for (const [serviceName, serviceData] of Object.entries(remoteConfig)) {
      if (serviceName === 'version' || serviceName === 'lastUpdated') continue;

      const currentService = this.downloads[serviceName];
      if (!currentService) continue;

      const remoteDownloads = serviceData.downloads || {};
      for (const [version, versionData] of Object.entries(remoteDownloads)) {
        const currentVersion = currentService[version];
        const remotePlatformData = versionData[platform] || versionData.all;

        if (!remotePlatformData || remotePlatformData.url === 'manual' || remotePlatformData.url === 'builtin') {
          continue;
        }

        if (!currentVersion) {
          updates.push({
            service: serviceName,
            version,
            type: 'new_version',
            label: versionData.label || null,
            newUrl: remotePlatformData.url,
            newFilename: remotePlatformData.filename,
          });
          continue;
        }

        const currentPlatformData = currentVersion[platform] || currentVersion.all;
        if (currentPlatformData && remotePlatformData.url !== currentPlatformData.url) {
          updates.push({
            service: serviceName,
            version,
            type: 'updated',
            label: versionData.label || currentVersion.label || null,
            oldFilename: currentPlatformData.filename,
            newFilename: remotePlatformData.filename,
            newUrl: remotePlatformData.url,
          });
        }
      }
    }

    return updates;
  },

  async applyUpdates() {
    if (!this.remoteConfig) {
      return { success: false, error: 'No remote config loaded. Run checkForUpdates first.' };
    }

    try {
      const appliedCount = await this.applyConfigToDownloads(this.remoteConfig);
      this.configVersion = this.remoteConfig.version;
      await this.saveCachedConfig(this.remoteConfig);
      return { success: true, appliedCount, version: this.configVersion };
    } catch (error) {
      this.managers?.log?.systemError('Error applying updates', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  async loadBundledConfig() {
    try {
      const appPath = app.getAppPath();
      const bundledConfigPath = path.join(appPath, 'config', 'binaries.json');

      if (await fs.pathExists(bundledConfigPath)) {
        const bundledConfig = await fs.readJson(bundledConfigPath);
        await this.applyConfigToDownloads(bundledConfig);
        this.configVersion = bundledConfig.version || 'bundled';
        return true;
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to load bundled binary config', { error: error.message });
    }
    return false;
  },

  async loadCachedConfig() {
    try {
      if (await fs.pathExists(this.localConfigPath)) {
        const cachedData = await fs.readJson(this.localConfigPath);
        if (cachedData && cachedData.config) {
          if (!this.isConfigMetadataNewer(cachedData.config, this.bundledConfig)) {
            return false;
          }

          this.remoteConfig = cachedData.config;
          this.configVersion = cachedData.config.version;
          await this.applyConfigToDownloads(cachedData.config);
          return true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Failed to load cached binary config', { error: error.message });
    }
    return false;
  },

  async saveCachedConfig(config) {
    try {
      const normalizedConfig = this.cloneDownloadConfig(config);
      const cacheData = {
        savedAt: new Date().toISOString(),
        config: normalizedConfig,
      };
      await fs.writeJson(this.localConfigPath, cacheData, { spaces: 2 });
      return true;
    } catch (error) {
      this.managers?.log?.systemError('Failed to save binary config cache', { error: error.message });
      return false;
    }
  },

  cloneDownloadConfig(config) {
    if (!config || typeof config !== 'object') {
      return config;
    }

    return JSON.parse(JSON.stringify(config));
  },

  async applyConfigToDownloads(config) {
    const normalizedConfig = this.cloneDownloadConfig(config);
    const platform = this.getPlatform();
    let appliedCount = 0;

    for (const [serviceName, serviceData] of Object.entries(normalizedConfig)) {
      if (serviceName === 'version' || serviceName === 'lastUpdated') continue;

      if (!this.downloads[serviceName]) {
        this.downloads[serviceName] = {};
      }

      const remoteDownloads = serviceData.downloads || {};
      for (const [version, versionData] of Object.entries(remoteDownloads)) {
        const remotePlatformData = versionData[platform] || versionData.all;

        if (!remotePlatformData || remotePlatformData.url === 'manual' || remotePlatformData.url === 'builtin') {
          continue;
        }

        if (!this.downloads[serviceName][version]) {
          this.downloads[serviceName][version] = {};
        }

        const targetKey = versionData.all ? 'all' : platform;
        this.downloads[serviceName][version][targetKey] = {
          url: remotePlatformData.url,
          filename: remotePlatformData.filename,
        };

        if (versionData.label) {
          this.downloads[serviceName][version].label = versionData.label;
        }

        appliedCount += 1;
      }

      if (serviceData.versions && Array.isArray(serviceData.versions)) {
        this.versionMeta[serviceName] = serviceData.versions;
      }
    }

    return appliedCount;
  },
};
