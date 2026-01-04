const path = require('path');
const fs = require('fs-extra');
const { spawn, exec, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { isPortAvailable, findAvailablePort } = require('../utils/PortUtils');

// Import centralized service configuration
const { SERVICE_VERSIONS, VERSION_PORT_OFFSETS, DEFAULT_PORTS } = require('../../shared/serviceConfig');

// Helper function to spawn a process hidden on Windows
// On Windows, uses regular spawn with windowsHide and shell option
// The shell option with windowsHide helps prevent console window flashing
function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    // On Windows, spawn directly but with windowsHide
    // We need to keep stdio accessible for tracking, so don't use 'ignore' by default
    const proc = spawn(command, args, {
      ...options,
      windowsHide: true,
      // Don't detach on Windows - it causes issues with console windows
    });

    return proc;
  } else {
    return spawn(command, args, {
      ...options,
      detached: true,
    });
  }
}

class ServiceManager extends EventEmitter {
  constructor(resourcePath, configStore, managers) {
    super();
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.processes = new Map(); // key format: 'serviceName' or 'serviceName-version'
    this.serviceStatus = new Map();
    this.runningVersions = new Map(); // Track running versions per service type

    // Track which web server owns the standard ports (80/443)
    // First web server to start gets these ports
    this.standardPortOwner = null;

    // Standard and alternate ports for web servers
    this.webServerPorts = {
      standard: { http: 80, https: 443 },
      alternate: { http: 8081, https: 8443 },
    };

    // Port assignments for versioned services
    // Uses centralized configuration from shared/serviceConfig.js
    this.versionPortOffsets = { ...VERSION_PORT_OFFSETS };

    // Service definitions (using centralized default ports)
    this.serviceConfigs = {
      nginx: {
        name: 'Nginx',
        defaultPort: DEFAULT_PORTS.nginx || 80,
        sslPort: 443,
        alternatePort: 8081,
        alternateSslPort: 8443,
        healthCheck: this.checkNginxHealth.bind(this),
        versioned: true,
      },
      apache: {
        name: 'Apache',
        defaultPort: DEFAULT_PORTS.apache || 8081,
        sslPort: 443,
        alternatePort: 8082,
        alternateSslPort: 8445,
        healthCheck: this.checkApacheHealth.bind(this),
        versioned: true,
      },
      mysql: {
        name: 'MySQL',
        defaultPort: DEFAULT_PORTS.mysql || 3306,
        healthCheck: this.checkMySqlHealth.bind(this),
        versioned: true,
      },
      mariadb: {
        name: 'MariaDB',
        defaultPort: DEFAULT_PORTS.mariadb || 3306,
        healthCheck: this.checkMariaDbHealth.bind(this),
        versioned: true,
      },
      redis: {
        name: 'Redis',
        defaultPort: DEFAULT_PORTS.redis || 6379,
        healthCheck: this.checkRedisHealth.bind(this),
        versioned: true,
      },
      mailpit: {
        name: 'Mailpit',
        defaultPort: DEFAULT_PORTS.mailpit || 8025,
        smtpPort: DEFAULT_PORTS.mailpitSmtp || 1025,
        healthCheck: this.checkMailpitHealth.bind(this),
        versioned: false,
      },
      phpmyadmin: {
        name: 'phpMyAdmin',
        defaultPort: DEFAULT_PORTS.phpmyadmin || 8080,
        healthCheck: this.checkPhpMyAdminHealth.bind(this),
        versioned: false,
      },
    };
  }

  // Get process key for Map storage
  getProcessKey(serviceName, version) {
    if (version) {
      return `${serviceName}-${version}`;
    }
    return serviceName;
  }

  // Get port for a specific service version
  getVersionPort(serviceName, version, basePort) {
    const offsets = this.versionPortOffsets[serviceName];
    if (offsets && version && offsets[version] !== undefined) {
      return basePort + offsets[version];
    }
    // For unknown versions (custom imports), calculate offset from version string
    if (version) {
      const customOffset = 10 + (version.charCodeAt(0) % 10);
      return basePort + customOffset;
    }
    return basePort;
  }

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
    const dataPath = path.join(app.getPath('userData'), 'data');

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

  }

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

    const startedCount = results.filter(r => r.success).length;
    const notInstalledCount = results.filter(r => r.status === 'not_installed').length;
    return results;
  }

  async startService(serviceName, version = null) {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    // For versioned services, version is required (or use default)
    if (config.versioned && !version) {
      // Use first available version as default
      const defaults = { mysql: '8.4', mariadb: '11.4', redis: '7.4', nginx: '1.28', apache: '2.4' };
      version = defaults[serviceName];
    }

    const versionSuffix = version ? ` ${version}` : '';

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
      }

      // Only update status to running if the service was actually started
      // (i.e., not if it returned early due to missing binary)
      const status = this.serviceStatus.get(serviceName);
      if (status.status !== 'not_installed') {
        status.status = 'running';
        status.startedAt = new Date();
        status.version = version;
        this.emit('serviceStarted', serviceName, version);
      }

      return { success: status.status === 'running', service: serviceName, version, status: status.status };
    } catch (error) {
      this.managers.log?.systemError(`Failed to start ${config.name}${versionSuffix}`, { error: error.message });
      const status = this.serviceStatus.get(serviceName);
      status.status = 'error';
      status.error = error.message;
      throw error;
    }
  }

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
  }

  async startMySQLWithSkipGrant(version = '8.4', initFile = null) {
    const mysqlPath = this.getMySQLPath(version);
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    if (!await fs.pathExists(mysqldPath)) {
      throw new Error(`MySQL ${version} binary not found`);
    }

    // Only kill the tracked process for this specific version, not all MySQL processes
    const processKey = this.getProcessKey('mysql', version);
    const existingProc = this.processes.get(processKey);
    if (existingProc) {
      await this.killProcess(existingProc);
      this.processes.delete(processKey);
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mysql', version, 'data');

    // Use the same port detection as normal start
    const defaultPort = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
    }

    this.serviceConfigs.mysql.actualPort = port;

    // Create a temporary config with skip-grant-tables
    const configPath = path.join(dataPath, 'mysql', version, 'my_skipgrant.cnf');
    await this.createMySQLConfigWithSkipGrant(configPath, dataDir, port, version, initFile);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }

    // Track when MySQL reports ready
    let mysqlReady = false;

    proc.stdout?.on('data', (data) => {
      // Capture but don't log to console
    });

    proc.stderr?.on('data', (data) => {
      const output = data.toString().trim();
      // Check for ready message in stderr (MySQL logs to stderr)
      if (output.includes('ready for connections') || output.includes('MySQL is ready')) {
        mysqlReady = true;
      }
    });

    this.processes.set(this.getProcessKey('mysql', version), proc);
    const status = this.serviceStatus.get('mysql');
    status.port = port;
    status.version = version;

    this.runningVersions.get('mysql').set(version, { port, startedAt: new Date() });

    // Wait for MySQL to report ready via named pipe (since skip-grant-tables disables TCP)
    // Just wait for the process to start and give it time to initialize
    await this.waitForNamedPipeReady(`MYSQL_${version.replace(/\./g, '')}_SKIP`, 30000);
    status.status = 'running';
  }

  // Wait for Windows named pipe to be ready
  async waitForNamedPipeReady(pipeName, timeout = 30000) {
    if (process.platform !== 'win32') {
      // On Unix, just wait a fixed time
      await new Promise(resolve => setTimeout(resolve, 5000));
      return;
    }

    const startTime = Date.now();
    const net = require('net');
    const fullPipePath = `\\\\.\\pipe\\${pipeName}`;

    while (Date.now() - startTime < timeout) {
      try {
        await new Promise((resolve, reject) => {
          const socket = new net.Socket();
          socket.setTimeout(2000);

          socket.on('connect', () => {
            socket.destroy();
            resolve(true);
          });

          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('timeout'));
          });

          socket.on('error', (err) => {
            socket.destroy();
            reject(err);
          });

          socket.connect(fullPipePath);
        });
        return; // Pipe is ready
      } catch (e) {
        // Pipe not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    // If pipe check timed out, just continue anyway - MySQL might still be working
  }

  // Simple wait for port to be accepting connections
  async waitForPortReady(port, timeout = 30000) {
    const startTime = Date.now();
    const net = require('net');

    while (Date.now() - startTime < timeout) {
      try {
        await new Promise((resolve, reject) => {
          const socket = new net.Socket();
          socket.setTimeout(1000);

          socket.on('connect', () => {
            socket.destroy();
            resolve(true);
          });

          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('timeout'));
          });

          socket.on('error', (err) => {
            socket.destroy();
            reject(err);
          });

          socket.connect(port, '127.0.0.1');
        });
        return; // Port is ready
      } catch (e) {
        // Port not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    throw new Error(`Port ${port} not ready within ${timeout}ms`);
  }

  async createMySQLConfigWithSkipGrant(configPath, dataDir, port, version = '8.4', initFile = null) {
    const mysqlPath = this.getMySQLPath(version);
    const isWindows = process.platform === 'win32';

    // Build init-file line if provided
    const initFileLine = initFile ? `init-file=${initFile.replace(/\\/g, '/')}\n` : '';

    let config;
    if (isWindows) {
      config = `[mysqld]
basedir=${mysqlPath.replace(/\\/g, '/')}
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=0.0.0.0
enable-named-pipe=ON
socket=MYSQL_${version.replace(/\./g, '')}_SKIP
pid-file=${path.join(dataDir, 'mysql_skip.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error_skip.log').replace(/\\/g, '/')}
skip-grant-tables
skip-networking=0
${initFileLine}innodb_buffer_pool_size=128M
innodb_redo_log_capacity=100M
max_connections=100
loose-mysqlx=0
skip-log-bin

[client]
port=${port}
`;
    } else {
      config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=127.0.0.1
socket=${path.join(dataDir, 'mysql_skip.sock').replace(/\\/g, '/')}
pid-file=${path.join(dataDir, 'mysql_skip.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error_skip.log').replace(/\\/g, '/')}
skip-grant-tables
${initFileLine}
[client]
port=${port}
socket=${path.join(dataDir, 'mysql_skip.sock').replace(/\\/g, '/')}
`;
    }

    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, config);
  }

  async startMariaDBWithSkipGrant(version = '11.4', initFile = null) {
    const mariadbPath = this.getMariaDBPath(version);
    const mariadbd = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');

    if (!await fs.pathExists(mariadbd)) {
      throw new Error(`MariaDB ${version} binary not found`);
    }

    // Only kill the tracked process for this specific version, not all MariaDB processes
    const processKey = this.getProcessKey('mariadb', version);
    const existingProc = this.processes.get(processKey);
    if (existingProc) {
      await this.killProcess(existingProc);
      this.processes.delete(processKey);
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mariadb', version, 'data');

    const defaultPort = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
    }

    this.serviceConfigs.mariadb.actualPort = port;

    // Create a temporary config with skip-grant-tables
    const configPath = path.join(dataPath, 'mariadb', version, 'my_skipgrant.cnf');
    await this.createMariaDBConfigWithSkipGrant(configPath, dataDir, port, version, mariadbPath, initFile);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(mariadbd, [`--defaults-file=${configPath}`], {
        cwd: mariadbPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      proc = spawn(mariadbd, [`--defaults-file=${configPath}`], {
        cwd: mariadbPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }

    proc.stdout?.on('data', (data) => {
      // Capture but don't log to console
    });

    proc.stderr?.on('data', (data) => {
      // Capture but don't log to console
    });

    this.processes.set(this.getProcessKey('mariadb', version), proc);
    const status = this.serviceStatus.get('mariadb');
    status.port = port;
    status.version = version;

    this.runningVersions.get('mariadb').set(version, { port, startedAt: new Date() });

    // Wait for MariaDB to be ready via named pipe
    // MariaDB doesn't disable networking with skip-grant-tables, but use pipe for consistency
    await this.waitForNamedPipeReady(`MARIADB_${version.replace(/\./g, '')}_SKIP`, 30000);
    status.status = 'running';
  }

  async createMariaDBConfigWithSkipGrant(configPath, dataDir, port, version, mariadbPath, initFile = null) {
    const isWindows = process.platform === 'win32';

    // Build init-file line if provided
    const initFileLine = initFile ? `init-file=${initFile.replace(/\\/g, '/')}\n` : '';

    let config;
    if (isWindows) {
      config = `[mysqld]
basedir=${mariadbPath.replace(/\\/g, '/')}
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=0.0.0.0
enable-named-pipe=ON
socket=MARIADB_${version.replace(/\./g, '')}_SKIP
pid-file=${path.join(dataDir, 'mariadb_skip.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error_skip.log').replace(/\\/g, '/')}
skip-grant-tables
${initFileLine}innodb_buffer_pool_size=128M
max_connections=100

[client]
port=${port}
`;
    } else {
      config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=127.0.0.1
socket=${path.join(dataDir, 'mariadb_skip.sock').replace(/\\/g, '/')}
pid-file=${path.join(dataDir, 'mariadb_skip.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error_skip.log').replace(/\\/g, '/')}
skip-grant-tables
${initFileLine}
[client]
port=${port}
socket=${path.join(dataDir, 'mariadb_skip.sock').replace(/\\/g, '/')}
`;
    }

    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, config);
  }

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

    const process = this.processes.get(processKey);
    if (process) {
      await this.killProcess(process);
      this.processes.delete(processKey);
    }

    // Remove from running versions tracker
    if (config.versioned && version) {
      const versions = this.runningVersions.get(serviceName);
      if (versions) {
        versions.delete(version);
      }
    }

    // For Nginx on Windows, also try to stop gracefully and kill any remaining workers
    if (serviceName === 'nginx' && require('os').platform() === 'win32') {
      try {
        const platform = 'win';
        const nginxVersion = version || '1.28';
        const nginxPath = this.getNginxPath(nginxVersion);
        const nginxExe = path.join(nginxPath, 'nginx.exe');
        const dataPath = path.join(app.getPath('userData'), 'data');
        const confPath = path.join(dataPath, 'nginx', 'nginx.conf');

        if (await fs.pathExists(nginxExe)) {
          const { isProcessRunning, killProcessByName, spawnSyncSafe } = require('../utils/SpawnUtils');

          // First check if nginx is actually running before trying to stop it
          const nginxRunning = isProcessRunning('nginx.exe');

          // Only send stop signal if nginx is actually running
          if (nginxRunning) {
            // Try graceful stop first
            try {
              spawnSyncSafe(nginxExe, ['-s', 'stop', '-c', confPath], {
                cwd: nginxPath,
                timeout: 5000,
              });
            } catch (e) {
              // Ignore errors - process may already be dead
            }

            // Kill any remaining nginx processes
            await killProcessByName('nginx.exe', true);
          }
        }
      } catch (error) {
        this.managers.log?.systemWarn('Error during Nginx cleanup', { error: error.message });
      }
    }

    // For Apache on Windows, kill any remaining httpd processes
    if (serviceName === 'apache' && require('os').platform() === 'win32') {
      try {
        const { killProcessByName } = require('../utils/SpawnUtils');
        await killProcessByName('httpd.exe', true);
      } catch (error) {
        this.managers.log?.systemWarn('Error during Apache cleanup', { error: error.message });
      }
    }

    // Wait a moment for ports to be released
    await new Promise(resolve => setTimeout(resolve, 500));

    // Release standard ports if this web server owned them
    if ((serviceName === 'nginx' || serviceName === 'apache') && this.standardPortOwner === serviceName) {
      this.standardPortOwner = null;
    }

    // Clear actual port values so they get recalculated on next start
    if (serviceName === 'nginx' || serviceName === 'apache') {
      delete config.actualHttpPort;
      delete config.actualSslPort;
    }

    const status = this.serviceStatus.get(serviceName);
    status.status = 'stopped';
    status.pid = null;
    status.startedAt = null;
    status.version = null;
    this.emit('serviceStopped', serviceName, version);

    return { success: true, service: serviceName, version };
  }

  async restartService(serviceName) {
    await this.stopService(serviceName);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    return this.startService(serviceName);
  }

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
  }

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

    return results;
  }

  /**
   * Force kill any orphan processes that might be left behind
   * Only kills processes running from our resources directory
   */
  async forceKillOrphanProcesses() {
    const { killProcessByName, killProcessesByPath } = require('../utils/SpawnUtils');

    // First try to kill known service processes by image name
    const processesToKill = [
      'nginx.exe',
      'httpd.exe',
      'mysqld.exe',
      'mariadbd.exe',
      'redis-server.exe',
      'mailpit.exe',
      'php-cgi.exe',
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
  }

  // Nginx
  async startNginx(version = '1.28') {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const nginxPath = this.getNginxPath(version);
    const nginxExe = path.join(nginxPath, process.platform === 'win32' ? 'nginx.exe' : 'nginx');

    // Check if Nginx binary exists
    if (!await fs.pathExists(nginxExe)) {
      this.managers.log?.systemError(`Nginx ${version} binary not found. Please download Nginx from the Binary Manager.`);
      const status = this.serviceStatus.get('nginx');
      status.status = 'not_installed';
      status.error = `Nginx ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const confPath = path.join(dataPath, 'nginx', 'nginx.conf');
    const logsPath = path.join(dataPath, 'nginx', 'logs');

    // Determine which ports to use based on first-come-first-served
    let httpPort, sslPort;

    // Check availability of standard/default ports (80/443) at runtime using PortUtils
    const standardHttp = this.webServerPorts.standard.http;
    const standardHttps = this.webServerPorts.standard.https;

    // FIRST check ownership state to prevent race conditions
    // If another server already owns standard ports, don't even check availability
    let canUseStandard = false;

    if (this.standardPortOwner === null) {
      // No one owns yet - check actual availability
      canUseStandard = await isPortAvailable(standardHttp) && await isPortAvailable(standardHttps);

      if (canUseStandard) {
        this.standardPortOwner = 'nginx'; // Claim ownership immediately

      }
    } else if (this.standardPortOwner === 'nginx') {
      // We already own standard ports
      canUseStandard = true;

    }
    // If standardPortOwner is 'apache', canUseStandard stays false

    if (canUseStandard) {
      // Standard ports are free and we own them
      httpPort = standardHttp;
      sslPort = standardHttps;

    } else {
      // Standard ports blocked or owned by Apache, use Nginx-specific alternates
      httpPort = this.serviceConfigs.nginx.alternatePort;
      sslPort = this.serviceConfigs.nginx.alternateSslPort;

    }

    // Verify chosen ports are available, find alternatives if not
    if (!await isPortAvailable(httpPort)) {
      httpPort = await findAvailablePort(httpPort, 100);
      if (!httpPort) {
        throw new Error(`Could not find available HTTP port for Nginx`);
      }
    }

    if (!await isPortAvailable(sslPort)) {
      sslPort = await findAvailablePort(sslPort, 100);
      if (!sslPort) {
        throw new Error(`Could not find available HTTPS port for Nginx`);
      }
    }

    // Store the actual ports being used
    this.serviceConfigs.nginx.actualHttpPort = httpPort;
    this.serviceConfigs.nginx.actualSslPort = sslPort;

    // Ensure directories exist
    await fs.ensureDir(path.join(dataPath, 'nginx'));
    await fs.ensureDir(logsPath);
    await fs.ensureDir(path.join(dataPath, 'nginx', 'conf.d'));

    // Ensure nginx temp directories exist (required on Windows)
    await fs.ensureDir(path.join(nginxPath, 'temp', 'client_body_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'proxy_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'fastcgi_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'uwsgi_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'scgi_temp'));

    // Always recreate config with current ports
    await this.createNginxConfig(confPath, logsPath, httpPort, sslPort, version);

    // Test Nginx configuration before starting
    // This may fail with port bind errors even if our port check passed (Windows HTTP service, Hyper-V, etc.)
    const testConfig = async () => {
      const { execSync } = require('child_process');
      try {
        execSync(`"${nginxExe}" -t -c "${confPath}" -p "${nginxPath}"`, {
          cwd: nginxPath,
          windowsHide: true,
          timeout: 10000,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        return { success: true };
      } catch (configError) {
        // Nginx may output to stderr, stdout, or both - check all sources
        const stderr = configError.stderr || '';
        const stdout = configError.stdout || '';
        const message = configError.message || '';
        const errorMsg = `${stderr} ${stdout} ${message}`;

        // Check for port binding errors (Windows error 10013 = permission denied, 10048 = already in use)
        const portBindError = errorMsg.includes('10013') || errorMsg.includes('10048') ||
          errorMsg.includes('bind()') || errorMsg.includes('Address already in use');
        return { success: false, error: errorMsg, isPortError: portBindError };
      }
    };

    let testResult = await testConfig();

    // If we got a port binding error, try alternate ports
    if (!testResult.success && testResult.isPortError) {
      // Always try alternate ports on port binding errors
      const newHttpPort = this.webServerPorts.alternate.http;
      const newSslPort = this.webServerPorts.alternate.https;

      // Find available alternate ports
      let altHttpPort = newHttpPort;
      let altSslPort = newSslPort;

      if (!await isPortAvailable(altHttpPort)) {
        altHttpPort = await findAvailablePort(altHttpPort, 100);
      }
      if (!await isPortAvailable(altSslPort)) {
        altSslPort = await findAvailablePort(altSslPort, 100);
      }

      if (altHttpPort && altSslPort) {
        httpPort = altHttpPort;
        sslPort = altSslPort;

        // Clear all existing vhost files - they have the old ports hardcoded
        // They will be regenerated when projects start
        const sitesDir = path.join(dataPath, 'nginx', 'sites');
        try {
          const files = await fs.readdir(sitesDir);
          for (const file of files) {
            if (file.endsWith('.conf')) {
              await fs.remove(path.join(sitesDir, file));
            }
          }
        } catch (e) {
          // Sites dir may not exist yet
        }

        // Update the config with new ports
        await this.createNginxConfig(confPath, logsPath, httpPort, sslPort, version);

        // Update port ownership - we couldn't get standard ports
        if (this.standardPortOwner === 'nginx') {
          this.standardPortOwner = null;
        }

        // Update actual ports
        this.serviceConfigs.nginx.actualHttpPort = httpPort;
        this.serviceConfigs.nginx.actualSslPort = sslPort;

        testResult = await testConfig();
      }
    }

    if (!testResult.success) {
      this.managers.log?.systemError('Nginx configuration test failed', { error: testResult.error });
      throw new Error(`Nginx configuration error: ${testResult.error}`);
    }

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(nginxExe, ['-c', confPath, '-p', nginxPath], {
        cwd: nginxPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('Nginx process error', { error: error.message });
        const status = this.serviceStatus.get('nginx');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', (code) => {
        const status = this.serviceStatus.get('nginx');
        if (status.status === 'running') {
          status.status = 'stopped';
        }
      });
    } else {
      proc = spawn(nginxExe, ['-c', confPath, '-p', nginxPath], {
        cwd: nginxPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('Nginx process error', { error: error.message });
        const status = this.serviceStatus.get('nginx');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', (code) => {
        const status = this.serviceStatus.get('nginx');
        if (status.status === 'running') {
          status.status = 'stopped';
        }
      });
    }

    this.processes.set(this.getProcessKey('nginx', version), proc);
    const status = this.serviceStatus.get('nginx');
    status.port = httpPort;
    status.sslPort = sslPort;
    status.version = version;

    // Track this version as running
    this.runningVersions.get('nginx').set(version, { port: httpPort, sslPort, startedAt: new Date() });

    // Wait for Nginx to be ready
    try {
      await this.waitForService('nginx', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`Nginx ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = `Nginx ${version} failed to start properly: ${error.message}`;
      this.runningVersions.get('nginx').delete(version);
      throw error;
    }
  }

  // Reload Nginx configuration without stopping
  async reloadNginx(version = null) {
    // Get version from status if not provided
    if (!version) {
      const status = this.serviceStatus.get('nginx');
      version = status?.version || '1.28';
    }

    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const nginxPath = this.getNginxPath(version);
    const nginxExe = path.join(nginxPath, process.platform === 'win32' ? 'nginx.exe' : 'sbin/nginx');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const confPath = path.join(dataPath, 'nginx', 'nginx.conf');

    if (!await fs.pathExists(nginxExe)) {
      return;
    }

    const status = this.serviceStatus.get('nginx');
    if (status?.status !== 'running') {
      return;
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(nginxExe, ['-s', 'reload', '-c', confPath, '-p', nginxPath], {
        windowsHide: true,
        cwd: nginxPath,
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          this.managers.log?.systemError(`Nginx reload failed with code ${code}`);
          reject(new Error(`Nginx reload failed with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('Nginx reload error', { error: error.message });
        reject(error);
      });
    });
  }

  // Reload Apache configuration without stopping
  async reloadApache(version = null) {
    // Get version from status if not provided
    if (!version) {
      const status = this.serviceStatus.get('apache');
      version = status?.version || '2.4';
    }

    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const apachePath = this.getApachePath(version);
    const httpdExe = path.join(apachePath, 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const confPath = path.join(dataPath, 'apache', 'httpd.conf');

    if (!await fs.pathExists(httpdExe)) {
      return;
    }

    const status = this.serviceStatus.get('apache');
    if (status?.status !== 'running') {
      return;
    }

    // On Windows, Apache running as a process (not service) cannot use -k graceful
    // We need to restart it to pick up config changes
    if (process.platform === 'win32') {
      try {
        await this.restartService('apache');
      } catch (error) {
        this.managers.log?.systemError('Apache restart failed', { error: error.message });
        throw error;
      }
    } else {
      // On Unix-like systems, we can use graceful restart
      return new Promise((resolve, reject) => {
        const proc = spawn(httpdExe, ['-k', 'graceful', '-f', confPath], {
          cwd: apachePath,
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            this.managers.log?.systemError(`Apache reload failed with code ${code}`);
            reject(new Error(`Apache reload failed with code ${code}`));
          }
        });

        proc.on('error', (error) => {
          this.managers.log?.systemError('Apache reload error', { error: error.message });
          reject(error);
        });
      });
    }
  }

  async createNginxConfig(confPath, logsPath, httpPort = 80, sslPort = 443, version = '1.28') {
    const dataPath = path.join(app.getPath('userData'), 'data');
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    // Use getNginxPath to get the correct versioned path
    const nginxPath = this.getNginxPath(version);
    const mimeTypesPath = path.join(nginxPath, 'conf', 'mime.types').replace(/\\/g, '/');

    // WebServerManager stores sites in userData/data/nginx/sites, so we need to match that path
    const webServerDataPath = dataPath;
    const sitesPath = path.join(webServerDataPath, 'nginx', 'sites').replace(/\\/g, '/');
    const pidPath = path.join(webServerDataPath, 'nginx', 'nginx.pid').replace(/\\/g, '/');

    // Ensure sites directory exists
    await fs.ensureDir(path.join(webServerDataPath, 'nginx', 'sites'));
    await fs.ensureDir(path.join(webServerDataPath, 'nginx', 'logs'));

    const config = `worker_processes 1;
pid ${pidPath};
error_log ${logsPath.replace(/\\/g, '/')}/error.log;

events {
    worker_connections 1024;
}

http {
    include       ${mimeTypesPath};
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    client_max_body_size 128M;
    server_names_hash_bucket_size 128;
    
    access_log ${logsPath.replace(/\\/g, '/')}/access.log;
    error_log ${logsPath.replace(/\\/g, '/')}/http_error.log;

    # FastCGI params
    include ${path.join(nginxPath, 'conf', 'fastcgi_params').replace(/\\/g, '/')};

    # Include virtual host configs from sites directory
    include ${sitesPath}/*.conf;

    # Fallback server for unmatched requests (no default_server to allow project vhosts with _ to match)
    server {
        listen ${httpPort};
        server_name localhost;
        root ${dataPath.replace(/\\/g, '/')}/www;
        index index.html index.php;
        
        location / {
            try_files $uri $uri/ =404;
        }
    }
}
`;
    await fs.writeFile(confPath, config);
  }

  // Apache
  async startApache(version = '2.4') {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const apachePath = this.getApachePath(version);
    const httpdExe = path.join(apachePath, 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd');

    // Check if Apache binary exists
    if (!await fs.pathExists(httpdExe)) {
      this.managers.log?.systemError(`Apache ${version} binary not found. Please download Apache from the Binary Manager.`);
      const status = this.serviceStatus.get('apache');
      status.status = 'not_installed';
      status.error = `Apache ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const confPath = path.join(dataPath, 'apache', 'httpd.conf');
    const logsPath = path.join(dataPath, 'apache', 'logs');

    // Ensure directories exist
    await fs.ensureDir(path.join(dataPath, 'apache'));
    await fs.ensureDir(logsPath);
    await fs.ensureDir(path.join(dataPath, 'apache', 'vhosts'));
    await fs.ensureDir(path.join(dataPath, 'www')); // Default document root

    // Determine which ports to use based on first-come-first-served
    let httpPort, httpsPort;

    // Check availability of standard/default ports (80/443) at runtime using PortUtils
    const standardHttp = this.webServerPorts.standard.http;
    const standardHttps = this.webServerPorts.standard.https;

    // FIRST check ownership state to prevent race conditions
    // If another server already owns standard ports, don't even check availability
    let canUseStandard = false;

    if (this.standardPortOwner === null) {
      // No one owns yet - check actual availability
      canUseStandard = await isPortAvailable(standardHttp) && await isPortAvailable(standardHttps);

      if (canUseStandard) {
        this.standardPortOwner = 'apache'; // Claim ownership immediately

      }
    } else if (this.standardPortOwner === 'apache') {
      // We already own standard ports
      canUseStandard = true;

    } else {

    }
    // If standardPortOwner is 'nginx', canUseStandard stays false

    if (canUseStandard) {
      // Standard ports are free and we own them
      httpPort = standardHttp;
      httpsPort = standardHttps;

    } else {
      // Standard ports blocked or owned by Nginx, use Apache-specific alternates
      httpPort = this.serviceConfigs.apache.alternatePort;
      httpsPort = this.serviceConfigs.apache.alternateSslPort;

    }

    // Verify chosen ports are available, find alternatives if not
    // Pre-start cleanup for Windows: If ports are busy, it might be a zombie process
    if (process.platform === 'win32') {
      if (!(await isPortAvailable(httpPort)) || !(await isPortAvailable(httpsPort))) {
        const { killProcessByName } = require('../utils/SpawnUtils');
        try {
          this.managers.log?.systemInfo('Port blocked, attempting to clear zombie Apache processes...');
          await killProcessByName('httpd.exe', true);
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (e) {
          // Ignore errors if no process found
        }
      }
    }

    // Verify chosen ports are available, find alternatives if not
    if (!await isPortAvailable(httpPort)) {
      httpPort = await findAvailablePort(httpPort, 100);
      if (!httpPort) {
        throw new Error(`Could not find available HTTP port for Apache`);
      }
    }

    if (!await isPortAvailable(httpsPort)) {
      httpsPort = await findAvailablePort(httpsPort, 100);
      if (!httpsPort) {
        throw new Error(`Could not find available HTTPS port for Apache`);
      }
    }

    // Store the actual ports being used
    this.serviceConfigs.apache.actualHttpPort = httpPort;
    this.serviceConfigs.apache.actualSslPort = httpsPort;

    // Always recreate config with current ports
    await this.createApacheConfig(apachePath, confPath, logsPath, httpPort, httpsPort);

    // Test Apache config before starting
    // This may fail with port bind errors even if our port check passed (Windows HTTP service, Hyper-V, etc.)
    const testConfig = async () => {
      const { execSync } = require('child_process');
      try {
        execSync(`"${httpdExe}" -t -f "${confPath}"`, {
          cwd: apachePath,
          windowsHide: true,
          timeout: 10000,
          encoding: 'utf8'
        });
        return { success: true };
      } catch (configError) {
        const errorMsg = configError.stderr || configError.message || '';
        // Check for port binding errors (Windows error 10013 = permission denied, 10048 = already in use)
        const portBindError = errorMsg.includes('10013') || errorMsg.includes('10048') ||
          errorMsg.includes('could not bind') || errorMsg.includes('Address already in use') ||
          errorMsg.includes('make_sock');
        return { success: false, error: errorMsg, isPortError: portBindError };
      }
    };

    let testResult = await testConfig();

    // If we got a port binding error, try alternate ports
    if (!testResult.success && testResult.isPortError) {
      // Always try alternate ports on port binding errors
      const newHttpPort = this.webServerPorts.alternate.http;
      const newHttpsPort = this.webServerPorts.alternate.https;

      // Find available alternate ports
      let altHttpPort = newHttpPort;
      let altHttpsPort = newHttpsPort;

      if (!await isPortAvailable(altHttpPort)) {
        altHttpPort = await findAvailablePort(altHttpPort, 100);
      }
      if (!await isPortAvailable(altHttpsPort)) {
        altHttpsPort = await findAvailablePort(altHttpsPort, 100);
      }

      if (altHttpPort && altHttpsPort) {
        httpPort = altHttpPort;
        httpsPort = altHttpsPort;

        // Clear all existing vhost files - they have the old ports hardcoded
        // They will be regenerated when projects start
        const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
        try {
          const files = await fs.readdir(vhostsDir);
          for (const file of files) {
            if (file.endsWith('.conf')) {
              await fs.remove(path.join(vhostsDir, file));
            }
          }
        } catch (e) {
          // Vhosts dir may not exist yet
        }

        // Update the config with new ports
        await this.createApacheConfig(apachePath, confPath, logsPath, httpPort, httpsPort);

        // Update port ownership - we couldn't get standard ports
        if (this.standardPortOwner === 'apache') {
          this.standardPortOwner = null;
        }

        // Update actual ports
        this.serviceConfigs.apache.actualHttpPort = httpPort;
        this.serviceConfigs.apache.actualSslPort = httpsPort;

        testResult = await testConfig();
      }
    }

    if (!testResult.success) {
      this.managers.log?.systemError('Apache configuration test failed', { error: testResult.error });
      throw new Error(`Apache configuration error: ${testResult.error}`);
    }

    const proc = spawn(httpdExe, ['-f', confPath], {
      cwd: apachePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('apache', data.toString());
    });

    proc.stderr.on('data', (data) => {
      this.managers.log?.service('apache', data.toString(), 'error');
    });

    proc.on('error', (error) => {
      this.managers.log?.systemError('Apache process error', { error: error.message });
      const status = this.serviceStatus.get('apache');
      status.status = 'error';
      status.error = error.message;
    });

    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('apache');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set(this.getProcessKey('apache', version), proc);
    const status = this.serviceStatus.get('apache');
    status.pid = proc.pid;
    status.port = httpPort;
    status.sslPort = httpsPort;
    status.version = version;

    // Track this version as running
    this.runningVersions.get('apache').set(version, { port: httpPort, sslPort: httpsPort, startedAt: new Date() });

    // Wait for Apache to be ready
    try {
      await this.waitForService('apache', 20000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`Apache ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = `Apache ${version} failed to start properly: ${error.message}`;
      this.runningVersions.get('apache').delete(version);

      // Attempt cleanup
      try {
        if (process.platform === 'win32') {
          const { killProcessByName } = require('../utils/SpawnUtils');
          await killProcessByName('httpd.exe', true);
        }
        if (proc && !proc.killed) {
          proc.kill();
        }
      } catch (cleanupError) {
        // Ignore
      }

      throw error;
    }
  }

  async createApacheConfig(apachePath, confPath, logsPath, httpPort = 8081, httpsPort = 8444) {
    const dataPath = path.join(app.getPath('userData'), 'data');
    const mimeTypesPath = path.join(apachePath, 'conf', 'mime.types').replace(/\\/g, '/');

    // Runtime check: Which project currently owns Port 80 for network access?
    const networkPort80OwnerId = this.managers.project?.networkPort80Owner;

    // Collect all unique ports from network-accessible Apache projects
    // We explicitly bind to 0.0.0.0 to ensure consistent IPv4 handling and avoid ambiguous 'Listen 80' (dual-stack) issues
    const listenSet = new Set([`Listen 0.0.0.0:${httpPort}`, `Listen 0.0.0.0:${httpsPort}`]);

    const allProjects = this.configStore?.get('projects', []) || [];
    const networkApacheProjects = allProjects.filter(p =>
      p.networkAccess && p.webServer === 'apache'
    );

    networkApacheProjects.forEach(p => {
      if (p.id === networkPort80OwnerId) {
        // This Apache project owns Network Port 80.
        // It is already covered by 'Listen 80' (if httpPort is 80) or handled elsewhere.
        // We do NOT need to explicitly add Listen 0.0.0.0:80 here as it causes double-bind crash on Windows.
      } else {
        // Otherwise, use its assigned unique port (if defined and valid)
        if (p.port && p.port !== 80) {
          listenSet.add(`Listen 0.0.0.0:${p.port}`);
          // Note: SSL port is project.port + 1, added to vhost config directly
          // We DON'T add it to httpd.conf Listen to avoid conflict with Nginx using same ports
        }
      }
    });

    const listenDirectives = Array.from(listenSet).join('\n');

    const config = `ServerRoot "${apachePath.replace(/\\/g, '/')}"
${listenDirectives}

# Core modules
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule dir_module modules/mod_dir.so
LoadModule mime_module modules/mod_mime.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule alias_module modules/mod_alias.so
LoadModule env_module modules/mod_env.so
LoadModule setenvif_module modules/mod_setenvif.so
LoadModule headers_module modules/mod_headers.so

# CGI modules for PHP
LoadModule cgi_module modules/mod_cgi.so
LoadModule actions_module modules/mod_actions.so

# Proxy modules for PHP-FPM
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so

# SSL modules
LoadModule ssl_module modules/mod_ssl.so
LoadModule socache_shmcb_module modules/mod_socache_shmcb.so

TypesConfig "${mimeTypesPath}"

ServerName localhost:${httpPort}
DocumentRoot "${dataPath.replace(/\\/g, '/')}/www"

<Directory "${dataPath.replace(/\\/g, '/')}/www">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>

ErrorLog "${logsPath.replace(/\\/g, '/')}/error.log"
CustomLog "${logsPath.replace(/\\/g, '/')}/access.log" combined

IncludeOptional "${dataPath.replace(/\\/g, '/')}/apache/vhosts/*.conf"
`;
    await fs.writeFile(confPath, config);
  }

  // MySQL
  async startMySQL(version = '8.4') {
    const mysqlPath = this.getMySQLPath(version);
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    // Check if MySQL binary exists
    if (!await fs.pathExists(mysqldPath)) {
      this.managers.log?.systemError(`MySQL ${version} binary not found. Please download MySQL from the Binary Manager.`);
      const status = this.serviceStatus.get('mysql');
      status.status = 'not_installed';
      status.error = `MySQL ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    // Check if this specific version is already running
    const processKey = this.getProcessKey('mysql', version);
    if (this.processes.has(processKey)) {
      // MySQL already running - no action needed
      return;
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mysql', version, 'data');

    // Find available port dynamically based on version
    const defaultPort = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MySQL starting from ${defaultPort}`);
      }
    }

    // Store the actual port being used
    this.serviceConfigs.mysql.actualPort = port;

    // Ensure data directory exists
    await fs.ensureDir(dataDir);

    // Check if MySQL data directory needs initialization
    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    if (!isInitialized) {
      try {
        await this.initializeMySQLData(mysqlPath, dataDir);
      } catch (error) {
        this.managers.log?.systemError('MySQL initialization failed', { error: error.message });
        const status = this.serviceStatus.get('mysql');
        status.status = 'error';
        status.error = `Initialization failed: ${error.message}`;
        return;
      }
    }

    const configPath = path.join(dataPath, 'mysql', version, 'my.cnf');

    // Create init-file with credentials from ConfigStore (source of truth)
    // This runs on every startup to ensure credentials match ConfigStore
    const initFile = await this.createCredentialsInitFile('mysql', version);

    // Create MySQL config with init-file
    await fs.ensureDir(path.dirname(configPath));
    await this.createMySQLConfig(configPath, dataDir, port, version, initFile);

    let proc;
    if (process.platform === 'win32') {
      // On Windows, use spawnHidden to run without console window
      proc = spawnHidden(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('mysql', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('mysql', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('MySQL process error', { error: error.message });
        const status = this.serviceStatus.get('mysql');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', (code) => {
        const status = this.serviceStatus.get('mysql');
        if (status.status === 'running') {
          status.status = 'stopped';
        }
      });
    } else {
      proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('mysql', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('mysql', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('MySQL process error', { error: error.message });
        const status = this.serviceStatus.get('mysql');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', (code) => {
        const status = this.serviceStatus.get('mysql');
        if (status.status === 'running') {
          status.status = 'stopped';
        }
      });
    }

    this.processes.set(this.getProcessKey('mysql', version), proc);
    const status = this.serviceStatus.get('mysql');
    status.port = port;
    status.version = version;

    // Track this version as running
    this.runningVersions.get('mysql').set(version, { port, startedAt: new Date() });

    // Wait for MySQL to be ready
    try {
      await this.waitForService('mysql', 30000);
      status.status = 'running';
      status.startedAt = Date.now();
      // Credentials are applied via init-file before MySQL accepts connections
    } catch (error) {
      this.managers.log?.systemError(`MySQL ${version} failed to start`, { error: error.message });
      status.status = 'error';
      status.error = 'Failed to start within timeout. Check logs for details.';
      // Clean up the runningVersions entry on failure
      this.runningVersions.get('mysql').delete(version);
    }
  }

  /**
   * Sync credentials to all initialized database versions.
   * Called when user changes credentials in Settings.
   * Restarts running databases to apply new credentials from ConfigStore.
   */
  async syncCredentialsToAllVersions(newUser, newPassword, oldPassword = '') {
    const results = { mysql: [], mariadb: [] };

    // Credential change logged to system log
    this.managers.log?.systemInfo(`Database credentials changed: user=${newUser}, password=${newPassword ? 'set' : 'empty'}`);

    // Copy running versions to array BEFORE iterating (avoid modifying while iterating)
    const runningMySql = this.runningVersions.get('mysql');
    const mysqlVersionsToRestart = runningMySql ? Array.from(runningMySql.keys()) : [];

    if (mysqlVersionsToRestart.length > 0) {
      for (const version of mysqlVersionsToRestart) {
        try {
          this.managers.log?.systemInfo(`Restarting MySQL ${version} to apply new credentials...`);
          await this.stopService('mysql', version);
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.startService('mysql', version);
          // Wait additional time for init-file to fully apply credentials
          // This prevents race conditions where the database appears running
          // but hasn't finished processing the credential init-file
          await new Promise(resolve => setTimeout(resolve, 2000));
          results.mysql.push({ version, success: true });
        } catch (error) {
          this.managers.log?.systemError(`Failed to restart MySQL ${version}`, { error: error.message });
          results.mysql.push({ version, success: false, error: error.message });
        }
      }
    } else {
      // No running MySQL versions - nothing to restart
    }

    // Copy running versions to array BEFORE iterating
    const runningMariaDB = this.runningVersions.get('mariadb');
    const mariadbVersionsToRestart = runningMariaDB ? Array.from(runningMariaDB.keys()) : [];

    if (mariadbVersionsToRestart.length > 0) {
      for (const version of mariadbVersionsToRestart) {
        try {
          this.managers.log?.systemInfo(`Restarting MariaDB ${version} to apply new credentials...`);
          await this.stopService('mariadb', version);
          await new Promise(resolve => setTimeout(resolve, 1000));
          await this.startService('mariadb', version);
          // Wait additional time for init-file to fully apply credentials
          await new Promise(resolve => setTimeout(resolve, 2000));
          results.mariadb.push({ version, success: true });
        } catch (error) {
          this.managers.log?.systemError(`Failed to restart MariaDB ${version}`, { error: error.message });
          results.mariadb.push({ version, success: false, error: error.message });
        }
      }
    } else {
      // No running MariaDB versions - nothing to restart
    }

    return results;
  }

  /**
   * Update MySQL/MariaDB credentials using the mysql client
   */
  async updateMySQLCredentials(clientPath, port, newUser, newPassword, currentPassword) {
    const escapedPassword = newPassword.replace(/'/g, "''");
    const queries = [
      `ALTER USER '${newUser}'@'localhost' IDENTIFIED BY '${escapedPassword}'`,
      `ALTER USER '${newUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}'`,
      `FLUSH PRIVILEGES`,
    ];

    for (const query of queries) {
      await this.runMySQLQuery(clientPath, port, newUser, currentPassword, query);
    }
  }

  // Create init file for MySQL credential reset
  async createMySQLCredentialResetInitFile(user, password) {
    const dataPath = path.join(app.getPath('userData'), 'data');
    const initFile = path.join(dataPath, 'mysql_credential_reset.sql');

    const escapedPassword = password.replace(/'/g, "''");
    const sql = `
-- Reset credentials
ALTER USER '${user}'@'localhost' IDENTIFIED BY '${escapedPassword}';
ALTER USER '${user}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';
FLUSH PRIVILEGES;
`;

    await fs.writeFile(initFile, sql);
    return initFile;
  }

  /**
   * Create init-file with credentials from ConfigStore.
   * This file is executed by MySQL/MariaDB on startup with server privileges,
   * ensuring credentials always match what's in ConfigStore (the source of truth).
   * 
   * The init-file approach works because:
   * 1. MySQL/MariaDB execute init-file SQL with root/server privileges
   * 2. It runs BEFORE accepting client connections
   * 3. No authentication is needed - it's internal server execution
   */
  async createCredentialsInitFile(serviceName, version) {
    const dataPath = path.join(app.getPath('userData'), 'data');
    const initFile = path.join(dataPath, serviceName, version, 'credentials_init.sql');

    // Get credentials from ConfigStore (the source of truth)
    const settings = this.configStore?.get('settings', {}) || {};
    const dbUser = settings.dbUser || 'root';
    const dbPassword = settings.dbPassword || '';

    await fs.ensureDir(path.dirname(initFile));

    const escapedPassword = dbPassword.replace(/'/g, "''");

    // SQL to ensure user has correct password for both localhost and 127.0.0.1
    // We need both because:
    // - 'localhost' is used for socket/pipe connections  
    // - '127.0.0.1' is used for TCP connections (which our queries use)
    // Use CREATE IF NOT EXISTS + ALTER USER (safer than DROP/CREATE which can fail
    // because MySQL is running as the root user we're trying to drop)
    // Build SQL as array of lines to avoid encoding issues with template literals
    const sqlLines = [
      '-- Auto-generated credentials from DevBox Pro ConfigStore',
      '-- This file runs on every startup to ensure credentials match settings',
      '',
      '-- Create users if they don\'t exist (fresh install case)',
      `CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      '',
      '-- Update password for existing users (handles password change case)',
      `ALTER USER '${dbUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${dbUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      '',
      '-- Grant all privileges',
      `GRANT ALL PRIVILEGES ON *.* TO '${dbUser}'@'localhost' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${dbUser}'@'127.0.0.1' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${dbUser}'@'%' WITH GRANT OPTION;`,
      '',
      'FLUSH PRIVILEGES;',
      ''
    ];
    const sql = sqlLines.join('\n');

    await fs.writeFile(initFile, sql, 'utf8');
    return initFile;
  }

  // Helper to run a MySQL query
  async runMySQLQuery(clientPath, port, user, password, query) {
    return new Promise((resolve, reject) => {
      const args = [
        `-h127.0.0.1`,
        `-P${port}`,
        `-u${user}`,
        '-N',
        '-B',
        '-e',
        query,
      ];

      if (password) {
        args.splice(3, 0, `-p${password}`);
      }

      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          // Ignore "Using a password" warnings
          if (stderr.includes('ERROR')) {
            reject(new Error(stderr));
          } else {
            resolve();
          }
        }
      });

      proc.on('error', reject);
    });
  }

  // Start MySQL directly without credential verification (used after credential reset to avoid infinite loop)
  async startMySQLDirect(version = '8.4') {
    const mysqlPath = this.getMySQLPath(version);
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    if (!await fs.pathExists(mysqldPath)) {
      throw new Error(`MySQL ${version} binary not found`);
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mysql', version, 'data');
    const configPath = path.join(dataPath, 'mysql', version, 'my.cnf');

    // Find available port
    const defaultPort = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MySQL`);
      }
    }

    this.serviceConfigs.mysql.actualPort = port;

    // Create init-file with credentials from ConfigStore
    const initFile = await this.createCredentialsInitFile('mysql', version);

    // Update config with new port and init-file
    await this.createMySQLConfig(configPath, dataDir, port, version, initFile);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }

    proc.stdout?.on('data', (data) => {
      this.managers.log?.service('mysql', data.toString());
    });
    proc.stderr?.on('data', (data) => {
      this.managers.log?.service('mysql', data.toString(), 'error');
    });
    proc.on('error', (error) => {
      this.managers.log?.systemError('MySQL process error', { error: error.message });
    });
    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('mysql');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set(this.getProcessKey('mysql', version), proc);
    const status = this.serviceStatus.get('mysql');
    status.port = port;
    status.version = version;

    this.runningVersions.get('mysql').set(version, { port, startedAt: new Date() });

    // Wait for MySQL to be ready
    await this.waitForService('mysql', 30000);
    status.status = 'running';
    status.startedAt = Date.now();
  }

  async initializeMySQLData(mysqlPath, dataDir, version = '8.4') {
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    // Ensure data directory is empty before initialization
    await fs.emptyDir(dataDir);

    return new Promise((resolve, reject) => {
      const proc = spawn(mysqldPath, ['--initialize-insecure', `--datadir=${dataDir}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`MySQL initialization failed: ${stderr}`));
        }
      });
    });
  }

  async createMySQLConfig(configPath, dataDir, port, version = '8.4', initFile = null) {
    const isWindows = process.platform === 'win32';
    const mysqlPath = this.getMySQLPath(version);

    // Build init-file line if provided (for applying credentials from ConfigStore)
    const initFileLine = initFile ? `init-file=${initFile.replace(/\\/g, '/')}\n` : '';

    // Get timezone from settings and convert to UTC offset for MySQL compatibility
    const settings = this.configStore?.get('settings', {}) || {};
    const timezone = settings.serverTimezone || 'UTC';
    const timezoneOffset = this.getTimezoneOffset(timezone);

    let config;
    if (isWindows) {
      // Windows-specific config for MySQL
      // Note: skip-grant-tables causes skip_networking=ON in MySQL 8.4, so we don't use it
      // Instead, we use init-file to apply credentials from ConfigStore on every startup
      config = `[mysqld]
basedir=${mysqlPath.replace(/\\/g, '/')}
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=0.0.0.0
enable-named-pipe=ON
socket=MYSQL_${version.replace(/\./g, '')}
pid-file=${path.join(dataDir, 'mysql.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}
default-time-zone='${timezoneOffset}'
${initFileLine}innodb_buffer_pool_size=128M
innodb_redo_log_capacity=100M
max_connections=100
loose-mysqlx=0
skip-log-bin

[client]
port=${port}
`;
    } else {
      // Unix/macOS config with socket
      config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=127.0.0.1
socket=${path.join(dataDir, 'mysql.sock').replace(/\\/g, '/')}
pid-file=${path.join(dataDir, 'mysql.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}
default-time-zone='${timezoneOffset}'
${initFileLine}
[client]
port=${port}
socket=${path.join(dataDir, 'mysql.sock').replace(/\\/g, '/')}
`;
    }

    await fs.writeFile(configPath, config);
  }

  /**
   * Convert IANA timezone name to UTC offset string for MySQL compatibility.
   * MySQL on Windows doesn't have timezone tables loaded by default, so we use offsets.
   * For unknown timezones, we try to calculate the offset dynamically using JavaScript's Intl API.
   * @param {string} timezone - IANA timezone name (e.g., 'Asia/Manila')
   * @returns {string} UTC offset string (e.g., '+08:00')
   */
  getTimezoneOffset(timezone) {
    // Known offsets for common timezones (note: doesn't handle DST)
    const knownOffsets = {
      'UTC': '+00:00',
      'Asia/Manila': '+08:00',
      'Asia/Singapore': '+08:00',
      'Asia/Shanghai': '+08:00',
      'Asia/Hong_Kong': '+08:00',
      'Asia/Tokyo': '+09:00',
      'Asia/Seoul': '+09:00',
      'Asia/Dubai': '+04:00',
      'Asia/Kolkata': '+05:30',
      'Asia/Jakarta': '+07:00',
      'America/New_York': '-05:00',
      'America/Chicago': '-06:00',
      'America/Denver': '-07:00',
      'America/Los_Angeles': '-08:00',
      'America/Sao_Paulo': '-03:00',
      'Europe/London': '+00:00',
      'Europe/Paris': '+01:00',
      'Europe/Berlin': '+01:00',
      'Europe/Moscow': '+03:00',
      'Australia/Sydney': '+10:00',
      'Australia/Melbourne': '+10:00',
      'Pacific/Auckland': '+12:00',
    };

    // If we have a known offset, use it
    if (knownOffsets[timezone]) {
      return knownOffsets[timezone];
    }

    // Try to dynamically calculate offset for unknown timezones
    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset',
      });

      const parts = formatter.formatToParts(now);
      const tzPart = parts.find(p => p.type === 'timeZoneName');

      if (tzPart && tzPart.value) {
        // Format like "GMT+8" or "GMT-5:30"
        const match = tzPart.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
        if (match) {
          const sign = match[1];
          const hours = match[2].padStart(2, '0');
          const minutes = match[3] || '00';
          return `${sign}${hours}:${minutes}`;
        }
      }
    } catch (e) {
      // Invalid timezone - fall back to UTC
      this.managers?.log?.systemWarn(`Invalid timezone: ${timezone}, falling back to UTC`);
    }

    return '+00:00';
  }

  // MariaDB
  async startMariaDB(version = '11.4') {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const mariadbPath = this.getMariaDBPath(version);
    const mariadbd = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');

    // Check if MariaDB binary exists
    if (!await fs.pathExists(mariadbd)) {
      this.managers.log?.systemError(`MariaDB ${version} binary not found. Please download MariaDB from the Binary Manager.`);
      const status = this.serviceStatus.get('mariadb');
      status.status = 'not_installed';
      status.error = `MariaDB ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    // Check if this specific version is already running
    const processKey = this.getProcessKey('mariadb', version);
    if (this.processes.has(processKey)) {
      // MariaDB already running - no action needed
      return;
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mariadb', version, 'data');

    // Find available port dynamically based on version
    const defaultPort = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MariaDB starting from ${defaultPort}`);
      }
    }

    // Store the actual port being used
    this.serviceConfigs.mariadb.actualPort = port;

    // Check if MariaDB data directory needs initialization
    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    if (!isInitialized) {
      await this.initializeMariaDBData(mariadbPath, dataDir);
    }

    const configPath = path.join(dataPath, 'mariadb', version, 'my.cnf');

    // Create init-file with credentials from ConfigStore (source of truth)
    // This runs on every startup to ensure credentials match ConfigStore
    const initFile = await this.createCredentialsInitFile('mariadb', version);

    // Create MariaDB config with init-file
    await this.createMariaDBConfig(configPath, dataDir, port, version, initFile);

    const proc = spawn(mariadbd, [`--defaults-file=${configPath}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('mariadb', data.toString());
    });

    proc.stderr.on('data', (data) => {
      this.managers.log?.service('mariadb', data.toString(), 'error');
    });

    proc.on('error', (error) => {
      this.managers.log?.systemError('MariaDB process error', { error: error.message });
      const status = this.serviceStatus.get('mariadb');
      status.status = 'error';
      status.error = error.message;
    });

    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('mariadb');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set(this.getProcessKey('mariadb', version), proc);
    const status = this.serviceStatus.get('mariadb');
    status.pid = proc.pid;
    status.port = port;
    status.version = version;

    // Track this version as running
    this.runningVersions.get('mariadb').set(version, { port, startedAt: new Date() });

    // Wait for MariaDB to be ready
    try {
      await this.waitForService('mariadb', 30000);
      status.status = 'running';
      status.startedAt = Date.now();
      // Credentials are applied via init-file before MariaDB accepts connections
    } catch (error) {
      this.managers.log?.systemError(`MariaDB ${version} failed to start`, { error: error.message });
      status.status = 'error';
      status.error = 'Failed to start within timeout. Check logs for details.';
      this.runningVersions.get('mariadb').delete(version);
    }
  }

  // Start MariaDB directly without credential verification (used after credential reset)
  async startMariaDBDirect(version = '11.4') {
    const mariadbPath = this.getMariaDBPath(version);
    const mariadbd = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');

    if (!await fs.pathExists(mariadbd)) {
      throw new Error(`MariaDB ${version} binary not found`);
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mariadb', version, 'data');
    const configPath = path.join(dataPath, 'mariadb', version, 'my.cnf');

    // Find available port
    const defaultPort = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MariaDB`);
      }
    }

    this.serviceConfigs.mariadb.actualPort = port;

    // Create init-file with credentials from ConfigStore
    const initFile = await this.createCredentialsInitFile('mariadb', version);

    // Update config with init-file
    await this.createMariaDBConfig(configPath, dataDir, port, version, initFile);

    const proc = spawn(mariadbd, [`--defaults-file=${configPath}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('mariadb', data.toString());
    });
    proc.stderr.on('data', (data) => {
      this.managers.log?.service('mariadb', data.toString(), 'error');
    });
    proc.on('error', (error) => {
      this.managers.log?.systemError('MariaDB process error', { error: error.message });
    });
    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('mariadb');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set(this.getProcessKey('mariadb', version), proc);
    const status = this.serviceStatus.get('mariadb');
    status.pid = proc.pid;
    status.port = port;
    status.version = version;

    this.runningVersions.get('mariadb').set(version, { port, startedAt: new Date() });

    await this.waitForService('mariadb', 30000);
    status.status = 'running';
    status.startedAt = Date.now();
  }

  async initializeMariaDBData(mariadbPath, dataDir, version = '11.4') {
    // MariaDB uses mysql_install_db or mariadb-install-db
    const installDb = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadb-install-db.exe' : 'mariadb-install-db');

    await fs.ensureDir(dataDir);

    return new Promise((resolve, reject) => {
      // Note: Newer MariaDB versions don't support --auth-root-authentication-method
      // Just use --datadir for initialization
      const proc = spawn(installDb, [`--datadir=${dataDir}`], {
        cwd: mariadbPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => (stderr += data.toString()));

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`MariaDB initialization failed: ${stderr}`));
        }
      });
    });
  }

  async createMariaDBConfig(configPath, dataDir, port, version = '11.4', initFile = null) {
    await fs.ensureDir(path.dirname(configPath));
    const isWindows = process.platform === 'win32';
    const mariadbPath = this.getMariaDBPath(version);

    // Build init-file line if provided (for applying credentials from ConfigStore)
    const initFileLine = initFile ? `init-file=${initFile.replace(/\\/g, '/')}\n` : '';

    // Get timezone from settings and convert to UTC offset for compatibility
    const settings = this.configStore?.get('settings', {}) || {};
    const timezone = settings.serverTimezone || 'UTC';
    const timezoneOffset = this.getTimezoneOffset(timezone);

    let config;
    if (isWindows) {
      // Windows-specific config - no socket, use TCP/IP and named pipe
      // Use unique named pipe name to avoid conflict with MySQL
      // Credentials are applied via init-file from ConfigStore
      config = `[mysqld]
basedir=${mariadbPath.replace(/\\/g, '/')}
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=127.0.0.1
enable_named_pipe=ON
socket=MARIADB_${version.replace(/\./g, '')}
pid-file=${path.join(dataDir, 'mariadb.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}
default-time-zone='${timezoneOffset}'
${initFileLine}innodb_buffer_pool_size=128M
max_connections=100

[client]
port=${port}
socket=MARIADB_${version.replace(/\./g, '')}
`;
    } else {
      // Unix/macOS config with socket
      // Credentials are applied via init-file from ConfigStore
      config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=127.0.0.1
socket=${path.join(dataDir, 'mariadb.sock').replace(/\\/g, '/')}
pid-file=${path.join(dataDir, 'mariadb.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}
default-time-zone='${timezoneOffset}'
${initFileLine}
[client]
port=${port}
socket=${path.join(dataDir, 'mariadb.sock').replace(/\\/g, '/')}
`;
    }

    await fs.writeFile(configPath, config);
  }

  // Redis
  async startRedis(version = '7.4') {
    const redisPath = this.getRedisPath(version);
    const redisServerPath = path.join(
      redisPath,
      process.platform === 'win32' ? 'redis-server.exe' : 'redis-server'
    );

    // Check if Redis binary exists
    if (!await fs.pathExists(redisServerPath)) {
      this.managers.log?.systemError(`Redis ${version} binary not found. Please download Redis from the Binary Manager.`);
      const status = this.serviceStatus.get('redis');
      status.status = 'not_installed';
      status.error = `Redis ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'redis', version, 'data');

    // Ensure data directory exists
    await fs.ensureDir(dataDir);

    // Find available port dynamically based on version
    const defaultPort = this.getVersionPort('redis', version, this.serviceConfigs.redis.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for Redis starting from ${defaultPort}`);
      }
    }

    // Store the actual port being used
    this.serviceConfigs.redis.actualPort = port;

    const configPath = path.join(dataPath, 'redis', version, 'redis.conf');
    await this.createRedisConfig(configPath, dataDir, port, version);

    // MSYS2/Cygwin Redis builds have path interpretation issues on Windows
    // Solution: Set CWD to the config directory and pass config as relative path
    const configDir = path.dirname(configPath);
    const configFilename = path.basename(configPath);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(redisServerPath, [configFilename], {
        cwd: configDir, // Run from config directory to avoid path issues
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('redis', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('redis', data.toString(), 'error');
      });
    } else {
      proc = spawn(redisServerPath, [configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('redis', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('redis', data.toString(), 'error');
      });
    }

    this.processes.set(this.getProcessKey('redis', version), proc);
    const status = this.serviceStatus.get('redis');
    status.port = port;
    status.version = version;

    // Track this version as running
    this.runningVersions.get('redis').set(version, { port, startedAt: new Date() });

    try {
      await this.waitForService('redis', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`Redis ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = `Redis ${version} failed to start properly: ${error.message}`;
      this.runningVersions.get('redis').delete(version);
      throw error;
    }
  }

  async createRedisConfig(configPath, dataDir, port, version = '7.4') {
    await fs.ensureDir(path.dirname(configPath));
    await fs.ensureDir(dataDir);

    // Use relative path 'data' since Redis runs from config directory
    // The data dir is at: .../redis/<version>/data
    // The config is at:   .../redis/<version>/redis.conf
    // So relative path from config to data is just 'data'
    const config = `
port ${port}
bind 127.0.0.1
daemonize no
dir ./data
appendonly yes
appendfilename "appendonly.aof"
dbfilename dump_${version.replace(/\./g, '')}.rdb
`;
    await fs.writeFile(configPath, config);
  }

  // Mailpit
  async startMailpit() {
    const mailpitPath = this.getMailpitPath();
    const mailpitBin = path.join(mailpitPath, process.platform === 'win32' ? 'mailpit.exe' : 'mailpit');

    // Check if Mailpit binary exists
    if (!await fs.pathExists(mailpitBin)) {
      this.managers.log?.systemError('Mailpit binary not found. Please download Mailpit from the Binary Manager.');
      const status = this.serviceStatus.get('mailpit');
      status.status = 'not_installed';
      status.error = 'Mailpit binary not found. Please download from Binary Manager.';
      return;
    }

    // Find available ports dynamically
    const defaultPort = this.serviceConfigs.mailpit.defaultPort;
    const defaultSmtpPort = this.serviceConfigs.mailpit.smtpPort;

    let port = defaultPort;
    let smtpPort = defaultSmtpPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available web port for Mailpit starting from ${defaultPort}`);
      }
    }

    if (!await isPortAvailable(smtpPort)) {
      smtpPort = await findAvailablePort(defaultSmtpPort, 100);
      if (!smtpPort) {
        throw new Error(`Could not find available SMTP port for Mailpit starting from ${defaultSmtpPort}`);
      }
    }

    // Store the actual ports being used
    this.serviceConfigs.mailpit.actualPort = port;
    this.serviceConfigs.mailpit.actualSmtpPort = smtpPort;

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(mailpitBin, ['--listen', `127.0.0.1:${port}`, '--smtp', `127.0.0.1:${smtpPort}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString(), 'error');
      });
    } else {
      proc = spawn(mailpitBin, ['--listen', `127.0.0.1:${port}`, '--smtp', `127.0.0.1:${smtpPort}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString(), 'error');
      });
    }

    this.processes.set('mailpit', proc);
    const status = this.serviceStatus.get('mailpit');
    status.port = port;
    status.smtpPort = smtpPort;

    try {
      await this.waitForService('mailpit', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError('Mailpit failed to become ready', { error: error.message });
      status.status = 'error';
      status.error = `Mailpit failed to start properly: ${error.message}`;
      throw error;
    }
  }

  // phpMyAdmin (using built-in PHP server)
  async startPhpMyAdmin() {
    const phpManager = this.managers.php;
    const defaultPhp = phpManager.getDefaultVersion();

    // Check if any PHP version is available
    const availableVersions = phpManager.getAvailableVersions().filter(v => v.available);
    if (availableVersions.length === 0) {
      this.managers.log?.systemError('No PHP version available. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'No PHP version available. Please download from Binary Manager.';
      return;
    }

    let phpPath;
    try {
      phpPath = phpManager.getPhpBinaryPath(defaultPhp);
    } catch (error) {
      this.managers.log?.systemError('PHP binary not found. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'PHP binary not found. Please download from Binary Manager.';
      return;
    }

    // Check if PHP binary exists
    if (!await fs.pathExists(phpPath)) {
      this.managers.log?.systemError('PHP binary not found. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'PHP binary not found. Please download from Binary Manager.';
      return;
    }

    // Ensure mysqli extension is enabled for phpMyAdmin
    try {
      const extensions = phpManager.getExtensions(defaultPhp);
      const mysqliExt = extensions.find(ext => ext.name === 'mysqli');
      if (mysqliExt && !mysqliExt.enabled) {
        await phpManager.toggleExtension(defaultPhp, 'mysqli', true);
      }
    } catch (error) {
      // Ignore - extension may not be available
    }

    const phpmyadminPath = path.join(this.resourcePath, 'phpmyadmin');

    // Check if phpMyAdmin is installed
    if (!await fs.pathExists(phpmyadminPath)) {
      this.managers.log?.systemError('phpMyAdmin not found. Please download phpMyAdmin from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'phpMyAdmin not found. Please download from Binary Manager.';
      return;
    }

    // Check if MySQL or MariaDB is running - phpMyAdmin needs a database to work
    // Don't auto-start any database - let the user/project control which one runs
    const mysqlStatus = this.serviceStatus.get('mysql');
    const mariadbStatus = this.serviceStatus.get('mariadb');
    const hasDatabaseRunning = mysqlStatus?.status === 'running' || mariadbStatus?.status === 'running';

    if (!hasDatabaseRunning) {
      // phpMyAdmin will start but may not be fully functional until a database is started
    }

    // Find available port dynamically
    const defaultPort = this.serviceConfigs.phpmyadmin.defaultPort;
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for phpMyAdmin starting from ${defaultPort}`);
      }
    }

    // Store the actual port being used
    this.serviceConfigs.phpmyadmin.actualPort = port;

    // Update phpMyAdmin configuration to support all installed database versions
    // This allows connecting to any running database instance
    try {
      await this.updatePhpMyAdminConfig(phpmyadminPath);
    } catch (error) {
      this.managers.log?.systemError('Failed to update phpMyAdmin config', { error: error.message });
      // Continue anyway, it might still work with defaults
    }

    // Get PHP directory for php.ini location
    const phpDir = path.dirname(phpPath);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(phpPath, ['-S', `127.0.0.1:${port}`, '-t', phpmyadminPath, '-c', phpDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString(), 'error');
      });
    } else {
      proc = spawn(phpPath, ['-S', `127.0.0.1:${port}`, '-t', phpmyadminPath, '-c', phpDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString(), 'error');
      });
    }

    this.processes.set('phpmyadmin', proc);
    const status = this.serviceStatus.get('phpmyadmin');
    status.port = port;

    try {
      await this.waitForService('phpmyadmin', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError('phpMyAdmin failed to become ready', { error: error.message });
      status.status = 'error';
      status.error = `phpMyAdmin failed to start properly: ${error.message}`;
      throw error;
    }
  }

  // Update phpMyAdmin configuration with all installed database servers
  async updatePhpMyAdminConfig(pmaPath) {
    const servers = [];
    let serverIndex = 1;

    // Get installed binaries to filter only installed database versions
    let installedBinaries = { mysql: {}, mariadb: {} };
    if (this.managers.binaryDownload) {
      try {
        installedBinaries = await this.managers.binaryDownload.getInstalledBinaries();
      } catch (err) {
        this.managers.log?.systemWarn('Could not get installed binaries, showing all versions', { error: err.message });
      }
    }

    // Helper to add server config
    const addServer = (name, port, verboseName) => {
      servers.push(`
$cfg['Servers'][${serverIndex}]['verbose'] = '${verboseName}';
$cfg['Servers'][${serverIndex}]['host'] = '127.0.0.1';
$cfg['Servers'][${serverIndex}]['port'] = '${port}';
$cfg['Servers'][${serverIndex}]['auth_type'] = 'cookie';
$cfg['Servers'][${serverIndex}]['user'] = 'root';
$cfg['Servers'][${serverIndex}]['password'] = '';
$cfg['Servers'][${serverIndex}]['AllowNoPassword'] = true;
`);
      serverIndex++;
    };

    // Add MySQL versions (only installed ones)
    // Sort versions to ensure deterministic ID assignment (newer first)
    // This is crucial for the Smart URL strategy to work correctly
    const mysqlVersions = (SERVICE_VERSIONS.mysql || [])
      .filter(v => installedBinaries.mysql?.[v] === true)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of mysqlVersions) {
      const port = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
      addServer('mysql', port, `MySQL ${version}`);
    }

    // Add MariaDB versions (only installed ones)
    const mariadbVersions = (SERVICE_VERSIONS.mariadb || [])
      .filter(v => installedBinaries.mariadb?.[v] === true)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of mariadbVersions) {
      const port = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
      addServer('mariadb', port, `MariaDB ${version}`);
    }

    // If no servers found, add a default fallback
    if (servers.length === 0) {
      addServer('mysql', 3306, 'MySQL');
    }

    // Generate secret for cookie auth
    const generateSecret = (length) => {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const configContent = `<?php
/**
 * phpMyAdmin configuration for DevBox Pro
 * AUTO-GENERATED - DO NOT EDIT MANUALLY
 */

$cfg['blowfish_secret'] = '${generateSecret(32)}';
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
$cfg['DefaultLang'] = 'en';
$cfg['ServerDefault'] = 1; // Default to first server

// Server Configurations
${servers.join('')}
`;

    await fs.writeFile(path.join(pmaPath, 'config.inc.php'), configContent);
  }

  // Utility methods - Path helpers for versioned services
  getNginxPath(version) {
    const v = version || '1.28';
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'nginx', v, platform);
  }

  getApachePath(version) {
    const v = version || '2.4';
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'apache', v, platform);
  }

  getMySQLPath(version) {
    const v = version || '8.4';
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'mysql', v, platform);
  }

  getMariaDBPath(version) {
    const v = version || '11.4';
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'mariadb', v, platform);
  }

  getRedisPath(version) {
    const v = version || '7.4';
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'redis', v, platform);
  }

  getMailpitPath() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'mailpit', platform);
  }

  getPhpMyAdminPath() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'phpmyadmin', platform);
  }

  /**
   * Get all running versions for a service
   * @param {string} serviceName - The service name
   * @returns {Map} - Map of version -> { port, startedAt }
   */
  getRunningVersions(serviceName) {
    return this.runningVersions.get(serviceName) || new Map();
  }

  /**
   * Get all running versions for all services
   * @returns {Map} - Map of serviceName -> Map of version -> { port, startedAt }
   */
  getAllRunningVersions() {
    return this.runningVersions;
  }

  /**
   * Check if a specific version of a service is running
   * @param {string} serviceName - The service name
   * @param {string} version - The version to check
   * @returns {boolean}
   */
  isVersionRunning(serviceName, version) {
    const versions = this.runningVersions.get(serviceName);
    return versions ? versions.has(version) : false;
  }

  async killOrphanMySQLProcesses() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec('taskkill /F /IM mysqld.exe 2>nul', (error) => {
          // Ignore errors - process may not exist
          setTimeout(resolve, 1000); // Wait a bit for locks to release
        });
      } else {
        exec('pkill -9 mysqld 2>/dev/null', (error) => {
          setTimeout(resolve, 1000);
        });
      }
    });
  }

  async killOrphanMariaDBProcesses() {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        exec('taskkill /F /IM mariadbd.exe 2>nul', (error) => {
          // Ignore errors - process may not exist
          setTimeout(resolve, 1000); // Wait a bit for locks to release
        });
      } else {
        exec('pkill -9 mariadbd 2>/dev/null', (error) => {
          setTimeout(resolve, 1000);
        });
      }
    });
  }

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
  }

  async checkNginxHealth() {
    const port = this.serviceConfigs.nginx.actualHttpPort || this.serviceConfigs.nginx.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkApacheHealth() {
    const port = this.serviceConfigs.apache.actualHttpPort || this.serviceConfigs.apache.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkMySqlHealth() {
    const port = this.serviceConfigs.mysql.actualPort || this.serviceConfigs.mysql.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkMariaDbHealth() {
    const port = this.serviceConfigs.mariadb.actualPort || this.serviceConfigs.mariadb.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkRedisHealth() {
    const port = this.serviceConfigs.redis.actualPort || this.serviceConfigs.redis.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkMailpitHealth() {
    const port = this.serviceConfigs.mailpit.actualPort || this.serviceConfigs.mailpit.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkPhpMyAdminHealth() {
    const port = this.serviceConfigs.phpmyadmin.actualPort || this.serviceConfigs.phpmyadmin.defaultPort;
    return this.checkPortOpen(port);
  }

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
  }

  async killProcess(proc) {
    return new Promise((resolve) => {
      const kill = require('tree-kill');

      if (!proc || !proc.pid) {
        resolve();
        return;
      }

      kill(proc.pid, 'SIGTERM', (err) => {
        // Ignore errors - process may already be terminated
        // This is normal during shutdown
        resolve();
      });
    });
  }

  getAllServicesStatus() {
    const result = {};
    for (const [key, status] of this.serviceStatus) {
      let uptime = null;
      if (status.startedAt) {
        // Handle both Date objects and ISO strings
        const startedAtTime = status.startedAt instanceof Date
          ? status.startedAt.getTime()
          : new Date(status.startedAt).getTime();
        uptime = Date.now() - startedAtTime;
      }

      // For versioned services, include all running versions
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
        runningVersions, // Include all running versions info
      };
    }
    return result;
  }

  /**
   * Get the actual ports being used by a service
   * @param {string} serviceName - The name of the service
   * @returns {Object} - Object with httpPort and sslPort
   */
  getServicePorts(serviceName) {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      return null;
    }

    // If actual ports are set, use those
    if (config.actualHttpPort) {
      // If actualSslPort is set, use it. Otherwise check if we're on alternate ports
      let sslPort = config.actualSslPort;
      if (!sslPort) {
        // Determine if we should use alternate or standard based on HTTP port
        const isOnAlternate = config.actualHttpPort !== this.webServerPorts.standard.http;
        sslPort = isOnAlternate ? (config.alternateSslPort || config.sslPort) : config.sslPort;
      }

      return {
        httpPort: config.actualHttpPort,
        sslPort: sslPort,
      };
    }


    // For web servers, predict ports based on port ownership
    if (serviceName === 'nginx' || serviceName === 'apache') {
      // Check who owns standard ports
      if (this.standardPortOwner === null) {
        // No one owns yet - check if the OTHER web server is running
        const otherServer = serviceName === 'nginx' ? 'apache' : 'nginx';
        const otherStatus = this.serviceStatus.get(otherServer);
        if (otherStatus?.status === 'running') {
          // Other server is running, use alternate ports
          return {
            httpPort: config.alternatePort || this.webServerPorts.alternate.http,
            sslPort: config.alternateSslPort || this.webServerPorts.alternate.https,
          };
        }
        // No other server running, assume we'll get standard ports
        return {
          httpPort: this.webServerPorts.standard.http,
          sslPort: this.webServerPorts.standard.https,
        };
      } else if (this.standardPortOwner === serviceName) {
        // We own standard ports
        return {
          httpPort: this.webServerPorts.standard.http,
          sslPort: this.webServerPorts.standard.https,
        };
      } else {
        // Other server owns standard ports, we get alternate
        return {
          httpPort: config.alternatePort || this.webServerPorts.alternate.http,
          sslPort: config.alternateSslPort || this.webServerPorts.alternate.https,
        };
      }
    }

    // For non-web servers, use default ports
    return {
      httpPort: config.actualHttpPort || config.defaultPort,
      sslPort: config.actualSslPort || config.sslPort,
    };
  }

  /**
   * Calculate port for a specific version based on offset
   * @param {string} service - Service name (mysql, mariadb, etc)
   * @param {string} version - Version string
   * @param {number} defaultPort - Base port
   * @returns {number} - Calculated port
   */
  getVersionPort(service, version, defaultPort) {
    const offset = this.versionPortOffsets[service]?.[version] || 0;
    return defaultPort + offset;
  }

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
  }

  async getProcessStats(pid) {
    // Basic implementation - in production, use a library like pidusage
    return {
      cpu: Math.random() * 5, // Placeholder
      memory: Math.random() * 100 * 1024 * 1024, // Placeholder
    };
  }
}

module.exports = { ServiceManager };
