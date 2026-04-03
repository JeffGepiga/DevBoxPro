const fs = require('fs-extra');
const path = require('path');
const { spawn } = require('child_process');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');
const { SERVICE_VERSIONS } = require('../../../shared/serviceConfig');

async function waitForPortsReleased(httpPort, httpsPort, timeoutMs = 8000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    const httpAvailable = await isPortAvailable(httpPort);
    const httpsAvailable = await isPortAvailable(httpsPort);
    if (httpAvailable && httpsAvailable) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return await isPortAvailable(httpPort) && await isPortAvailable(httpsPort);
}

async function waitForPortReleased(port, timeoutMs = 8000) {
  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await isPortAvailable(port)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return await isPortAvailable(port);
}

const STARTUP_RECOVERY_SERVICES = [
  'mysql',
  'mariadb',
  'redis',
  'postgresql',
  'mongodb',
  'memcached',
  'mailpit',
  'minio',
];

const DEFAULT_SERVICE_VERSIONS = {
  mysql: '8.4',
  mariadb: '11.4',
  redis: '7.4',
  nginx: '1.28',
  apache: '2.4',
  postgresql: '17',
  mongodb: '8.0',
  memcached: '1.6',
  minio: 'latest',
};

module.exports = {
  async initialize() {
    // Set initial status for all services
    for (const [key, config] of Object.entries(this.serviceConfigs)) {
      this.serviceStatus.set(key, {
        name: config.name,
        status: 'stopped',
        port: config.defaultPort,
        pid: null,
        uptime: null,
        memory: 0,
        cpu: 0,
        version: null,
        versioned: config.versioned || false,
      });

      // Initialize running versions tracker
      if (config.versioned) {
        this.runningVersions.set(key, new Map()); // version -> { port, pid, startedAt }
      }
    }

    // Ensure data directories exist for versioned services
    const dataPath = this.getDataPath();

    // MySQL version directories
    for (const version of (SERVICE_VERSIONS.mysql || [])) {
      await fs.ensureDir(path.join(dataPath, 'mysql', version, 'data'));
    }

    // MariaDB version directories
    for (const version of (SERVICE_VERSIONS.mariadb || [])) {
      await fs.ensureDir(path.join(dataPath, 'mariadb', version, 'data'));
    }

    // Redis version directories
    for (const version of (SERVICE_VERSIONS.redis || [])) {
      await fs.ensureDir(path.join(dataPath, 'redis', version));
    }

    // Nginx and Apache config directories
    await fs.ensureDir(path.join(dataPath, 'nginx'));
    await fs.ensureDir(path.join(dataPath, 'apache'));
    await fs.ensureDir(path.join(dataPath, 'logs'));

    // PostgreSQL version directories
    for (const version of (SERVICE_VERSIONS.postgresql || [])) {
      await fs.ensureDir(path.join(dataPath, 'postgresql', version, 'data'));
    }

    // MongoDB version directories
    for (const version of (SERVICE_VERSIONS.mongodb || [])) {
      await fs.ensureDir(path.join(dataPath, 'mongodb', version, 'data'));
    }

    // Memcached version directories
    for (const version of (SERVICE_VERSIONS.memcached || [])) {
      await fs.ensureDir(path.join(dataPath, 'memcached', version));
    }

    // MinIO data directory
    await fs.ensureDir(path.join(dataPath, 'minio', 'data'));

    await this.rehydrateManagedServicesOnStartup();
  },

  async rehydrateManagedServicesOnStartup() {
    for (const serviceName of STARTUP_RECOVERY_SERVICES) {
      const config = this.serviceConfigs[serviceName];
      if (!config) {
        continue;
      }

      if (config.versioned) {
        const versions = SERVICE_VERSIONS[serviceName] || [];
        for (const version of versions) {
          await this.rehydrateManagedServiceState(serviceName, version);
        }
        continue;
      }

      await this.rehydrateManagedServiceState(serviceName);
    }
  },

  async rehydrateManagedServiceState(serviceName, version = null) {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      return false;
    }

    const status = this.serviceStatus.get(serviceName);
    const resolvedVersion = config.versioned
      ? (version || status?.version || DEFAULT_SERVICE_VERSIONS[serviceName])
      : null;

    if (config.versioned) {
      const trackedVersions = this.runningVersions.get(serviceName);
      if (trackedVersions?.has(resolvedVersion)) {
        return true;
      }
    } else if (status?.status === 'running') {
      return true;
    }

    const expectedPort = config.versioned
      ? this.getVersionPort(serviceName, resolvedVersion, config.defaultPort)
      : config.defaultPort;

    if (!await this.checkPortOpen(expectedPort)) {
      return false;
    }

    const recoveredAt = new Date();
    const currentStatus = this.serviceStatus.get(serviceName);
    if (currentStatus) {
      currentStatus.status = 'running';
      currentStatus.startedAt = recoveredAt;
      currentStatus.version = resolvedVersion;
      currentStatus.port = expectedPort;
      currentStatus.error = null;
    }

    if (config.versioned) {
      this.runningVersions.get(serviceName)?.set(resolvedVersion, {
        port: expectedPort,
        startedAt: recoveredAt,
      });
      config.actualPort = expectedPort;
    } else {
      config.actualPort = expectedPort;
    }

    this.managers.log?.systemInfo?.('Recovered managed service state after restart', {
      service: serviceName,
      version: resolvedVersion,
      port: expectedPort,
    });

    return true;
  },

  async startCoreServices() {
    const services = ['mysql', 'redis', 'mailpit', 'phpmyadmin'];
    const results = [];

    for (const service of services) {
      try {
        const result = await this.startService(service);
        results.push({ service, success: result.success, status: result.status });
      } catch (error) {
        this.managers.log?.systemError(`Error starting ${service}`, { error: error.message });
        results.push({ service, success: false, error: error.message });
      }
    }

    return results;
  },

  async startService(serviceName, version = null) {
    if (process.env.PLAYWRIGHT_TEST === 'true') {
      const status = this.serviceStatus.get(serviceName);
      if (status) {
        status.status = 'running';
        status.startedAt = new Date();
        status.version = version || 'mock-version';
      }
      return { success: true, service: serviceName, version: version || 'mock-version', status: 'running' };
    }

    const config = this.serviceConfigs[serviceName];
    if (!config) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    // For versioned services, version is required (or use default)
    if (config.versioned && !version) {
      // Use first available version as default
      version = DEFAULT_SERVICE_VERSIONS[serviceName];
    }

    const existingStatus = this.serviceStatus.get(serviceName);
    if (config.versioned) {
      const trackedVersions = this.runningVersions.get(serviceName);
      if (trackedVersions?.has(version)) {
        return { success: true, service: serviceName, version, status: 'running' };
      }
    } else if (existingStatus?.status === 'running') {
      return { success: true, service: serviceName, version, status: 'running' };
    }

    const versionSuffix = version ? ` ${version}` : '';
    const startKey = this.getProcessKey(serviceName, version);
    const existingStart = this.pendingStarts.get(startKey);

    if (existingStart) {
      return existingStart;
    }

    const runStart = async () => {
      const status = this.serviceStatus.get(serviceName);
      if (status) {
        status.status = 'starting';
        status.error = null;
        status.version = version;
      }

      try {
        switch (serviceName) {
          case 'nginx':
            await this.startNginx(version);
            break;
          case 'apache':
            await this.startApache(version);
            break;
          case 'mysql':
            await this.startMySQL(version);
            break;
          case 'mariadb':
            await this.startMariaDB(version);
            break;
          case 'redis':
            await this.startRedis(version);
            break;
          case 'mailpit':
            await this.startMailpit();
            break;
          case 'phpmyadmin':
            await this.startPhpMyAdmin();
            break;
          case 'postgresql':
            await this.startPostgreSQL(version);
            break;
          case 'mongodb':
            await this.startMongoDB(version);
            break;
          case 'memcached':
            await this.startMemcached(version);
            break;
          case 'minio':
            await this.startMinIO();
            break;
        }

        // Only update status to running if the service was actually started
        // (i.e., not if it returned early due to missing binary)
        if (status.status !== 'not_installed' && status.status !== 'error') {
          status.status = 'running';
          status.startedAt = new Date();
          status.version = version;
          this.emit('serviceStarted', serviceName, version);
        }

        return { success: status.status === 'running', service: serviceName, version, status: status.status };
      } catch (error) {
        this.managers.log?.systemError(`Failed to start ${config.name}${versionSuffix}`, { error: error.message });
        if (status) {
          status.status = 'error';
          status.error = error.message;
        }
        throw error;
      }
    };

    const startPromise = (serviceName === 'nginx' || serviceName === 'apache')
      ? this.runExclusiveWebServerStart(runStart)
      : runStart();

    const trackedPromise = startPromise.finally(() => {
      if (this.pendingStarts.get(startKey) === trackedPromise) {
        this.pendingStarts.delete(startKey);
      }
    });

    this.pendingStarts.set(startKey, trackedPromise);

    return trackedPromise;
  },

  async runExclusiveWebServerStart(startOperation) {
    const previous = this.webServerStartQueue;
    let releaseQueue;

    this.webServerStartQueue = new Promise((resolve) => {
      releaseQueue = resolve;
    });

    await previous;

    try {
      return await startOperation();
    } finally {
      releaseQueue();
    }
  },

  // Start a service with special options (like skip-grant-tables for credential reset)
  async startServiceWithOptions(serviceName, options = {}) {
    if (serviceName !== 'mysql' && serviceName !== 'mariadb') {
      throw new Error('startServiceWithOptions only supports mysql and mariadb');
    }

    const config = this.serviceConfigs[serviceName];
    const defaults = { mysql: '8.4', mariadb: '11.4' };
    const version = defaults[serviceName];

    if (options.skipGrantTables) {
      if (serviceName === 'mysql') {
        await this.startMySQLWithSkipGrant(version, options.initFile);
      } else {
        await this.startMariaDBWithSkipGrant(version, options.initFile);
      }

      const status = this.serviceStatus.get(serviceName);
      status.status = 'running';
      status.startedAt = new Date();
      status.version = version;

      return { success: true, service: serviceName, version };
    }

    // Otherwise use normal start
    return this.startService(serviceName, version);
  },

  async stopService(serviceName, version = null) {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    // Get version from current status if not provided
    if (config.versioned && !version) {
      const status = this.serviceStatus.get(serviceName);
      version = status?.version;
    }

    const processKey = this.getProcessKey(serviceName, version);
    const versionSuffix = version ? ` ${version}` : '';
    const webServerProcessPath = serviceName === 'nginx'
      ? this.getNginxPath(version || '1.28')
      : serviceName === 'apache'
        ? this.getApachePath(version || '2.4')
        : null;
    const status = this.serviceStatus.get(serviceName);
    const trackedVersion = config.versioned && version
      ? this.runningVersions.get(serviceName)?.get(version)
      : null;
    const servicePort = trackedVersion?.port || status?.port || config.actualPort || config.defaultPort;

    const proc = this.processes.get(processKey);
    if (proc) {
      await this.killProcess(proc);
      this.processes.delete(processKey);
    }

    // Remove from running versions tracker
    if (config.versioned && version) {
      const versions = this.runningVersions.get(serviceName);
      if (versions) {
        versions.delete(version);
      }
    }

    // Check if other versions of this service are still running
    const remainingVersions = this.runningVersions.get(serviceName);
    const isLastVersion = !remainingVersions || remainingVersions.size === 0;
    const releasedStandardPorts = (serviceName === 'nginx' || serviceName === 'apache')
      && isLastVersion
      && this.standardPortOwner === serviceName
      && (!version || !this.standardPortOwnerVersion || this.standardPortOwnerVersion === version);

    // For Nginx on Windows, also try to stop gracefully and kill any remaining workers
    if (serviceName === 'nginx' && require('os').platform() === 'win32') {
      try {
        const nginxVersion = version || '1.28';
        const nginxPath = this.getNginxPath(nginxVersion);
        const nginxExe = path.join(nginxPath, 'nginx.exe');
        const dataPath = this.getDataPath();
        const confPath = path.join(dataPath, 'nginx', nginxVersion, 'nginx.conf');

        if (await fs.pathExists(nginxExe)) {
          const { isProcessRunning, killProcessesByPath, spawnSyncSafe, waitForProcessesByPathExit } = require('../../utils/SpawnUtils');

          const nginxRunning = isProcessRunning('nginx.exe');

          if (nginxRunning) {
            // Try graceful stop for this version's config
            try {
              spawnSyncSafe(nginxExe, ['-s', 'stop', '-c', confPath], {
                cwd: nginxPath,
                timeout: 5000,
              });
            } catch (e) {
              // Ignore errors - process may already be dead
            }

            // Only kill ALL nginx.exe processes if this is the last running version
            if (isLastVersion) {
              await killProcessesByPath('nginx.exe', nginxPath);
              await waitForProcessesByPathExit('nginx.exe', nginxPath, 8000);
            }
          }
        }
      } catch (error) {
        this.managers.log?.systemWarn('Error during Nginx cleanup', { error: error.message });
      }
    }

    // For Apache on Windows, kill any remaining DevBox httpd processes.
    // IMPORTANT: Use path-filtered kill to avoid killing external Apache
    // installations (XAMPP, WAMP, etc.) that may be running on port 80.
    if (serviceName === 'apache' && require('os').platform() === 'win32') {
      try {
        const { killProcessesByPath, isProcessRunning, waitForProcessesByPathExit } = require('../../utils/SpawnUtils');
        if (isLastVersion && isProcessRunning('httpd.exe')) {
          const apachePath = this.getApachePath(version || '2.4');
          await killProcessesByPath('httpd.exe', apachePath);
          await waitForProcessesByPathExit('httpd.exe', apachePath, 8000);
        }
      } catch (error) {
        this.managers.log?.systemWarn('Error during Apache cleanup', { error: error.message });
      }
    }

    // Wait a moment for ports to be released
    await new Promise(resolve => setTimeout(resolve, 500));

    if (serviceName === 'redis' && servicePort) {
      let released = await waitForPortReleased(servicePort, 5000);

      if (!released && require('os').platform() === 'win32') {
        try {
          const { killProcessesByPath, waitForProcessesByPathExit } = require('../../utils/SpawnUtils');
          const redisPath = this.getRedisPath(version || '7.4');

          await killProcessesByPath('redis-server.exe', redisPath);
          await waitForProcessesByPathExit('redis-server.exe', redisPath, 8000);
          released = await waitForPortReleased(servicePort, 5000);
        } catch (error) {
          this.managers.log?.systemWarn('Error during Redis cleanup', {
            service: serviceName,
            version,
            error: error.message,
          });
        }
      }

      if (!released) {
        this.managers.log?.systemWarn('Redis port was not released before stopService completed', {
          service: serviceName,
          version,
          port: servicePort,
        });
      }
    }

    if (releasedStandardPorts) {
      const standardHttpPort = this.webServerPorts?.standard?.http || 80;
      const standardHttpsPort = this.webServerPorts?.standard?.https || 443;
      let released = await waitForPortsReleased(standardHttpPort, standardHttpsPort, 8000);

      if (!released && require('os').platform() === 'win32' && webServerProcessPath) {
        try {
          const { killProcessesByPath, waitForProcessesByPathExit } = require('../../utils/SpawnUtils');
          const processName = serviceName === 'nginx' ? 'nginx.exe' : 'httpd.exe';

          await killProcessesByPath(processName, webServerProcessPath);
          await waitForProcessesByPathExit(processName, webServerProcessPath, 8000);
          released = await waitForPortsReleased(standardHttpPort, standardHttpsPort, 5000);
        } catch (error) {
          this.managers.log?.systemWarn('Error during final web server port cleanup', {
            service: serviceName,
            error: error.message,
          });
        }
      }

      if (!released) {
        this.managers.log?.systemWarn('Standard web server ports were not released before stopService completed', {
          service: serviceName,
          version,
          httpPort: standardHttpPort,
          httpsPort: standardHttpsPort,
        });
      }
    }

    // Release standard ports only if this version owned them
    if ((serviceName === 'nginx' || serviceName === 'apache') && this.standardPortOwner === serviceName) {
      if (!version || !this.standardPortOwnerVersion || this.standardPortOwnerVersion === version) {
        this.standardPortOwner = null;
        this.standardPortOwnerVersion = null;
      }
    }

    // Update actual port values based on remaining versions
    if (serviceName === 'nginx' || serviceName === 'apache') {
      if (isLastVersion) {
        delete config.actualHttpPort;
        delete config.actualSslPort;
      } else {
        // Update to first remaining version's ports
        const firstRemaining = remainingVersions.values().next().value;
        if (firstRemaining) {
          config.actualHttpPort = firstRemaining.port;
          config.actualSslPort = firstRemaining.sslPort;
        }
      }
    }

    if (isLastVersion) {
      status.status = 'stopped';
      status.pid = null;
      status.startedAt = null;
      status.version = null;
    } else {
      // Other versions still running - update status to reflect remaining version
      const firstEntry = remainingVersions.entries().next().value;
      if (firstEntry) {
        status.version = firstEntry[0];
        status.port = firstEntry[1].port;
        status.sslPort = firstEntry[1].sslPort;
      }
    }
    this.emit('serviceStopped', serviceName, version);

    return { success: true, service: serviceName, version };
  },

  async restartService(serviceName, version = null) {
    await this.stopService(serviceName, version);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const result = this.startService(serviceName, version);
    return result;
  },

  async startAllServices() {
    const results = [];
    for (const serviceName of Object.keys(this.serviceConfigs)) {
      try {
        await this.startService(serviceName);
        results.push({ service: serviceName, success: true });
      } catch (error) {
        results.push({ service: serviceName, success: false, error: error.message });
      }
    }
    return results;
  },

  async stopAllServices() {
    const results = [];

    // First, stop all running projects
    if (this.managers.project) {
      try {
        await this.managers.project.stopAllProjects();
      } catch (error) {
        this.managers.log?.systemError('Error stopping projects', { error: error.message });
      }
    }

    // Stop all tracked processes first
    for (const [processKey, proc] of this.processes) {
      try {
        await this.killProcess(proc);
      } catch (error) {
        this.managers.log?.systemError(`Error stopping process ${processKey}`, { error: error.message });
      }
    }
    this.processes.clear();

    // Clear all running versions tracking
    for (const [serviceName, versions] of this.runningVersions) {
      versions.clear();
    }

    // Then stop all services (this also does cleanup)
    for (const serviceName of Object.keys(this.serviceConfigs)) {
      try {
        await this.stopService(serviceName);
        results.push({ service: serviceName, success: true });
      } catch (error) {
        results.push({ service: serviceName, success: false, error: error.message });
      }
    }

    // Force kill any remaining orphan processes on Windows
    if (process.platform === 'win32') {
      await this.forceKillOrphanProcesses();
    }

    // Reset service statuses
    for (const [serviceName, status] of this.serviceStatus) {
      status.status = 'stopped';
      status.pid = null;
      status.startedAt = null;
      status.version = null;
    }

    // Reset port ownership
    this.standardPortOwner = null;
    this.standardPortOwnerVersion = null;

    return results;
  },

  /**
   * Force kill any orphan processes that might be left behind
   * Only kills processes running from our resources directory
   */
  async forceKillOrphanProcesses() {
    const { killProcessByName, killProcessesByPath } = require('../../utils/SpawnUtils');

    // First try to kill known service processes by image name
    const processesToKill = [
      'nginx.exe',
      'httpd.exe',
      'mysqld.exe',
      'mariadbd.exe',
      'redis-server.exe',
      'mailpit.exe',
      'php-cgi.exe',
      'postgres.exe',
      'mongod.exe',
      'memcached.exe',
      'minio.exe',
    ];

    for (const processName of processesToKill) {
      try {
        await killProcessByName(processName, true);
      } catch (e) {
        // Ignore - no processes to kill or already dead
      }
    }

    // Kill PHP processes running from our resources path (for phpMyAdmin)
    try {
      await killProcessesByPath('php.exe', this.resourcePath);
    } catch (e) {
      // Ignore errors
    }
  },
};
