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

const REMOTE_COMPATIBILITY_URL = 'https://raw.githubusercontent.com/JeffGepiga/DevBoxPro/main/config/compatibility.json';

class CompatibilityManager {
  constructor() {
    // Local config cache path
    this.localConfigPath = path.join(app.getPath('userData'), 'compatibility-config.json');

    // Remote config state
    this.remoteConfig = null;
    this.lastRemoteCheck = null;

    // Define built-in compatibility rules as fallback
    // These are used when remote config is unavailable
    this.builtInRules = [
      {
        id: 'php8-mysql57-auth',
        name: 'PHP 8.x + MySQL 5.7 Authentication',
        check: (config) => {
          const phpMajor = this.getMajorVersion(config.phpVersion);
          const mysqlVersion = config.services?.mysql;
          if (phpMajor >= 8 && mysqlVersion && this.compareVersions(mysqlVersion, '8.0') < 0) {
            return {
              level: 'warning',
              message: `MySQL ${mysqlVersion} uses legacy authentication (mysql_native_password). You may need to configure MySQL to use mysql_native_password for PHP ${config.phpVersion} compatibility.`,
              suggestion: 'Consider using MySQL 8.0+ or configure mysql_native_password in MySQL settings.',
            };
          }
          return null;
        },
      },
      {
        id: 'php74-mysql84-features',
        name: 'PHP 7.4 + MySQL 8.4 Features',
        check: (config) => {
          const phpMajor = this.getMajorVersion(config.phpVersion);
          const mysqlVersion = config.services?.mysql;
          if (phpMajor < 8 && mysqlVersion && this.compareVersions(mysqlVersion, '8.4') >= 0) {
            return {
              level: 'info',
              message: `Some MySQL 8.4 features may not be fully supported with PHP ${config.phpVersion}. Consider upgrading PHP for full compatibility.`,
              suggestion: 'Upgrade to PHP 8.x for best MySQL 8.4 compatibility.',
            };
          }
          return null;
        },
      },
      {
        id: 'mysql-mariadb-conflict',
        name: 'MySQL + MariaDB Port Conflict',
        check: (config) => {
          if (config.services?.mysql && config.services?.mariadb) {
            return {
              level: 'warning',
              message: 'Running both MySQL and MariaDB simultaneously may cause port conflicts. Each will use a different port automatically.',
              suggestion: 'DevBox Pro assigns different ports to each database version automatically.',
            };
          }
          return null;
        },
      },
      {
        id: 'legacy-php-modern-node',
        name: 'Legacy PHP + Modern Node.js',
        check: (config) => {
          const phpMajor = this.getMajorVersion(config.phpVersion);
          const nodeVersion = config.nodeVersion;
          if (phpMajor < 8 && nodeVersion && parseInt(nodeVersion) >= 20) {
            return {
              level: 'info',
              message: `Node.js ${nodeVersion} build tools are designed for modern workflows. Some older Laravel/PHP tools may expect older Node.js versions.`,
              suggestion: 'This is usually fine, but if you encounter build issues, try Node.js 18 or 16.',
            };
          }
          return null;
        },
      },
      {
        id: 'php74-deprecated',
        name: 'PHP 7.4 End of Life',
        check: (config) => {
          if (config.phpVersion === '7.4') {
            return {
              level: 'info',
              message: 'PHP 7.4 reached end-of-life in November 2022 and no longer receives security updates.',
              suggestion: 'Consider upgrading to PHP 8.x for security and performance improvements.',
            };
          }
          return null;
        },
      },
      {
        id: 'php80-deprecated',
        name: 'PHP 8.0 End of Life',
        check: (config) => {
          if (config.phpVersion === '8.0') {
            return {
              level: 'info',
              message: 'PHP 8.0 reached end-of-life in November 2023 and no longer receives security updates.',
              suggestion: 'Consider upgrading to PHP 8.1+ for security updates.',
            };
          }
          return null;
        },
      },
      {
        id: 'redis-php-extension',
        name: 'Redis PHP Extension',
        check: (config) => {
          if (config.services?.redis) {
            return {
              level: 'info',
              message: 'Make sure the PHP Redis extension (phpredis) is enabled in php.ini for your selected PHP version.',
              suggestion: 'Check Binary Manager to configure PHP extensions.',
            };
          }
          return null;
        },
      },
      {
        id: 'laravel-php-version',
        name: 'Laravel PHP Version Requirements',
        check: (config) => {
          if (config.type === 'laravel') {
            const phpVersion = parseFloat(config.phpVersion);
            // Laravel 11 requires PHP 8.2+
            if (phpVersion < 8.2) {
              return {
                level: 'warning',
                message: `Laravel 11 requires PHP 8.2 or higher. PHP ${config.phpVersion} will work with Laravel 10 or earlier.`,
                suggestion: 'Use PHP 8.2+ for Laravel 11, or PHP 8.1+ for Laravel 10.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'wordpress-php-version',
        name: 'WordPress PHP Version',
        check: (config) => {
          if (config.type === 'wordpress') {
            const phpVersion = parseFloat(config.phpVersion);
            if (phpVersion < 7.4) {
              return {
                level: 'warning',
                message: `WordPress recommends PHP 7.4 or higher. PHP ${config.phpVersion} may cause compatibility issues.`,
                suggestion: 'Upgrade to PHP 7.4+ for best WordPress compatibility.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'mariadb-mysql-syntax',
        name: 'MariaDB vs MySQL Syntax',
        check: (config) => {
          if (config.services?.mariadb && config.type === 'laravel') {
            return {
              level: 'info',
              message: 'MariaDB is MySQL-compatible but may have minor syntax differences in edge cases.',
              suggestion: 'Laravel works great with MariaDB. Just ensure your database driver is set correctly.',
            };
          }
          return null;
        },
      },
      {
        id: 'nginx-old-mysql84',
        name: 'Old Nginx + MySQL 8.4',
        check: (config) => {
          const nginxVersion = config.webServerVersion || config.services?.nginx;
          const mysqlVersion = config.services?.mysql;
          if (nginxVersion && mysqlVersion) {
            const nginx = parseFloat(nginxVersion);
            const mysql = parseFloat(mysqlVersion);
            if (nginx < 1.25 && mysql >= 8.4) {
              return {
                level: 'warning',
                message: `Nginx ${nginxVersion} may have connection handling issues with MySQL 8.4's improved connection protocol.`,
                suggestion: 'Consider upgrading to Nginx 1.26+ for better compatibility with MySQL 8.4.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'apache-old-mysql84',
        name: 'Old Apache + MySQL 8.4',
        check: (config) => {
          const apacheVersion = config.services?.apache || (config.webServer === 'apache' ? config.webServerVersion : null);
          const mysqlVersion = config.services?.mysql;
          if (apacheVersion && mysqlVersion) {
            const mysql = parseFloat(mysqlVersion);
            if (mysql >= 8.4) {
              return {
                level: 'info',
                message: `Apache works with MySQL 8.4 but newer Apache versions have better performance.`,
                suggestion: 'Consider updating Apache to 2.4.58+ for optimal performance with MySQL 8.4.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'nginx-old-php84',
        name: 'Old Nginx + PHP 8.4',
        check: (config) => {
          const nginxVersion = config.webServerVersion || config.services?.nginx;
          const phpVersion = parseFloat(config.phpVersion);
          if (nginxVersion && phpVersion >= 8.4) {
            const nginx = parseFloat(nginxVersion);
            if (nginx < 1.25) {
              return {
                level: 'info',
                message: `Nginx ${nginxVersion} works with PHP 8.4 but Nginx 1.26+ has better FastCGI handling.`,
                suggestion: 'Upgrade to Nginx 1.26+ for improved PHP-FPM performance and HTTP/2 support.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'nginx-mariadb-114',
        name: 'Old Nginx + MariaDB 11.4',
        check: (config) => {
          const nginxVersion = config.webServerVersion || config.services?.nginx;
          const mariadbVersion = config.services?.mariadb;
          if (nginxVersion && mariadbVersion) {
            const nginx = parseFloat(nginxVersion);
            const mariadb = parseFloat(mariadbVersion);
            if (nginx < 1.25 && mariadb >= 11.4) {
              return {
                level: 'info',
                message: `MariaDB 11.4 works with Nginx ${nginxVersion}, but newer Nginx versions offer better upstream handling.`,
                suggestion: 'Consider Nginx 1.26+ for improved connection pooling with MariaDB 11.4.',
              };
            }
          }
          return null;
        },
      },
      {
        id: 'php-postgresql-extension',
        name: 'PHP + PostgreSQL Extension',
        check: (config) => {
          if (config.services?.postgresql) {
            return {
              level: 'info',
              message: 'PostgreSQL requires the pgsql or pdo_pgsql PHP extension. Make sure it is enabled in your php.ini.',
              suggestion: 'Enable extension=pgsql and extension=pdo_pgsql in your PHP configuration.',
            };
          }
          return null;
        },
      },
      {
        id: 'php-mongodb-extension',
        name: 'PHP + MongoDB Extension',
        check: (config) => {
          if (config.services?.mongodb) {
            return {
              level: 'info',
              message: 'MongoDB requires the mongodb PHP extension (pecl). It is not included in the base PHP build.',
              suggestion: 'Install the extension with: pecl install mongodb, then add extension=mongodb.so to php.ini.',
            };
          }
          return null;
        },
      },
      {
        id: 'mongodb-avx-requirement',
        name: 'MongoDB 5.0+ AVX requirement',
        check: (config) => {
          const mongoVersion = config.services?.mongodbVersion || config.services?.mongodb;
          if (mongoVersion && parseFloat(mongoVersion) >= 5.0) {
            return {
              level: 'warning',
              message: `MongoDB ${mongoVersion} requires a CPU with AVX instructions. Older hardware (pre-2011) may not support this.`,
              suggestion: 'If MongoDB fails to start, your CPU may not support AVX. Use MongoDB 4.4 or earlier as a fallback.',
            };
          }
          return null;
        },
      },
      {
        id: 'python-windows-pip',
        name: 'Python Windows Embeddable + pip',
        check: (config) => {
          if (config.services?.python && process.platform === 'win32') {
            return {
              level: 'info',
              message: 'The Windows embeddable Python package requires manual pip setup. DevBox Pro enables import site automatically during download.',
              suggestion: 'pip should be available after installation. Run pip install --upgrade pip to ensure it is current.',
            };
          }
          return null;
        },
      },
    ];

    // Active rules (either from remote config or built-in)
    this.rules = [...this.builtInRules];

    // Remote config data
    this.deprecatedServices = {};
    this.frameworkRequirements = {};
    this.webServerRecommendations = {};
    this.databaseRecommendations = {};
    this.configVersion = 'built-in';
  }

  /**
   * Initialize the compatibility manager and load cached config
   */
  async initialize() {
    await this.loadCachedConfig();
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
        // Only mark as removed if it's not a built-in rule
        const isBuiltIn = this.builtInRules.some(b => b.id === rule.id);
        if (!isBuiltIn) {
          removedRules.push({ id: rule.id, name: rule.name });
        }
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
      // Convert remote rules to executable functions
      this.applyRemoteRules(this.remoteConfig);

      // Update metadata
      this.deprecatedServices = this.remoteConfig.deprecatedServices || {};
      this.frameworkRequirements = this.remoteConfig.frameworkRequirements || {};
      this.webServerRecommendations = this.remoteConfig.webServerRecommendations || {};
      this.databaseRecommendations = this.remoteConfig.databaseRecommendations || {};
      this.configVersion = this.remoteConfig.version;

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

    // Merge with built-in rules (built-in takes precedence for same ID)
    const builtInIds = new Set(this.builtInRules.map(r => r.id));
    const mergedRules = [...this.builtInRules];

    for (const rule of newRules) {
      if (!builtInIds.has(rule.id)) {
        mergedRules.push(rule);
      }
    }

    this.rules = mergedRules;
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
   * Get a value from config by key
   */
  getConfigValue(config, key) {
    switch (key) {
      case 'phpVersion':
        return config.phpVersion;
      case 'nodeVersion':
      case 'nodejs':
        return config.nodeVersion;
      case 'mysql':
        return config.services?.mysql;
      case 'mariadb':
        return config.services?.mariadb;
      case 'redis':
        return config.services?.redis;
      case 'nginx':
        return config.webServer === 'nginx' ? config.webServerVersion : config.services?.nginx;
      case 'apache':
        return config.webServer === 'apache' ? config.webServerVersion : config.services?.apache;
      case 'webServer':
        return config.webServer;
      case 'webServerVersion':
        return config.webServerVersion;
      case 'projectType':
        return config.type;
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

    // Handle version comparisons
    if (condition.min !== undefined || condition.max !== undefined) {
      if (!value) return false;

      const numValue = parseFloat(value);

      if (condition.min !== undefined) {
        const minValue = parseFloat(condition.min);
        if (numValue < minValue) return false;
      }

      if (condition.max !== undefined) {
        const maxValue = parseFloat(condition.max);
        if (numValue > maxValue) return false;
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
          this.applyRemoteRules(cachedData.config);
          this.deprecatedServices = cachedData.config.deprecatedServices || {};
          this.frameworkRequirements = cachedData.config.frameworkRequirements || {};
          this.webServerRecommendations = cachedData.config.webServerRecommendations || {};
          this.databaseRecommendations = cachedData.config.databaseRecommendations || {};
          this.configVersion = cachedData.config.version;

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
   * Get web server recommendations for a database version
   * @param {string} dbType - 'mysql' or 'mariadb'
   * @param {string} dbVersion - Database version
   * @returns {Object|null} Recommendations
   */
  getWebServerRecommendations(dbType, dbVersion) {
    return this.databaseRecommendations[dbType]?.[dbVersion] || null;
  }

  /**
   * Get general web server info
   * @param {string} webServer - 'nginx' or 'apache'
   * @returns {Object|null} Server info
   */
  getWebServerInfo(webServer) {
    return this.webServerRecommendations[webServer] || null;
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
    const warnings = [];
    const errors = [];

    for (const rule of this.rules) {
      try {
        const result = rule.check(config);
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
