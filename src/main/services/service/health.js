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

      socket.setTimeout(1000);
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
