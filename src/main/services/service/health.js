module.exports = {
  async waitForService(serviceName, timeout) {
    const config = this.serviceConfigs[serviceName];
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const healthy = await config.healthCheck();
        if (healthy) {
          return true;
        }
      } catch (error) {
        // Service not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`${config.name} failed to start within ${timeout}ms`);
  },

  /**
   * Retry-aware wrapper around waitForService.
   * If the service process is still alive after a timeout, extends the wait
   * rather than failing immediately. This handles slow devices where binaries
   * need more time for disk-heavy initialization.
   *
   * @param {string} serviceName
   * @param {number} timeoutMs   – per-attempt timeout
   * @param {Object} [options]
   * @param {number} [options.maxRetries=1]          – extra attempts after the first
   * @param {string|null} [options.version=null]     – version string for process key lookup
   */
  async waitForServiceWithRetry(serviceName, timeoutMs, options = {}) {
    const { maxRetries = 1, version = null } = options;
    const config = this.serviceConfigs[serviceName];
    const label = version ? `${config.name} ${version}` : config.name;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.waitForService(serviceName, timeoutMs);
        return true;
      } catch (error) {
        if (attempt < maxRetries) {
          // Check if the spawned process is still alive — if so, the binary is
          // just slow (e.g. InnoDB init on a spinning disk) and deserves more time.
          const processKey = this.getProcessKey(serviceName, version);
          const proc = this.processes.get(processKey);
          const processStillAlive = proc && !proc.killed && proc.exitCode === null;

          if (processStillAlive) {
            this.managers.log?.systemWarn(
              `${label} not ready after ${timeoutMs}ms (attempt ${attempt + 1}/${maxRetries + 1}), process still alive — extending wait...`
            );
            continue;
          }
        }

        throw error;
      }
    }
  },

  async checkNginxHealth() {
    const port = this.serviceConfigs.nginx.actualHttpPort || this.serviceConfigs.nginx.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkApacheHealth() {
    const port = this.serviceConfigs.apache.actualHttpPort || this.serviceConfigs.apache.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkMySqlHealth() {
    const port = this.serviceConfigs.mysql.actualPort || this.serviceConfigs.mysql.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkMariaDbHealth() {
    const port = this.serviceConfigs.mariadb.actualPort || this.serviceConfigs.mariadb.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkRedisHealth() {
    const port = this.serviceConfigs.redis.actualPort || this.serviceConfigs.redis.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkMailpitHealth() {
    const port = this.serviceConfigs.mailpit.actualPort || this.serviceConfigs.mailpit.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkPhpMyAdminHealth() {
    const port = this.serviceConfigs.phpmyadmin.actualPort || this.serviceConfigs.phpmyadmin.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkPostgresqlHealth() {
    const port = this.serviceConfigs.postgresql.actualPort || this.serviceConfigs.postgresql.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkMongodbHealth() {
    const port = this.serviceConfigs.mongodb.actualPort || this.serviceConfigs.mongodb.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkMemcachedHealth() {
    const port = this.serviceConfigs.memcached.actualPort || this.serviceConfigs.memcached.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkMinioHealth() {
    const port = this.serviceConfigs.minio.actualPort || this.serviceConfigs.minio.defaultPort;
    return this.checkPortOpen(port);
  },

  async checkPortOpen(port) {
    return new Promise((resolve) => {
      const net = require('net');
      const socket = new net.Socket();

      socket.setTimeout(2000);
      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });
      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(port, '127.0.0.1');
    });
  },
};
