const path = require('path');
const fs = require('fs-extra');
const { spawn, exec, execFile } = require('child_process');
const { EventEmitter } = require('events');
const { app } = require('electron');
const { isPortAvailable, findAvailablePort } = require('../utils/PortUtils');

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
    this.processes = new Map();
    this.serviceStatus = new Map();

    // Track which web server owns the standard ports (80/443)
    // First web server to start gets these ports
    this.standardPortOwner = null;
    
    // Standard and alternate ports for web servers
    this.webServerPorts = {
      standard: { http: 80, https: 443 },
      alternate: { http: 8081, https: 8444 },
    };

    // Service definitions
    this.serviceConfigs = {
      nginx: {
        name: 'Nginx',
        defaultPort: 80,
        sslPort: 443,
        alternatePort: 8081,
        alternateSslPort: 8444,
        healthCheck: this.checkNginxHealth.bind(this),
      },
      apache: {
        name: 'Apache',
        defaultPort: 80,
        sslPort: 443,
        alternatePort: 8081,
        alternateSslPort: 8444,
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
    const dataPath = path.join(app.getPath('userData'), 'data');
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
    
    // For Nginx on Windows, also try to stop gracefully and kill any remaining workers
    if (serviceName === 'nginx' && require('os').platform() === 'win32') {
      try {
        const platform = 'win';
        const nginxPath = path.join(this.resourcePath, 'nginx', platform);
        const nginxExe = path.join(nginxPath, 'nginx.exe');
        const dataPath = path.join(app.getPath('userData'), 'data');
        const confPath = path.join(dataPath, 'nginx', 'nginx.conf');
        
        if (await fs.pathExists(nginxExe)) {
          // Send stop signal to Nginx
          const { execSync } = require('child_process');
          try {
            execSync(`"${nginxExe}" -s stop -c "${confPath}"`, { 
              cwd: nginxPath,
              windowsHide: true,
              timeout: 5000
            });
          } catch (e) {
            // Ignore errors - process may already be dead
          }
          
          // Kill any remaining nginx processes
          try {
            execSync('taskkill /F /IM nginx.exe 2>nul', { windowsHide: true, timeout: 5000 });
          } catch (e) {
            // Ignore - no processes to kill
          }
        }
      } catch (error) {
        console.warn('Error during Nginx cleanup:', error.message);
      }
    }
    
    // For Apache on Windows, kill any remaining httpd processes
    if (serviceName === 'apache' && require('os').platform() === 'win32') {
      try {
        const { execSync } = require('child_process');
        try {
          execSync('taskkill /F /IM httpd.exe 2>nul', { windowsHide: true, timeout: 5000 });
        } catch (e) {
          // Ignore - no processes to kill
        }
      } catch (error) {
        console.warn('Error during Apache cleanup:', error.message);
      }
    }
    
    // Wait a moment for ports to be released
    await new Promise(resolve => setTimeout(resolve, 500));

    // Release standard ports if this web server owned them
    if ((serviceName === 'nginx' || serviceName === 'apache') && this.standardPortOwner === serviceName) {
      console.log(`${config.name} releasing standard ports (80/443)`);
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
    
    // First, stop all running projects
    if (this.managers.project) {
      try {
        console.log('Stopping all running projects before stopping services...');
        await this.managers.project.stopAllProjects();
        console.log('All projects stopped');
      } catch (error) {
        console.error('Error stopping projects:', error);
      }
    }
    
    // Then stop all services
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

    const dataPath = path.join(app.getPath('userData'), 'data');
    const confPath = path.join(dataPath, 'nginx', 'nginx.conf');
    const logsPath = path.join(dataPath, 'nginx', 'logs');
    
    // Determine which ports to use based on first-come-first-served
    let httpPort, sslPort;
    
    if (this.standardPortOwner === null) {
      // No web server owns standard ports yet - try to claim them
      const standardHttp = this.webServerPorts.standard.http;
      const standardHttps = this.webServerPorts.standard.https;
      
      if (await isPortAvailable(standardHttp) && await isPortAvailable(standardHttps)) {
        // Claim standard ports
        httpPort = standardHttp;
        sslPort = standardHttps;
        this.standardPortOwner = 'nginx';
        console.log(`Nginx claiming standard ports (${httpPort}/${sslPort})`);
      } else {
        // Standard ports not available, use alternate
        httpPort = this.webServerPorts.alternate.http;
        sslPort = this.webServerPorts.alternate.https;
        console.log(`Standard ports not available, Nginx using alternate ports (${httpPort}/${sslPort})`);
      }
    } else if (this.standardPortOwner === 'nginx') {
      // Nginx already owns standard ports (shouldn't happen, but handle it)
      httpPort = this.webServerPorts.standard.http;
      sslPort = this.webServerPorts.standard.https;
    } else {
      // Another web server owns standard ports, use alternate
      httpPort = this.webServerPorts.alternate.http;
      sslPort = this.webServerPorts.alternate.https;
      console.log(`Apache owns standard ports, Nginx using alternate ports (${httpPort}/${sslPort})`);
    }
    
    // Verify chosen ports are available, find alternatives if not
    if (!await isPortAvailable(httpPort)) {
      httpPort = await findAvailablePort(httpPort, 100);
      if (!httpPort) {
        throw new Error(`Could not find available HTTP port for Nginx`);
      }
      console.log(`Nginx HTTP port in use, using ${httpPort} instead`);
    }
    
    if (!await isPortAvailable(sslPort)) {
      sslPort = await findAvailablePort(sslPort, 100);
      if (!sslPort) {
        throw new Error(`Could not find available HTTPS port for Nginx`);
      }
      console.log(`Nginx HTTPS port in use, using ${sslPort} instead`);
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
    await this.createNginxConfig(confPath, logsPath, httpPort, sslPort);

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
        console.log('Nginx config test error output:', errorMsg);
        
        // Check for port binding errors (Windows error 10013 = permission denied, 10048 = already in use)
        const portBindError = errorMsg.includes('10013') || errorMsg.includes('10048') || 
                              errorMsg.includes('bind()') || errorMsg.includes('Address already in use');
        console.log('Is port bind error:', portBindError);
        return { success: false, error: errorMsg, isPortError: portBindError };
      }
    };

    let testResult = await testConfig();
    
    // If we got a port binding error, try alternate ports
    if (!testResult.success && testResult.isPortError) {
      console.log(`Port binding error detected: ${testResult.error}`);
      console.log(`Current ports: HTTP=${httpPort}, SSL=${sslPort}, trying alternate ports...`);
      
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
              console.log(`Removed old vhost: ${file}`);
            }
          }
        } catch (e) {
          // Sites dir may not exist yet
        }
        
        // Update the config with new ports
        await this.createNginxConfig(confPath, logsPath, httpPort, sslPort);
        
        // Update port ownership - we couldn't get standard ports
        if (this.standardPortOwner === 'nginx') {
          this.standardPortOwner = null;
        }
        
        // Update actual ports
        this.serviceConfigs.nginx.actualHttpPort = httpPort;
        this.serviceConfigs.nginx.actualSslPort = sslPort;
        
        console.log(`Nginx now using alternate ports ${httpPort}/${sslPort}`);
        testResult = await testConfig();
      }
    }
    
    if (!testResult.success) {
      console.error('Nginx configuration test failed:', testResult.error);
      throw new Error(`Nginx configuration error: ${testResult.error}`);
    }
    
    console.log('Nginx configuration test passed');

    console.log(`Starting Nginx on ports ${httpPort} (HTTP) and ${sslPort} (HTTPS)...`);

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
    }

    this.processes.set('nginx', proc);
    const status = this.serviceStatus.get('nginx');
    status.port = httpPort;
    status.sslPort = sslPort;

    // Wait for Nginx to be ready
    await this.waitForService('nginx', 10000);
  }

  // Reload Nginx configuration without stopping
  async reloadNginx() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const nginxPath = path.join(this.resourcePath, 'nginx', platform);
    const nginxExe = path.join(nginxPath, process.platform === 'win32' ? 'nginx.exe' : 'sbin/nginx');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const confPath = path.join(dataPath, 'nginx', 'nginx.conf');

    if (!await fs.pathExists(nginxExe)) {
      console.log('Nginx binary not found, cannot reload');
      return;
    }

    const status = this.serviceStatus.get('nginx');
    if (status?.status !== 'running') {
      console.log('Nginx is not running, skipping reload');
      return;
    }

    console.log('Reloading Nginx configuration...');

    return new Promise((resolve, reject) => {
      const proc = spawn(nginxExe, ['-s', 'reload', '-c', confPath, '-p', nginxPath], {
        windowsHide: true,
        cwd: nginxPath,
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log('Nginx configuration reloaded successfully');
          resolve();
        } else {
          console.error(`Nginx reload failed with code ${code}`);
          reject(new Error(`Nginx reload failed with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        console.error('Nginx reload error:', error);
        reject(error);
      });
    });
  }

  // Reload Apache configuration without stopping
  async reloadApache() {
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const apachePath = path.join(this.resourcePath, 'apache', platform);
    const httpdExe = path.join(apachePath, 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const confPath = path.join(dataPath, 'apache', 'httpd.conf');

    if (!await fs.pathExists(httpdExe)) {
      console.log('Apache binary not found, cannot reload');
      return;
    }

    const status = this.serviceStatus.get('apache');
    if (status?.status !== 'running') {
      console.log('Apache is not running, skipping reload');
      return;
    }

    console.log('Reloading Apache configuration...');

    // On Windows, Apache running as a process (not service) cannot use -k graceful
    // We need to restart it to pick up config changes
    if (process.platform === 'win32') {
      try {
        console.log('Restarting Apache on Windows to apply config changes...');
        await this.restartService('apache');
        console.log('Apache restarted successfully');
      } catch (error) {
        console.error('Apache restart failed:', error);
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
            console.log('Apache configuration reloaded successfully');
            resolve();
          } else {
            console.error(`Apache reload failed with code ${code}`);
            reject(new Error(`Apache reload failed with code ${code}`));
          }
        });

        proc.on('error', (error) => {
          console.error('Apache reload error:', error);
          reject(error);
        });
      });
    }
  }

  async createNginxConfig(confPath, logsPath, httpPort = 80, sslPort = 443) {
    const dataPath = path.join(app.getPath('userData'), 'data');
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const nginxPath = path.join(this.resourcePath, 'nginx', platform);
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

    # Default server for unmatched requests
    server {
        listen ${httpPort} default_server;
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
    
    if (this.standardPortOwner === null) {
      // No web server owns standard ports yet - try to claim them
      const standardHttp = this.webServerPorts.standard.http;
      const standardHttps = this.webServerPorts.standard.https;
      
      if (await isPortAvailable(standardHttp) && await isPortAvailable(standardHttps)) {
        // Claim standard ports
        httpPort = standardHttp;
        httpsPort = standardHttps;
        this.standardPortOwner = 'apache';
        console.log(`Apache claiming standard ports (${httpPort}/${httpsPort})`);
      } else {
        // Standard ports not available, use alternate
        httpPort = this.webServerPorts.alternate.http;
        httpsPort = this.webServerPorts.alternate.https;
        console.log(`Standard ports not available, Apache using alternate ports (${httpPort}/${httpsPort})`);
      }
    } else if (this.standardPortOwner === 'apache') {
      // Apache already owns standard ports (shouldn't happen, but handle it)
      httpPort = this.webServerPorts.standard.http;
      httpsPort = this.webServerPorts.standard.https;
    } else {
      // Another web server owns standard ports, use alternate
      httpPort = this.webServerPorts.alternate.http;
      httpsPort = this.webServerPorts.alternate.https;
      console.log(`Nginx owns standard ports, Apache using alternate ports (${httpPort}/${httpsPort})`);
    }
    
    // Verify chosen ports are available, find alternatives if not
    if (!await isPortAvailable(httpPort)) {
      httpPort = await findAvailablePort(httpPort, 100);
      if (!httpPort) {
        throw new Error(`Could not find available HTTP port for Apache`);
      }
      console.log(`Apache HTTP port in use, using ${httpPort} instead`);
    }
    
    if (!await isPortAvailable(httpsPort)) {
      httpsPort = await findAvailablePort(httpsPort, 100);
      if (!httpsPort) {
        throw new Error(`Could not find available HTTPS port for Apache`);
      }
      console.log(`Apache HTTPS port in use, using ${httpsPort} instead`);
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

    console.log(`Testing Apache configuration...`);
    let testResult = await testConfig();
    
    // If we got a port binding error, try alternate ports
    if (!testResult.success && testResult.isPortError) {
      console.log(`Port binding error detected: ${testResult.error}`);
      console.log(`Current ports: HTTP=${httpPort}, HTTPS=${httpsPort}, trying alternate ports...`);
      
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
              console.log(`Removed old vhost: ${file}`);
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
        
        console.log(`Apache now using alternate ports ${httpPort}/${httpsPort}`);
        testResult = await testConfig();
      }
    }
    
    if (!testResult.success) {
      console.error('Apache configuration test failed:', testResult.error);
      throw new Error(`Apache configuration error: ${testResult.error}`);
    }
    
    console.log('Apache configuration test passed');

    console.log(`Starting Apache on ports ${httpPort} (HTTP) and ${httpsPort} (HTTPS)...`);
    
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
    status.port = httpPort;
    status.sslPort = httpsPort;

    // Wait for Apache to be ready
    await this.waitForService('apache', 10000);
    
    console.log(`Apache started on ports ${httpPort} (HTTP) and ${httpsPort} (HTTPS)`);
  }

  async createApacheConfig(apachePath, confPath, logsPath, httpPort = 8081, httpsPort = 8444) {
    const dataPath = path.join(app.getPath('userData'), 'data');
    const mimeTypesPath = path.join(apachePath, 'conf', 'mime.types').replace(/\\/g, '/');
    
    const config = `ServerRoot "${apachePath.replace(/\\/g, '/')}"
Listen ${httpPort}
Listen ${httpsPort}

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

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mysql', 'data');
    
    // Find available port dynamically
    const defaultPort = this.serviceConfigs.mysql.defaultPort;
    let port = defaultPort;
    
    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MySQL starting from ${defaultPort}`);
      }
      console.log(`MySQL port ${defaultPort} in use, using ${port} instead`);
    }
    
    // Store the actual port being used
    this.serviceConfigs.mysql.actualPort = port;

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

    console.log(`Starting MySQL server on port ${port}...`);
    
    let proc;
    if (process.platform === 'win32') {
      // On Windows, use spawnHidden to run without console window
      proc = spawnHidden(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      
      proc.stdout?.on('data', (data) => {
        console.log('[MySQL]', data.toString().trim());
        this.managers.log?.service('mysql', data.toString());
      });

      proc.stderr?.on('data', (data) => {
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
    } else {
      proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
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
    }
    
    this.processes.set('mysql', proc);
    const status = this.serviceStatus.get('mysql');
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
      // Windows-specific config for MySQL 8.4
      // Note: skip-grant-tables causes skip_networking=ON in MySQL 8.4, so we don't use it
      // Instead, MySQL is initialized with --initialize-insecure which creates root without password
      config = `[mysqld]
basedir=${this.getMySQLPath().replace(/\\/g, '/')}
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
bind-address=0.0.0.0
enable-named-pipe=ON
socket=MYSQL
pid-file=${path.join(dataDir, 'mysql.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}
innodb_buffer_pool_size=128M
innodb_redo_log_capacity=100M
max_connections=100

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

    // Kill any orphan MariaDB processes before starting
    await this.killOrphanMariaDBProcesses();

    const dataPath = path.join(app.getPath('userData'), 'data');
    const dataDir = path.join(dataPath, 'mariadb', 'data');
    
    // Find available port dynamically
    const defaultPort = this.serviceConfigs.mariadb.defaultPort;
    let port = defaultPort;
    
    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MariaDB starting from ${defaultPort}`);
      }
      console.log(`MariaDB port ${defaultPort} in use, using ${port} instead`);
    }
    
    // Store the actual port being used
    this.serviceConfigs.mariadb.actualPort = port;

    // Check if MariaDB data directory needs initialization
    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    if (!isInitialized) {
      console.log('Initializing MariaDB data directory...');
      await this.initializeMariaDBData(mariadbPath, dataDir);
    }

    const configPath = path.join(dataPath, 'mariadb', 'my.cnf');

    // Create MariaDB config
    await this.createMariaDBConfig(configPath, dataDir, port);

    console.log(`Starting MariaDB server on port ${port}...`);

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

  async createMariaDBConfig(configPath, dataDir, port) {
    await fs.ensureDir(path.dirname(configPath));
    const isWindows = process.platform === 'win32';
    
    let config;
    if (isWindows) {
      // Windows-specific config - no socket, use TCP/IP and named pipe
      // Use unique named pipe name to avoid conflict with MySQL
      config = `[mysqld]
datadir=${dataDir.replace(/\\/g, '/')}
port=${port}
skip-grant-tables
bind-address=127.0.0.1
enable_named_pipe=ON
socket=MARIADB
pid-file=${path.join(dataDir, 'mariadb.pid').replace(/\\/g, '/')}
log-error=${path.join(dataDir, 'error.log').replace(/\\/g, '/')}

[client]
port=${port}
socket=MARIADB
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

    const dataPath = path.join(app.getPath('userData'), 'data');
    
    // Find available port dynamically
    const defaultPort = this.serviceConfigs.redis.defaultPort;
    let port = defaultPort;
    
    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for Redis starting from ${defaultPort}`);
      }
      console.log(`Redis port ${defaultPort} in use, using ${port} instead`);
    }
    
    // Store the actual port being used
    this.serviceConfigs.redis.actualPort = port;

    const configPath = path.join(dataPath, 'redis', 'redis.conf');
    await this.createRedisConfig(configPath, dataPath, port);

    console.log(`Starting Redis server on port ${port}...`);
    
    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(redisServerPath, [configPath], {
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

    this.processes.set('redis', proc);
    const status = this.serviceStatus.get('redis');
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
      console.log(`Mailpit web port ${defaultPort} in use, using ${port} instead`);
    }
    
    if (!await isPortAvailable(smtpPort)) {
      smtpPort = await findAvailablePort(defaultSmtpPort, 100);
      if (!smtpPort) {
        throw new Error(`Could not find available SMTP port for Mailpit starting from ${defaultSmtpPort}`);
      }
      console.log(`Mailpit SMTP port ${defaultSmtpPort} in use, using ${smtpPort} instead`);
    }
    
    // Store the actual ports being used
    this.serviceConfigs.mailpit.actualPort = port;
    this.serviceConfigs.mailpit.actualSmtpPort = smtpPort;

    console.log(`Starting Mailpit on port ${port} (web) and ${smtpPort} (SMTP)...`);

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

    // Find available port dynamically
    const defaultPort = this.serviceConfigs.phpmyadmin.defaultPort;
    let port = defaultPort;
    
    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for phpMyAdmin starting from ${defaultPort}`);
      }
      console.log(`phpMyAdmin port ${defaultPort} in use, using ${port} instead`);
    }
    
    // Store the actual port being used
    this.serviceConfigs.phpmyadmin.actualPort = port;

    // Get PHP directory for php.ini location
    const phpDir = path.dirname(phpPath);

    console.log(`Starting phpMyAdmin on port ${port}...`);

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
      return {
        httpPort: config.actualHttpPort,
        sslPort: config.actualSslPort || config.sslPort,
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
            httpPort: this.webServerPorts.alternate.http,
            sslPort: this.webServerPorts.alternate.https,
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
          httpPort: this.webServerPorts.alternate.http,
          sslPort: this.webServerPorts.alternate.https,
        };
      }
    }
    
    // For non-web servers, use default ports
    return {
      httpPort: config.actualHttpPort || config.defaultPort,
      sslPort: config.actualSslPort || config.sslPort,
    };
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
