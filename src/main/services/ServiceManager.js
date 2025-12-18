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
      nginx: {
        name: 'Nginx',
        defaultPort: 80,
        healthCheck: this.checkNginxHealth.bind(this),
      },
      apache: {
        name: 'Apache',
        defaultPort: 80,
        healthCheck: this.checkApacheHealth.bind(this),
      },
      mysql: {
        name: 'MySQL',
        defaultPort: 3306,
        healthCheck: this.checkMySqlHealth.bind(this),
      },
      mariadb: {
        name: 'MariaDB',
        defaultPort: 3306,
        healthCheck: this.checkMariaDbHealth.bind(this),
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
    await fs.ensureDir(path.join(dataPath, 'mariadb', 'data'));
    await fs.ensureDir(path.join(dataPath, 'redis'));
    await fs.ensureDir(path.join(dataPath, 'nginx'));
    await fs.ensureDir(path.join(dataPath, 'apache'));
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
        case 'nginx':
          await this.startNginx();
          break;
        case 'apache':
          await this.startApache();
          break;
        case 'mysql':
          await this.startMySQL();
          break;
        case 'mariadb':
          await this.startMariaDB();
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

  // Nginx
  async startNginx() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const nginxPath = path.join(this.resourcePath, 'nginx', platform);
    const nginxExe = path.join(nginxPath, process.platform === 'win32' ? 'nginx.exe' : 'nginx');
    
    // Check if Nginx binary exists
    if (!await fs.pathExists(nginxExe)) {
      console.log('Nginx binary not found. Please download Nginx from the Binary Manager.');
      const status = this.serviceStatus.get('nginx');
      status.status = 'not_installed';
      status.error = 'Nginx binary not found. Please download from Binary Manager.';
      return;
    }

    const dataPath = this.configStore.get('dataPath');
    const confPath = path.join(dataPath, 'nginx', 'nginx.conf');
    const logsPath = path.join(dataPath, 'nginx', 'logs');
    
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

    // Create default config if not exists
    if (!await fs.pathExists(confPath)) {
      await this.createNginxConfig(confPath, logsPath);
    }

    const proc = spawn(nginxExe, ['-c', confPath, '-p', nginxPath], {
      cwd: nginxPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('nginx', data.toString());
    });

    proc.stderr.on('data', (data) => {
      this.managers.log?.service('nginx', data.toString(), 'error');
    });

    proc.on('error', (error) => {
      console.error('Nginx process error:', error);
      const status = this.serviceStatus.get('nginx');
      status.status = 'error';
      status.error = error.message;
    });

    proc.on('exit', (code) => {
      console.log(`Nginx exited with code ${code}`);
      const status = this.serviceStatus.get('nginx');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set('nginx', proc);
    const status = this.serviceStatus.get('nginx');
    status.pid = proc.pid;
    status.port = 80;

    // Wait for Nginx to be ready
    await this.waitForService('nginx', 10000);
  }

  async createNginxConfig(confPath, logsPath) {
    const dataPath = this.configStore.get('dataPath');
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const nginxPath = path.join(this.resourcePath, 'nginx', platform);
    const mimeTypesPath = path.join(nginxPath, 'conf', 'mime.types').replace(/\\/g, '/');
    const sitesPath = path.join(dataPath, 'nginx', 'sites').replace(/\\/g, '/');
    
    // Ensure sites directory exists
    await fs.ensureDir(path.join(dataPath, 'nginx', 'sites'));
    
    const config = `worker_processes 1;

events {
    worker_connections 1024;
}

http {
    include       ${mimeTypesPath};
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    client_max_body_size 128M;
    
    access_log ${logsPath.replace(/\\/g, '/')}/access.log;
    error_log ${logsPath.replace(/\\/g, '/')}/error.log;

    # Include virtual host configs from sites directory
    include ${sitesPath}/*.conf;

    # Default server for unmatched requests
    server {
        listen 80 default_server;
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
  async startApache() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const apachePath = path.join(this.resourcePath, 'apache', platform);
    const httpdExe = path.join(apachePath, 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd');
    
    // Check if Apache binary exists
    if (!await fs.pathExists(httpdExe)) {
      console.log('Apache binary not found. Please download Apache from the Binary Manager.');
      const status = this.serviceStatus.get('apache');
      status.status = 'not_installed';
      status.error = 'Apache binary not found. Please download from Binary Manager.';
      return;
    }

    const dataPath = this.configStore.get('dataPath');
    const confPath = path.join(dataPath, 'apache', 'httpd.conf');
    const logsPath = path.join(dataPath, 'apache', 'logs');
    
    // Ensure directories exist
    await fs.ensureDir(path.join(dataPath, 'apache'));
    await fs.ensureDir(logsPath);
    await fs.ensureDir(path.join(dataPath, 'apache', 'vhosts'));

    // Create default config if not exists
    if (!await fs.pathExists(confPath)) {
      await this.createApacheConfig(apachePath, confPath, logsPath);
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
      console.error('Apache process error:', error);
      const status = this.serviceStatus.get('apache');
      status.status = 'error';
      status.error = error.message;
    });

    proc.on('exit', (code) => {
      console.log(`Apache exited with code ${code}`);
      const status = this.serviceStatus.get('apache');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set('apache', proc);
    const status = this.serviceStatus.get('apache');
    status.pid = proc.pid;
    status.port = 80;

    // Wait for Apache to be ready
    await this.waitForService('apache', 10000);
  }

  async createApacheConfig(apachePath, confPath, logsPath) {
    const dataPath = this.configStore.get('dataPath');
    const mimeTypesPath = path.join(apachePath, 'conf', 'mime.types').replace(/\\/g, '/');
    
    const config = `ServerRoot "${apachePath.replace(/\\/g, '/')}"
Listen 80

LoadModule authz_core_module modules/mod_authz_core.so
LoadModule dir_module modules/mod_dir.so
LoadModule mime_module modules/mod_mime.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule rewrite_module modules/mod_rewrite.so

TypesConfig "${mimeTypesPath}"

ServerName localhost:80
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

    // Kill any orphan MySQL processes before starting
    await this.killOrphanMySQLProcesses();

    const dataPath = this.configStore.get('dataPath');
    const dataDir = path.join(dataPath, 'mysql', 'data');
    const port = this.serviceConfigs.mysql.defaultPort;

    // Ensure data directory exists
    await fs.ensureDir(dataDir);

    // Check if MySQL data directory needs initialization
    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    if (!isInitialized) {
      console.log('Initializing MySQL data directory...');
      try {
        await this.initializeMySQLData(mysqlPath, dataDir);
      } catch (error) {
        console.error('MySQL initialization failed:', error.message);
        const status = this.serviceStatus.get('mysql');
        status.status = 'error';
        status.error = `Initialization failed: ${error.message}`;
        return;
      }
    }

    const configPath = path.join(dataPath, 'mysql', 'my.cnf');

    // Create MySQL config
    await fs.ensureDir(path.dirname(configPath));
    await this.createMySQLConfig(configPath, dataDir, port);

    console.log('Starting MySQL server...');
    const proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
      cwd: mysqlPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      console.log('[MySQL]', data.toString().trim());
      this.managers.log?.service('mysql', data.toString());
    });

    proc.stderr.on('data', (data) => {
      console.log('[MySQL stderr]', data.toString().trim());
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
    try {
      await this.waitForService('mysql', 30000);
    } catch (error) {
      console.error('MySQL failed to start:', error.message);
      status.status = 'error';
      status.error = 'Failed to start within timeout. Check logs for details.';
    }
  }

  async initializeMySQLData(mysqlPath, dataDir) {
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    // Ensure data directory is empty before initialization
    await fs.emptyDir(dataDir);

    return new Promise((resolve, reject) => {
      console.log('Running MySQL initialization...');
      const proc = spawn(mysqldPath, ['--initialize-insecure', `--datadir=${dataDir}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log('[MySQL init]', data.toString().trim());
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

  async createMySQLConfig(configPath, dataDir, port) {
    const isWindows = process.platform === 'win32';
    
    let config;
    if (isWindows) {
      // Windows-specific config
      // MySQL 8.4 on Windows requires at least one of: TCP/IP, shared-memory, or named-pipe
      // We enable named-pipe to satisfy this requirement, TCP/IP is enabled by default
      config = `[mysqld]
basedir=${this.getMySQLPath().replace(/\\/g, '/')}
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=0.0.0.0
skip-grant-tables
enable-named-pipe=1
pid-file=${path.join(dataDir, 'mysql.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}

[client]
port=${port}
host=127.0.0.1
`;
    } else {
      // Unix/macOS config with socket
      config = `[mysqld]
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
    }

    await fs.writeFile(configPath, config);
  }

  // MariaDB
  async startMariaDB() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const mariadbPath = path.join(this.resourcePath, 'mariadb', platform);
    const mariadbd = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');
    
    // Check if MariaDB binary exists
    if (!await fs.pathExists(mariadbd)) {
      console.log('MariaDB binary not found. Please download MariaDB from the Binary Manager.');
      const status = this.serviceStatus.get('mariadb');
      status.status = 'not_installed';
      status.error = 'MariaDB binary not found. Please download from Binary Manager.';
      return;
    }

    const dataPath = this.configStore.get('dataPath');
    const dataDir = path.join(dataPath, 'mariadb', 'data');
    const port = this.serviceConfigs.mariadb.defaultPort;

    // Check if MariaDB data directory needs initialization
    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    if (!isInitialized) {
      console.log('Initializing MariaDB data directory...');
      await this.initializeMariaDBData(mariadbPath, dataDir);
    }

    const configPath = path.join(dataPath, 'mariadb', 'my.cnf');

    // Create MariaDB config
    await this.createMariaDBConfig(configPath, dataDir, port);

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
      console.error('MariaDB process error:', error);
      const status = this.serviceStatus.get('mariadb');
      status.status = 'error';
      status.error = error.message;
    });

    proc.on('exit', (code) => {
      console.log(`MariaDB exited with code ${code}`);
      const status = this.serviceStatus.get('mariadb');
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set('mariadb', proc);
    const status = this.serviceStatus.get('mariadb');
    status.pid = proc.pid;
    status.port = port;

    // Wait for MariaDB to be ready
    await this.waitForService('mariadb', 30000);
  }

  async initializeMariaDBData(mariadbPath, dataDir) {
    // MariaDB uses mysql_install_db or mariadb-install-db
    const installDb = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadb-install-db.exe' : 'mariadb-install-db');
    
    await fs.ensureDir(dataDir);

    return new Promise((resolve, reject) => {
      const proc = spawn(installDb, [`--datadir=${dataDir}`, '--auth-root-authentication-method=normal'], {
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

  async createMariaDBConfig(configPath, dataDir, port) {
    await fs.ensureDir(path.dirname(configPath));
    const isWindows = process.platform === 'win32';
    
    let config;
    if (isWindows) {
      // Windows-specific config - no socket, use TCP/IP and named pipe
      config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
skip-grant-tables
bind-address=127.0.0.1
enable_named_pipe=ON
pid-file=${path.join(dataDir, 'mariadb.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}

[client]
port=${port}
`;
    } else {
      // Unix/macOS config with socket
      config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
skip-grant-tables
skip-networking=0
bind-address=127.0.0.1
socket=${path.join(dataDir, 'mariadb.sock').replace(/\\/g, '/')}
pid-file=${path.join(dataDir, 'mariadb.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}

[client]
port=${port}
socket=${path.join(dataDir, 'mariadb.sock').replace(/\\/g, '/')}
`;
    }

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
      windowsHide: true,
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
      windowsHide: true,
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

    // Ensure mysqli extension is enabled for phpMyAdmin
    try {
      const extensions = phpManager.getExtensions(defaultPhp);
      const mysqliExt = extensions.find(ext => ext.name === 'mysqli');
      if (mysqliExt && !mysqliExt.enabled) {
        console.log('Enabling mysqli extension for phpMyAdmin...');
        await phpManager.toggleExtension(defaultPhp, 'mysqli', true);
      }
    } catch (error) {
      console.warn('Could not check/enable mysqli extension:', error.message);
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

    // Check if MySQL is running - phpMyAdmin needs MySQL to work
    const mysqlStatus = this.serviceStatus.get('mysql');
    if (mysqlStatus.status !== 'running') {
      console.log('MySQL is not running. Starting MySQL first...');
      try {
        await this.startMySQL();
        // Wait a bit for MySQL to fully initialize
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch (error) {
        console.warn('Could not start MySQL automatically:', error.message);
      }
    }

    const port = this.serviceConfigs.phpmyadmin.defaultPort;

    // Get PHP directory for php.ini location
    const phpDir = path.dirname(phpPath);

    const proc = spawn(phpPath, ['-S', `127.0.0.1:${port}`, '-t', phpmyadminPath, '-c', phpDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
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

  async checkNginxHealth() {
    const port = this.serviceConfigs.nginx.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkApacheHealth() {
    const port = this.serviceConfigs.apache.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkMySqlHealth() {
    const port = this.serviceConfigs.mysql.defaultPort;
    return this.checkPortOpen(port);
  }

  async checkMariaDbHealth() {
    const port = this.serviceConfigs.mariadb.defaultPort;
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
