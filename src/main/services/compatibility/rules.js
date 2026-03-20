module.exports = {
  applyRemoteRules(config) {
    const newRules = [];

    for (const rule of (config.rules || [])) {
      if (!rule.enabled) {
        continue;
      }

      newRules.push({
        id: rule.id,
        name: rule.name,
        check: this.createRuleChecker(rule),
      });
    }

    this.rules = newRules;
  },

  createRuleChecker(rule) {
    return (config) => {
      const conditions = rule.conditions || {};
      let allConditionsMet = true;

      for (const [key, condition] of Object.entries(conditions)) {
        const value = this.getConfigValue(config, key);

        if (!this.evaluateCondition(value, condition)) {
          allConditionsMet = false;
          break;
        }
      }

      if (!allConditionsMet) {
        return null;
      }

      return {
        level: rule.result.level,
        message: this.interpolateMessage(rule.result.message, config),
        suggestion: rule.result.suggestion,
      };
    };
  },

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
  },

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
  },

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
  },

  evaluateCondition(value, condition) {
    if (condition.any === true) {
      return value !== null && value !== undefined;
    }

    if (condition.exact !== undefined) {
      return value === condition.exact;
    }

    if (
      condition.gt !== undefined
      || condition.gte !== undefined
      || condition.lt !== undefined
      || condition.lte !== undefined
    ) {
      if (!value) {
        return false;
      }

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

    if (condition.min !== undefined || condition.max !== undefined) {
      if (!value) {
        return false;
      }

      if (condition.min !== undefined && this.compareVersions(value, condition.min) < 0) {
        return false;
      }
      if (condition.max !== undefined && this.compareVersions(value, condition.max) > 0) {
        return false;
      }

      return true;
    }

    return false;
  },

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
  },

  checkCompatibility(config) {
    const normalizedConfig = this.normalizeConfig(config);
    const warnings = [];
    const errors = [];

    for (const rule of this.rules) {
      try {
        const result = rule.check(normalizedConfig);
        if (!result) {
          continue;
        }

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
  },

  getMajorVersion(version) {
    if (!version) {
      return 0;
    }
    const parts = version.toString().split('.');
    return parseInt(parts[0], 10) || 0;
  },

  compareVersions(v1, v2) {
    if (!v1 || !v2) {
      return 0;
    }

    const parts1 = v1.toString().split('.').map((part) => parseInt(part, 10) || 0);
    const parts2 = v2.toString().split('.').map((part) => parseInt(part, 10) || 0);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let index = 0; index < maxLen; index++) {
      const p1 = parts1[index] || 0;
      const p2 = parts2[index] || 0;

      if (p1 < p2) {
        return -1;
      }
      if (p1 > p2) {
        return 1;
      }
    }

    return 0;
  },

  hasKnownIssues(phpVersion, dbType, dbVersion) {
    const config = {
      phpVersion,
      services: {
        [dbType]: dbVersion,
      },
    };

    const result = this.checkCompatibility(config);
    return result.warnings.some((warning) => warning.level === 'warning') || result.errors.length > 0;
  },
};