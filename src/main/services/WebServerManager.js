const { app } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const treeKill = require('tree-kill');

class WebServerManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.resourcesPath = path.join(app.getPath('userData'), 'resources');
    this.dataPath = path.join(app.getPath('userData'), 'data');
    this.processes = new Map(); // projectId -> { server, phpFpm }
    this.serverType = 'nginx'; // 'nginx' or 'apache'
  }

  async initialize() {
    await fs.ensureDir(path.join(this.dataPath, 'nginx'));
    await fs.ensureDir(path.join(this.dataPath, 'apache'));
    await fs.ensureDir(path.join(this.dataPath, 'php-fpm'));
    
    // Load preferred server type from config
    this.serverType = this.configStore.get('settings.webServer', 'nginx');
  }

  getPlatform() {
    return process.platform === 'win32' ? 'win' : 'mac';
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

  // Get path to nginx executable
  getNginxPath() {
    const platform = this.getPlatform();
    const exe = platform === 'win' ? 'nginx.exe' : 'nginx';
    return path.join(this.resourcesPath, 'nginx', platform, exe);
  }

  // Get path to Apache executable
  getApachePath() {
    const platform = this.getPlatform();
    const exe = platform === 'win' ? 'bin/httpd.exe' : 'bin/httpd';
    return path.join(this.resourcesPath, 'apache', platform, exe);
  }

  // Get path to PHP-CGI/FPM
  getPhpCgiPath(version = '8.3') {
    const platform = this.getPlatform();
    const exe = platform === 'win' ? 'php-cgi.exe' : 'php-fpm';
    return path.join(this.resourcesPath, 'php', version, platform, exe);
  }

  // Check if web server is installed
  async isServerInstalled(type = null) {
    const serverType = type || this.serverType;
    const serverPath = serverType === 'nginx' ? this.getNginxPath() : this.getApachePath();
    return fs.pathExists(serverPath);
  }

  // Generate Nginx config for a project
  async generateNginxConfig(project) {
    const { id, name, domain, path: projectPath, phpVersion, ssl } = project;
    const port = project.port || 80;
    const sslPort = project.sslPort || 443;
    const phpFpmPort = 9000 + parseInt(id.slice(-4), 16) % 1000; // Unique port per project

    // Get absolute path to fastcgi_params
    const platform = this.getPlatform();
    const fastcgiParamsPath = path.join(this.resourcesPath, 'nginx', platform, 'conf', 'fastcgi_params').replace(/\\/g, '/');

    let serverConfig = `
# DevBox Pro - ${name}
# Auto-generated configuration

server {
    listen ${port};
    server_name ${domain || 'localhost'};
    root "${projectPath.replace(/\\/g, '/')}/public";
    index index.php index.html index.htm;

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include ${fastcgiParamsPath};
        fastcgi_hide_header X-Powered-By;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }

    access_log "${this.dataPath.replace(/\\/g, '/')}/nginx/logs/${id}-access.log";
    error_log "${this.dataPath.replace(/\\/g, '/')}/nginx/logs/${id}-error.log";
}
`;

    // Add SSL server block if SSL is enabled
    if (ssl) {
      const certPath = path.join(this.dataPath, 'ssl', domain || id);
      serverConfig += `

server {
    listen ${sslPort} ssl http2;
    server_name ${domain || 'localhost'};
    root "${projectPath.replace(/\\/g, '/')}/public";
    index index.php index.html index.htm;

    ssl_certificate "${certPath.replace(/\\/g, '/')}/cert.pem";
    ssl_certificate_key "${certPath.replace(/\\/g, '/')}/key.pem";
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include ${fastcgiParamsPath};
        fastcgi_hide_header X-Powered-By;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`;
    }

    // Save config
    const configPath = path.join(this.dataPath, 'nginx', 'sites', `${id}.conf`);
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, serverConfig);

    return { configPath, phpFpmPort };
  }

  // Generate Apache config for a project
  async generateApacheConfig(project) {
    const { id, name, domain, path: projectPath, phpVersion, ssl } = project;
    const port = project.port || 80;
    const sslPort = project.sslPort || 443;
    const phpFpmPort = 9000 + parseInt(id.slice(-4), 16) % 1000;

    let vhostConfig = `
# DevBox Pro - ${name}
# Auto-generated configuration

<VirtualHost *:${port}>
    ServerName ${domain || 'localhost'}
    DocumentRoot "${projectPath}/public"
    
    <Directory "${projectPath}/public">
        Options Indexes FollowSymLinks MultiViews
        AllowOverride All
        Require all granted
    </Directory>

    # PHP-FPM proxy
    <FilesMatch \\.php$>
        SetHandler "proxy:fcgi://127.0.0.1:${phpFpmPort}"
    </FilesMatch>

    DirectoryIndex index.php index.html

    ErrorLog "${this.dataPath}/apache/logs/${id}-error.log"
    CustomLog "${this.dataPath}/apache/logs/${id}-access.log" combined
</VirtualHost>
`;

    // Add SSL virtual host if enabled
    if (ssl) {
      const certPath = path.join(this.dataPath, 'ssl', domain || id);
      vhostConfig += `

<VirtualHost *:${sslPort}>
    ServerName ${domain || 'localhost'}
    DocumentRoot "${projectPath}/public"
    
    SSLEngine on
    SSLCertificateFile "${certPath}/cert.pem"
    SSLCertificateKeyFile "${certPath}/key.pem"
    
    <Directory "${projectPath}/public">
        Options Indexes FollowSymLinks MultiViews
        AllowOverride All
        Require all granted
    </Directory>

    <FilesMatch \\.php$>
        SetHandler "proxy:fcgi://127.0.0.1:${phpFpmPort}"
    </FilesMatch>

    DirectoryIndex index.php index.html

    ErrorLog "${this.dataPath}/apache/logs/${id}-ssl-error.log"
    CustomLog "${this.dataPath}/apache/logs/${id}-ssl-access.log" combined
</VirtualHost>
`;
    }

    // Save config
    const configPath = path.join(this.dataPath, 'apache', 'vhosts', `${id}.conf`);
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, vhostConfig);

    return { configPath, phpFpmPort };
  }

  // Start PHP-FPM/CGI for a project
  async startPhpFpm(project, port) {
    const phpCgiPath = this.getPhpCgiPath(project.phpVersion || '8.3');
    
    if (!await fs.pathExists(phpCgiPath)) {
      throw new Error(`PHP ${project.phpVersion} is not installed`);
    }

    const platform = this.getPlatform();
    let phpProcess;

    if (platform === 'win') {
      // Windows: Use php-cgi in FastCGI mode
      phpProcess = spawn(phpCgiPath, ['-b', `127.0.0.1:${port}`], {
        cwd: project.path,
        env: {
          ...process.env,
          PHP_FCGI_MAX_REQUESTS: '0', // Unlimited requests
          PHP_FCGI_CHILDREN: '4',
        },
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } else {
      // macOS/Linux: Use php-fpm
      const fpmConfigPath = await this.createPhpFpmConfig(project, port);
      phpProcess = spawn(phpCgiPath, ['-y', fpmConfigPath, '-F'], {
        cwd: project.path,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    }

    phpProcess.unref();
    
    return phpProcess;
  }

  // Create PHP-FPM config file (for macOS/Linux)
  async createPhpFpmConfig(project, port) {
    const configPath = path.join(this.dataPath, 'php-fpm', `${project.id}.conf`);
    const logPath = path.join(this.dataPath, 'php-fpm', 'logs');
    await fs.ensureDir(logPath);

    const config = `
[global]
pid = ${this.dataPath}/php-fpm/${project.id}.pid
error_log = ${logPath}/${project.id}-error.log

[www]
listen = 127.0.0.1:${port}
listen.allowed_clients = 127.0.0.1

pm = dynamic
pm.max_children = 5
pm.start_servers = 2
pm.min_spare_servers = 1
pm.max_spare_servers = 3

catch_workers_output = yes
`;

    await fs.writeFile(configPath, config);
    return configPath;
  }

  // Start a project with web server
  async startProject(project) {
    const serverType = this.serverType;
    
    // Check if server is installed
    if (!await this.isServerInstalled(serverType)) {
      throw new Error(`${serverType} is not installed. Please download it from the Binary Manager.`);
    }

    // Generate config
    let config;
    if (serverType === 'nginx') {
      config = await this.generateNginxConfig(project);
    } else {
      config = await this.generateApacheConfig(project);
    }

    // Start PHP-FPM
    const phpProcess = await this.startPhpFpm(project, config.phpFpmPort);

    // Start web server for this project
    const serverProcess = await this.startWebServer(project, serverType);

    // Store process references
    this.processes.set(project.id, {
      server: serverProcess,
      phpFpm: phpProcess,
      serverType,
      phpFpmPort: config.phpFpmPort,
    });

    return {
      success: true,
      serverType,
      phpFpmPort: config.phpFpmPort,
    };
  }

  // Start web server
  async startWebServer(project, serverType) {
    const platform = this.getPlatform();
    let serverProcess;

    if (serverType === 'nginx') {
      const nginxPath = this.getNginxPath();
      const confPath = path.join(this.dataPath, 'nginx', 'nginx.conf');
      
      // Create main nginx.conf that includes all sites
      await this.createMainNginxConfig();
      
      serverProcess = spawn(nginxPath, ['-c', confPath, '-p', path.join(this.dataPath, 'nginx')], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } else {
      const apachePath = this.getApachePath();
      const confPath = path.join(this.dataPath, 'apache', 'httpd.conf');
      
      // Create main httpd.conf that includes all vhosts
      await this.createMainApacheConfig();
      
      serverProcess = spawn(apachePath, ['-f', confPath, '-k', 'start'], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    }

    serverProcess.unref();
    return serverProcess;
  }

  // Create main Nginx config
  async createMainNginxConfig() {
    const confDir = path.join(this.dataPath, 'nginx');
    const sitesDir = path.join(confDir, 'sites');
    const logsDir = path.join(confDir, 'logs');
    
    await fs.ensureDir(sitesDir);
    await fs.ensureDir(logsDir);

    const platform = this.getPlatform();
    const mimeTypes = platform === 'win' 
      ? path.join(this.resourcesPath, 'nginx', platform, 'conf', 'mime.types')
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
}
`;

    await fs.writeFile(path.join(confDir, 'nginx.conf'), mainConfig);
  }

  // Create main Apache config
  async createMainApacheConfig() {
    const confDir = path.join(this.dataPath, 'apache');
    const vhostsDir = path.join(confDir, 'vhosts');
    const logsDir = path.join(confDir, 'logs');
    const platform = this.getPlatform();
    const apacheRoot = path.join(this.resourcesPath, 'apache', platform);
    
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

  // Kill a process
  killProcess(pid) {
    return new Promise((resolve) => {
      treeKill(pid, 'SIGTERM', (err) => {
        if (err) {
          console.error(`Error killing process ${pid}:`, err);
        }
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
    const nginxRunning = Array.from(this.processes.values()).some(p => p.serverType === 'nginx');
    if (nginxRunning) {
      const nginxPath = this.getNginxPath();
      const confPath = path.join(this.dataPath, 'nginx', 'nginx.conf');
      spawn(nginxPath, ['-c', confPath, '-s', 'reload'], { detached: true, windowsHide: true });
    }

    // Reload apache if running  
    const apacheRunning = Array.from(this.processes.values()).some(p => p.serverType === 'apache');
    if (apacheRunning) {
      const apachePath = this.getApachePath();
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
