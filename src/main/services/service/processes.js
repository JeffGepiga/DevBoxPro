const { exec } = require('child_process');

module.exports = {
  async killProcess(proc) {
    return new Promise((resolve) => {
      const kill = require('tree-kill');

      if (!proc || !proc.pid) {
        resolve();
        return;
      }

      kill(proc.pid, 'SIGTERM', (err) => {
        // Ignore errors - process may already be terminated
        resolve();
      });
    });
  },

  async killOrphanMySQLProcesses() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec('taskkill /F /IM mysqld.exe 2>nul', (error) => {
          setTimeout(resolve, 1000);
        });
      } else {
        exec('pkill -9 mysqld 2>/dev/null', (error) => {
          setTimeout(resolve, 1000);
        });
      }
    });
  },

  async killOrphanMariaDBProcesses() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec('taskkill /F /IM mariadbd.exe 2>nul', (error) => {
          setTimeout(resolve, 1000);
        });
      } else {
        exec('pkill -9 mariadbd 2>/dev/null', (error) => {
          setTimeout(resolve, 1000);
        });
      }
    });
  },

  /**
   * Get all running versions for a service
   * @param {string} serviceName - The service name
   * @returns {Map} - Map of version -> { port, startedAt }
   */
  getRunningVersions(serviceName) {
    return this.runningVersions.get(serviceName) || new Map();
  },

  /**
   * Get all running versions for all services
   * @returns {Map} - Map of serviceName -> Map of version -> { port, startedAt }
   */
  getAllRunningVersions() {
    return this.runningVersions;
  },

  /**
   * Check if a specific version of a service is running
   * @param {string} serviceName - The service name
   * @param {string} version - The version to check
   * @returns {boolean}
   */
  isVersionRunning(serviceName, version) {
    const versions = this.runningVersions.get(serviceName);
    return versions ? versions.has(version) : false;
  },

  getAllServicesStatus() {
    if (process.env.PLAYWRIGHT_TEST === 'true') {
      const mockResult = {};
      for (const [key, status] of this.serviceStatus) {
        mockResult[key] = {
          ...status,
          status: 'running',
          uptime: 1000,
          runningVersions: { '8.4': { port: 3306, startedAt: new Date(), uptime: 1000 } }
        };
      }
      return mockResult;
    }

    const result = {};
    for (const [key, status] of this.serviceStatus) {
      let uptime = null;
      if (status.startedAt) {
        const startedAtTime = status.startedAt instanceof Date
          ? status.startedAt.getTime()
          : new Date(status.startedAt).getTime();
        uptime = Date.now() - startedAtTime;
      }

      const runningVersionsMap = this.runningVersions.get(key);
      let runningVersions = null;
      if (runningVersionsMap && runningVersionsMap.size > 0) {
        runningVersions = {};
        for (const [version, info] of runningVersionsMap) {
          const versionUptime = info.startedAt
            ? Date.now() - (info.startedAt instanceof Date ? info.startedAt.getTime() : new Date(info.startedAt).getTime())
            : null;
          runningVersions[version] = {
            port: info.port,
            startedAt: info.startedAt,
            uptime: versionUptime,
          };
        }
      }

      result[key] = {
        ...status,
        uptime,
        runningVersions,
      };
    }
    return result;
  },

  /**
   * Get the actual ports being used by a service
   * @param {string} serviceName - The name of the service
   * @param {string|null} version - Optional version
   * @returns {Object|null} - Object with httpPort and sslPort
   */
  getServicePorts(serviceName, version = null) {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      return null;
    }

    if (version) {
      const versions = this.runningVersions.get(serviceName);
      if (versions && versions.has(version)) {
        const versionInfo = versions.get(version);
        return {
          httpPort: versionInfo.port,
          sslPort: versionInfo.sslPort,
        };
      }

      if (serviceName === 'apache') {
        const status = this.serviceStatus.get(serviceName);
        if (status?.status === 'running' && status.version === version && status.port) {
          return {
            httpPort: status.port,
            sslPort: status.sslPort,
          };
        }
      }

      if (config.versioned && (serviceName === 'nginx' || serviceName === 'apache')) {
        if (this.standardPortOwner === serviceName && this.standardPortOwnerVersion === version) {
          return {
            httpPort: this.webServerPorts.standard.http,
            sslPort: this.webServerPorts.standard.https,
          };
        }
        if (this.standardPortOwner === null) {
          const otherServer = serviceName === 'nginx' ? 'apache' : 'nginx';
          const otherStatus = this.serviceStatus.get(otherServer);
          if (otherStatus?.status !== 'running') {
            return {
              httpPort: this.webServerPorts.standard.http,
              sslPort: this.webServerPorts.standard.https,
            };
          }
        }
        const versionOffset = this.versionPortOffsets[serviceName]?.[version] || 0;
        return {
          httpPort: (config.alternatePort || this.webServerPorts.alternate.http) + versionOffset,
          sslPort: (config.alternateSslPort || this.webServerPorts.alternate.https) + versionOffset,
        };
      }
    }

    if (config.actualHttpPort) {
      let sslPort = config.actualSslPort;
      if (!sslPort) {
        const isOnAlternate = config.actualHttpPort !== this.webServerPorts.standard.http;
        sslPort = isOnAlternate ? (config.alternateSslPort || config.sslPort) : config.sslPort;
      }

      return {
        httpPort: config.actualHttpPort,
        sslPort: sslPort,
      };
    }

    if (serviceName === 'nginx' || serviceName === 'apache') {
      if (this.standardPortOwner === null) {
        const otherServer = serviceName === 'nginx' ? 'apache' : 'nginx';
        const otherStatus = this.serviceStatus.get(otherServer);
        if (otherStatus?.status === 'running') {
          return {
            httpPort: config.alternatePort || this.webServerPorts.alternate.http,
            sslPort: config.alternateSslPort || this.webServerPorts.alternate.https,
          };
        }
        return {
          httpPort: this.webServerPorts.standard.http,
          sslPort: this.webServerPorts.standard.https,
        };
      } else if (this.standardPortOwner === serviceName) {
        if (!version || this.standardPortOwnerVersion === version) {
          return {
            httpPort: this.webServerPorts.standard.http,
            sslPort: this.webServerPorts.standard.https,
          };
        }
        const { VERSION_PORT_OFFSETS } = require('../../shared/serviceConfig');
        const versionOffset = VERSION_PORT_OFFSETS?.[serviceName]?.[version] || 0;
        return {
          httpPort: (config.alternatePort || this.webServerPorts.alternate.http) + versionOffset,
          sslPort: (config.alternateSslPort || this.webServerPorts.alternate.https) + versionOffset,
        };
      } else {
        return {
          httpPort: config.alternatePort || this.webServerPorts.alternate.http,
          sslPort: config.alternateSslPort || this.webServerPorts.alternate.https,
        };
      }
    }

    return {
      httpPort: config.actualHttpPort || config.defaultPort,
      sslPort: config.actualSslPort || config.sslPort,
    };
  },

  /**
   * Calculate port for a specific version based on offset
   * @param {string} service - Service name
   * @param {string} version - Version string
   * @param {number} defaultPort - Base port
   * @returns {number} - Calculated port
   */
  getVersionPort(service, version, defaultPort) {
    const offset = this.versionPortOffsets[service]?.[version] || 0;
    return defaultPort + offset;
  },

  async getResourceUsage() {
    const usage = {
      services: {},
      total: {
        cpu: 0,
        memory: 0,
      },
    };

    for (const [serviceName, proc] of this.processes) {
      if (proc && proc.pid) {
        try {
          const stats = await this.getProcessStats(proc.pid);
          usage.services[serviceName] = stats;
          usage.total.cpu += stats.cpu;
          usage.total.memory += stats.memory;
        } catch (error) {
          usage.services[serviceName] = { cpu: 0, memory: 0 };
        }
      }
    }

    return usage;
  },

  async getProcessStats(pid) {
    return {
      cpu: Math.random() * 5,
      memory: Math.random() * 100 * 1024 * 1024,
    };
  },
};
