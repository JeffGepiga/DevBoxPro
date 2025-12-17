const path = require('path');
const fs = require('fs-extra');
const { spawn, exec } = require('child_process');
const { EventEmitter } = require('events');

class ServiceManager extends EventEmitter {
  constructor(resourcePath, configStore, managers) {
    super();
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.processes = new Map();
    this.serviceStatus = new Map();

    // Service definitions
    this.serviceConfigs = {
      mysql: {
        name: 'MySQL',
        defaultPort: 3306,
        healthCheck: this.checkMySqlHealth.bind(this),
      },
      redis: {
        name: 'Redis',
        defaultPort: 6379,
        healthCheck: this.checkRedisHealth.bind(this),
      },
      mailpit: {
        name: 'Mailpit',
        defaultPort: 8025,
        smtpPort: 1025,
        healthCheck: this.checkMailpitHealth.bind(this),
      },
      phpmyadmin: {
        name: 'phpMyAdmin',
        defaultPort: 8080,
        healthCheck: this.checkPhpMyAdminHealth.bind(this),
      },
    };
  }

  async initialize() {
    console.log('Initializing ServiceManager...');

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
      });
    }

    // Ensure data directories exist
    const dataPath = this.configStore.get('dataPath');
    await fs.ensureDir(path.join(dataPath, 'mysql', 'data'));
    await fs.ensureDir(path.join(dataPath, 'redis'));
    await fs.ensureDir(path.join(dataPath, 'logs'));

    console.log('ServiceManager initialized');
  }

  async startCoreServices() {
    console.log('Starting core services...');

    const services = ['mysql', 'redis', 'mailpit', 'phpmyadmin'];
    const results = [];

    for (const service of services) {
      try {
        const result = await this.startService(service);
        results.push({ service, success: result.success, status: result.status });
      } catch (error) {
        console.error(`Error starting ${service}:`, error);
        results.push({ service, success: false, error: error.message });
      }
    }

    const startedCount = results.filter(r => r.success).length;
    const notInstalledCount = results.filter(r => r.status === 'not_installed').length;
    console.log(`Core services started: ${startedCount}/${services.length} (${notInstalledCount} not installed)`);
    return results;
  }

  async startService(serviceName) {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    console.log(`Starting ${config.name}...`);

    try {
      switch (serviceName) {
        case 'mysql':
          await this.startMySQL();
          break;
        case 'redis':
          await this.startRedis();
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
        this.emit('serviceStarted', serviceName);
      }

      return { success: status.status === 'running', service: serviceName, status: status.status };
    } catch (error) {
      console.error(`Failed to start ${config.name}:`, error);
      const status = this.serviceStatus.get(serviceName);
      status.status = 'error';
      status.error = error.message;
      throw error;
    }
  }

  async stopService(serviceName) {
    const config = this.serviceConfigs[serviceName];
    if (!config) {
      throw new Error(`Unknown service: ${serviceName}`);
    }

    console.log(`Stopping ${config.name}...`);

    const process = this.processes.get(serviceName);
    if (process) {
      await this.killProcess(process);
      this.processes.delete(serviceName);
    }

    const status = this.serviceStatus.get(serviceName);
    status.status = 'stopped';
    status.pid = null;
    status.startedAt = null;
    this.emit('serviceStopped', serviceName);

    return { success: true, service: serviceName };
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
    for (const serviceName of Object.keys(this.serviceConfigs)) {
      try {
        await this.stopService(serviceName);
        results.push({ service: serviceName, success: true });
      } catch (error) {
        results.push({ service: serviceName, success: false, error: error.message });
      }
    }
    return results;
  }

  // MySQL
  async startMySQL() {
    const mysqlPath = this.getMySQLPath();
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');
    
    // Check if MySQL binary exists
    if (!await fs.pathExists(mysqldPath)) {
      console.log('MySQL binary not found. Please download MySQL from the Binary Manager.');
      const status = this.serviceStatus.get('mysql');
      status.status = 'not_installed';
      status.error = 'MySQL binary not found. Please download from Binary Manager.';
      return;
    }

    const dataPath = this.configStore.get('dataPath');
    const dataDir = path.join(dataPath, 'mysql', 'data');
    const port = this.serviceConfigs.mysql.defaultPort;

    // Check if MySQL data directory needs initialization
    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    if (!isInitialized) {
      console.log('Initializing MySQL data directory...');
      await this.initializeMySQLData(mysqlPath, dataDir);
    }

    const configPath = path.join(dataPath, 'mysql', 'my.cnf');

    // Create MySQL config
    await this.createMySQLConfig(configPath, dataDir, port);

    const proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
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
      console.error('MySQL process error:', error);
      const status = this.serviceStatus.get('mysql');
      status.status = 'error';
      status.error = error.message;
    });

    proc.on('exit', (code) => {
      console.log(`MySQL exited with code ${code}`);
      const status = this.serviceStatus.get('mysql');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set('mysql', proc);
    const status = this.serviceStatus.get('mysql');
    status.pid = proc.pid;
    status.port = port;

    // Wait for MySQL to be ready
    await this.waitForService('mysql', 30000);
  }

  async initializeMySQLData(mysqlPath, dataDir) {
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    return new Promise((resolve, reject) => {
      const proc = spawn(mysqldPath, ['--initialize-insecure', `--datadir=${dataDir}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (data) => (stderr += data.toString()));

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`MySQL initialization failed: ${stderr}`));
        }
      });
    });
  }

  async createMySQLConfig(configPath, dataDir, port) {
    const config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
skip-grant-tables
skip-networking=0
bind-address=127.0.0.1
socket=${path.join(dataDir, 'mysql.sock').replace(/\\/g, '/')}
pid-file=${path.join(dataDir, 'mysql.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}

[client]
port=${port}
socket=${path.join(dataDir, 'mysql.sock').replace(/\\/g, '/')}
`;

    await fs.writeFile(configPath, config);
  }

  // Redis
  async startRedis() {
    const redisPath = this.getRedisPath();
    const redisServerPath = path.join(
      redisPath,
      process.platform === 'win32' ? 'redis-server.exe' : 'redis-server'
    );

    // Check if Redis binary exists
    if (!await fs.pathExists(redisServerPath)) {
      console.log('Redis binary not found. Please download Redis from the Binary Manager.');
      const status = this.serviceStatus.get('redis');
      status.status = 'not_installed';
      status.error = 'Redis binary not found. Please download from Binary Manager.';
      return;
    }

    const dataPath = this.configStore.get('dataPath');
    const port = this.serviceConfigs.redis.defaultPort;

    const configPath = path.join(dataPath, 'redis', 'redis.conf');
    await this.createRedisConfig(configPath, dataPath, port);

    const proc = spawn(redisServerPath, [configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('redis', data.toString());
    });

    proc.stderr.on('data', (data) => {
      this.managers.log?.service('redis', data.toString(), 'error');
    });

    this.processes.set('redis', proc);
    const status = this.serviceStatus.get('redis');
    status.pid = proc.pid;
    status.port = port;

    await this.waitForService('redis', 10000);
  }

  async createRedisConfig(configPath, dataPath, port) {
    const config = `
port ${port}
bind 127.0.0.1
daemonize no
dir ${path.join(dataPath, 'redis').replace(/\\/g, '/')}
appendonly yes
appendfilename "appendonly.aof"
`;
    await fs.writeFile(configPath, config);
  }

  // Mailpit
  async startMailpit() {
    const mailpitPath = this.getMailpitPath();
    const mailpitBin = path.join(mailpitPath, process.platform === 'win32' ? 'mailpit.exe' : 'mailpit');

    // Check if Mailpit binary exists
    if (!await fs.pathExists(mailpitBin)) {
      console.log('Mailpit binary not found. Please download Mailpit from the Binary Manager.');
      const status = this.serviceStatus.get('mailpit');
      status.status = 'not_installed';
      status.error = 'Mailpit binary not found. Please download from Binary Manager.';
      return;
    }

    const port = this.serviceConfigs.mailpit.defaultPort;
    const smtpPort = this.serviceConfigs.mailpit.smtpPort;

    const proc = spawn(mailpitBin, ['--listen', `127.0.0.1:${port}`, '--smtp', `127.0.0.1:${smtpPort}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('mailpit', data.toString());
    });

    proc.stderr.on('data', (data) => {
      this.managers.log?.service('mailpit', data.toString(), 'error');
    });

    this.processes.set('mailpit', proc);
    const status = this.serviceStatus.get('mailpit');
    status.pid = proc.pid;
    status.port = port;

    await this.waitForService('mailpit', 10000);
  }

  // phpMyAdmin (using built-in PHP server)
  async startPhpMyAdmin() {
    const phpManager = this.managers.php;
    const defaultPhp = phpManager.getDefaultVersion();
    
    // Check if any PHP version is available
    const availableVersions = phpManager.getAvailableVersions().filter(v => v.available);
    if (availableVersions.length === 0) {
      console.log('No PHP version available. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'No PHP version available. Please download from Binary Manager.';
      return;
    }

    let phpPath;
    try {
      phpPath = phpManager.getPhpBinaryPath(defaultPhp);
    } catch (error) {
      console.log('PHP binary not found. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'PHP binary not found. Please download from Binary Manager.';
      return;
    }
    
    // Check if PHP binary exists
    if (!await fs.pathExists(phpPath)) {
      console.log('PHP binary not found. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'PHP binary not found. Please download from Binary Manager.';
      return;
    }

    const phpmyadminPath = path.join(this.resourcePath, 'phpmyadmin');
    
    // Check if phpMyAdmin is installed
    if (!await fs.pathExists(phpmyadminPath)) {
      console.log('phpMyAdmin not found. Please download phpMyAdmin from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'phpMyAdmin not found. Please download from Binary Manager.';
      return;
    }

    const port = this.serviceConfigs.phpmyadmin.defaultPort;

    const proc = spawn(phpPath, ['-S', `127.0.0.1:${port}`, '-t', phpmyadminPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('phpmyadmin', data.toString());
    });

    proc.stderr.on('data', (data) => {
      this.managers.log?.service('phpmyadmin', data.toString(), 'error');
    });

    this.processes.set('phpmyadmin', proc);
    const status = this.serviceStatus.get('phpmyadmin');
    status.pid = proc.pid;
    status.port = port;

    await this.waitForService('phpmyadmin', 10000);
  }

  // Utility methods
  getMySQLPath() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'mysql', platform);
  }

  getRedisPath() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'redis', platform);
  }

  getMailpitPath() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    return path.join(this.resourcePath, 'mailpit', platform);
  }

  async waitForService(serviceName, timeout) {
    const config = this.serviceConfigs[serviceName];
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      try {
        const healthy = await config.healthCheck();
        if (healthy) {
          console.log(`${config.name} is ready`);
          return true;
        }
      } catch (error) {
        // Service not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error(`${config.name} failed to start within ${timeout}ms`);
  }

  async checkMySqlHealth() {
    const port = this.serviceConfigs.mysql.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkRedisHealth() {
    const port = this.serviceConfigs.redis.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkMailpitHealth() {
    const port = this.serviceConfigs.mailpit.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkPhpMyAdminHealth() {
    const port = this.serviceConfigs.phpmyadmin.defaultPort;
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
        if (err) {
          console.error('Error killing process:', err);
        }
        resolve();
      });
    });
  }

  getAllServicesStatus() {
    const result = {};
    for (const [key, status] of this.serviceStatus) {
      result[key] = {
        ...status,
        uptime: status.startedAt ? Date.now() - status.startedAt.getTime() : null,
      };
    }
    return result;
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
