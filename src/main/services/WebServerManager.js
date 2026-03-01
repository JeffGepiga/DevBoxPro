const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');
const os = require('os');

class WebServerManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.resourcesPath = path.join(app.getPath('userData'), 'resources');
    this.dataPath = path.join(app.getPath('userData'), 'data');
    this.processes = new Map(); // projectId -> { server, phpFpm, phpFpmPort }
    this.serverType = 'nginx'; // 'nginx' or 'apache'
  }

  async initialize() {
    await fs.ensureDir(path.join(this.dataPath, 'nginx'));
    await fs.ensureDir(path.join(this.dataPath, 'apache'));
    await fs.ensureDir(path.join(this.dataPath, 'php-fpm'));

    // Load preferred server type from config
    this.serverType = this.configStore.get('settings.webServer', 'nginx');

    // Remove stale vhost/site configs from previous sessions or deleted projects
    await this.cleanupOrphanedConfigs();
  }

  // Remove vhost/site .conf files that don't correspond to any known project
  async cleanupOrphanedConfigs() {
    const projects = this.configStore.get('projects', []);
    const validIds = new Set(projects.map(p => p.id));

    const dirs = [
      path.join(this.dataPath, 'apache', 'vhosts'),
      path.join(this.dataPath, 'nginx', 'sites'),
    ];

    for (const dir of dirs) {
      if (!await fs.pathExists(dir)) continue;
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (!file.endsWith('.conf')) continue;
        const projectId = file.replace('.conf', '');
        if (!validIds.has(projectId)) {
          await fs.remove(path.join(dir, file));
        }
      }
    }
  }


  getPlatform() {
    return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  }

  setServerType(type) {
    if (type !== 'nginx' && type !== 'apache') {
      throw new Error('Invalid server type. Use "nginx" or "apache"');
    }
    this.serverType = type;
    this.configStore.set('settings.webServer', type);
  }

  getServerType() {
    return this.serverType;
  }

  // Get local network IP addresses for network access feature
  getLocalIpAddresses() {
    const interfaces = os.networkInterfaces();
    const addresses = [];

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // Skip internal (loopback) and non-IPv4 addresses
        if (iface.family === 'IPv4' && !iface.internal) {
          addresses.push(iface.address);
        }
      }
    }

    return addresses;
  }

  // Get path to nginx executable
  getNginxPath(version) {
    const v = version || '1.28';
    const platform = this.getPlatform();
    const exe = platform === 'win' ? 'nginx.exe' : 'nginx';
    return path.join(this.resourcesPath, 'nginx', v, platform, exe);
  }

  // Get base nginx directory (for config paths)
  getNginxBasePath(version) {
    const v = version || '1.28';
    const platform = this.getPlatform();
    return path.join(this.resourcesPath, 'nginx', v, platform);
  }

  // Get path to Apache executable
  getApachePath(version) {
    const v = version || '2.4';
    const platform = this.getPlatform();
    const exe = platform === 'win' ? 'bin/httpd.exe' : 'bin/httpd';
    return path.join(this.resourcesPath, 'apache', v, platform, exe);
  }

  // Get base apache directory (for config paths)
  getApacheBasePath(version) {
    const v = version || '2.4';
    const platform = this.getPlatform();
    return path.join(this.resourcesPath, 'apache', v, platform);
  }

  // Get path to PHP-CGI/FPM
  getPhpCgiPath(version) {
    const v = version || '8.3';
    const platform = this.getPlatform();
    const exe = platform === 'win' ? 'php-cgi.exe' : 'php-fpm';
    return path.join(this.resourcesPath, 'php', v, platform, exe);
  }

  // Check if web server is installed
  async isServerInstalled(type = null, version = null) {
    const serverType = type || this.serverType;
    const serverVersion = version || (serverType === 'nginx' ? '1.28' : '2.4');
    const serverPath = serverType === 'nginx' ? this.getNginxPath(serverVersion) : this.getApachePath(serverVersion);
    return fs.pathExists(serverPath);
  }

  // Create main Nginx config
  async createMainNginxConfig(version = '1.28') {
    const confDir = path.join(this.dataPath, 'nginx');
    const sitesDir = path.join(confDir, 'sites');
    const logsDir = path.join(confDir, 'logs');

    await fs.ensureDir(sitesDir);
    await fs.ensureDir(logsDir);

    const platform = this.getPlatform();
    const nginxBasePath = this.getNginxBasePath(version);
    const mimeTypes = platform === 'win'
      ? path.join(nginxBasePath, 'conf', 'mime.types')
      : '/etc/nginx/mime.types';

    const mainConfig = `
worker_processes auto;
error_log "${logsDir.replace(/\\/g, '/')}/error.log";
pid "${confDir.replace(/\\/g, '/')}/nginx.pid";

events {
    worker_connections 1024;
}

http {
    include "${mimeTypes.replace(/\\/g, '/')}";
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';

    access_log "${logsDir.replace(/\\/g, '/')}/access.log" main;

    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 128M;

    # FastCGI params
    fastcgi_param QUERY_STRING       $query_string;
    fastcgi_param REQUEST_METHOD     $request_method;
    fastcgi_param CONTENT_TYPE       $content_type;
    fastcgi_param CONTENT_LENGTH     $content_length;
    fastcgi_param SCRIPT_NAME        $fastcgi_script_name;
    fastcgi_param REQUEST_URI        $request_uri;
    fastcgi_param DOCUMENT_URI       $document_uri;
    fastcgi_param DOCUMENT_ROOT      $document_root;
    fastcgi_param SERVER_PROTOCOL    $server_protocol;
    fastcgi_param GATEWAY_INTERFACE  CGI/1.1;
    fastcgi_param SERVER_SOFTWARE    nginx/$nginx_version;
    fastcgi_param REMOTE_ADDR        $remote_addr;
    fastcgi_param REMOTE_PORT        $remote_port;
    fastcgi_param SERVER_ADDR        $server_addr;
    fastcgi_param SERVER_PORT        $server_port;
    fastcgi_param SERVER_NAME        $server_name;
    fastcgi_param REDIRECT_STATUS    200;

    # Include all site configs
    include "${sitesDir.replace(/\\/g, '/')}/*.conf";

    # Default SSL catch-all: reject SSL handshakes for unrecognized hostnames.
    # Without this, nginx falls back to the first loaded SSL server block (alphabetically)
    # and serves a DevBox project certificate for any unmatched domain. This prevents that.
    server {
        listen 443 ssl default_server;
        ssl_reject_handshake on;
    }
}
`;

    await fs.writeFile(path.join(confDir, 'nginx.conf'), mainConfig);
  }

  // Create main Apache config
  async createMainApacheConfig(version = '2.4') {
    const confDir = path.join(this.dataPath, 'apache');
    const vhostsDir = path.join(confDir, 'vhosts');
    const logsDir = path.join(confDir, 'logs');
    const platform = this.getPlatform();
    const apacheRoot = path.join(this.resourcesPath, 'apache', version, platform);

    await fs.ensureDir(vhostsDir);
    await fs.ensureDir(logsDir);

    const mainConfig = `
ServerRoot "${apacheRoot.replace(/\\/g, '/')}"
Listen 80
Listen 443

LoadModule authz_core_module modules/mod_authz_core.so
LoadModule dir_module modules/mod_dir.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule mime_module modules/mod_mime.so
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule ssl_module modules/mod_ssl.so
LoadModule unixd_module modules/mod_unixd.so

ServerName localhost
DocumentRoot "${confDir.replace(/\\/g, '/')}/htdocs"

<Directory />
    AllowOverride none
    Require all denied
</Directory>

ErrorLog "${logsDir.replace(/\\/g, '/')}/error.log"
LogLevel warn

<IfModule log_config_module>
    LogFormat "%h %l %u %t \\"%r\\" %>s %b" common
    CustomLog "${logsDir.replace(/\\/g, '/')}/access.log" common
</IfModule>

<IfModule mime_module>
    TypesConfig conf/mime.types
    AddType application/x-httpd-php .php
</IfModule>

<IfModule dir_module>
    DirectoryIndex index.php index.html
</IfModule>

# Include all vhost configs
IncludeOptional "${vhostsDir.replace(/\\/g, '/')}/*.conf"
`;

    await fs.writeFile(path.join(confDir, 'httpd.conf'), mainConfig);
    await fs.ensureDir(path.join(confDir, 'htdocs'));
  }

  // Stop a project
  async stopProject(projectId) {
    const processInfo = this.processes.get(projectId);

    if (!processInfo) {
      return { success: true, message: 'Project not running' };
    }

    // Kill PHP-FPM
    if (processInfo.phpFpm && processInfo.phpFpm.pid) {
      await this.killProcess(processInfo.phpFpm.pid);
    }

    // Kill web server
    if (processInfo.server && processInfo.server.pid) {
      await this.killProcess(processInfo.server.pid);
    }

    // Remove config file
    const configPath = path.join(
      this.dataPath,
      processInfo.serverType,
      processInfo.serverType === 'nginx' ? 'sites' : 'vhosts',
      `${projectId}.conf`
    );
    await fs.remove(configPath);

    this.processes.delete(projectId);

    return { success: true };
  }

  // Check memory usage of all PHP-CGI processes and restart if needed
  async checkPhpMemoryUsage() {
    if (process.platform !== 'win32') return; // Only needed on Windows

    for (const [projectId, processInfo] of this.processes) {
      if (!processInfo.phpFpm || !processInfo.phpFpm.pid) continue;

      try {
        const memoryMB = await this.getProcessMemory(processInfo.phpFpm.pid);

        if (memoryMB > this.phpMemoryLimitMB) {
          this.managers?.log?.systemWarn(`PHP-CGI memory limit exceeded for project ${projectId}`, {
            memoryMB: Math.round(memoryMB),
            limitMB: this.phpMemoryLimitMB
          });

          // Get project info to restart PHP
          const project = await this.managers?.project?.getProject(projectId);
          if (project && processInfo.phpFpmPort) {
            await this.restartPhpFpm(projectId, project, processInfo.phpFpmPort);
          }
        }
      } catch (err) {
        // Process may have exited, ignore
      }
    }
  }

  // Kill a process
  killProcess(pid) {
    return new Promise((resolve) => {
      treeKill(pid, 'SIGTERM', (err) => {
        // Ignore errors - process may already be terminated
        // This is normal during shutdown
        resolve();
      });
    });
  }

  // Stop all projects
  async stopAll() {
    const projectIds = Array.from(this.processes.keys());
    for (const projectId of projectIds) {
      await this.stopProject(projectId);
    }
  }

  // Reload web server config
  async reloadConfig() {
    // Reload nginx if running
    const nginxProcess = Array.from(this.processes.values()).find(p => p.serverType === 'nginx');
    if (nginxProcess) {
      const nginxVersion = nginxProcess.serverVersion || '1.28';
      const nginxPath = this.getNginxPath(nginxVersion);
      const nginxBasePath = this.getNginxBasePath(nginxVersion);
      const confPath = path.join(this.dataPath, 'nginx', 'nginx.conf');
      spawn(nginxPath, ['-c', confPath, '-p', nginxBasePath, '-s', 'reload'], { detached: true, windowsHide: true });
    }

    // Reload apache if running  
    const apacheProcess = Array.from(this.processes.values()).find(p => p.serverType === 'apache');
    if (apacheProcess) {
      const apacheVersion = apacheProcess.serverVersion || '2.4';
      const apachePath = this.getApachePath(apacheVersion);
      const confPath = path.join(this.dataPath, 'apache', 'httpd.conf');
      spawn(apachePath, ['-f', confPath, '-k', 'graceful'], { detached: true, windowsHide: true });
    }
  }

  // Get running projects
  getRunningProjects() {
    const running = [];
    for (const [projectId, info] of this.processes) {
      running.push({
        projectId,
        serverType: info.serverType,
        phpFpmPort: info.phpFpmPort,
      });
    }
    return running;
  }

  // Get server status
  async getStatus() {
    return {
      serverType: this.serverType,
      nginxInstalled: await this.isServerInstalled('nginx'),
      apacheInstalled: await this.isServerInstalled('apache'),
      runningProjects: this.getRunningProjects(),
    };
  }
}

module.exports = { WebServerManager };
