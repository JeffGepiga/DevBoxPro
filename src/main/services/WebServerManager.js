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

  // Generate Nginx config for a project
  async generateNginxConfig(project) {
    const { id, name, domain, path: projectPath, phpVersion, ssl, networkAccess } = project;
    const port = project.port || 80;
    const sslPort = project.sslPort || 443;
    const phpFpmPort = 9000 + parseInt(id.slice(-4), 16) % 1000; // Unique port per project

    // Get absolute path to fastcgi_params (with version)
    const platform = this.getPlatform();
    let nginxVersion = project.webServerVersion || '1.28';

    // Validate that the nginx version exists, fall back to available version if not
    const nginxVersionPath = path.join(this.resourcesPath, 'nginx', nginxVersion, platform);
    if (!await fs.pathExists(nginxVersionPath)) {
      // Try to find an available nginx version
      const nginxDir = path.join(this.resourcesPath, 'nginx');
      if (await fs.pathExists(nginxDir)) {
        const availableVersions = await fs.readdir(nginxDir);
        for (const v of availableVersions) {
          const vPath = path.join(nginxDir, v, platform);
          if (await fs.pathExists(vPath)) {
            nginxVersion = v;
            break;
          }
        }
      }
    }

    const fastcgiParamsPath = path.join(this.resourcesPath, 'nginx', nginxVersion, platform, 'conf', 'fastcgi_params').replace(/\\/g, '/');

    // Determine document root
    // Priority: project.documentRoot > /public (if exists) > project root
    let docRoot;
    if (project.documentRoot) {
      // If documentRoot is "/", ".", or empty, use project root
      if (project.documentRoot === '/' || project.documentRoot === '.' || project.documentRoot === '') {
        docRoot = projectPath;
      } else if (path.isAbsolute(project.documentRoot) && project.documentRoot !== '/') {
        // Absolute path (but not just "/") - use as-is
        docRoot = project.documentRoot;
      } else {
        // Relative path - append to project path
        docRoot = path.join(projectPath, project.documentRoot);
      }
    } else {
      // Default behavior: /public for Laravel/modern frameworks, fallback to root
      docRoot = path.join(projectPath, 'public');
      if (project.type === 'wordpress' || !await fs.pathExists(docRoot)) {
        docRoot = projectPath;
      }
    }

    // Validate that docRoot exists and is a directory; fall back to project root if not
    const docRootStat = await fs.stat(docRoot).catch(() => null);
    if (!docRootStat || !docRootStat.isDirectory()) {
      docRoot = projectPath;
    }

    const docRootNginx = docRoot.replace(/\\/g, '/');

    // Network Access Logic
    const allProjects = this.configStore.get('projects', []);
    const networkProjects = allProjects.filter(p => p.networkAccess);
    // Use port 80 if this is the only project with network access
    const usePort80 = networkAccess && networkProjects.length === 1 && networkProjects[0].id === id;

    // nginx 1.25.1+ uses separate 'http2 on;' directive
    // nginx < 1.25 uses 'listen ... ssl http2;' in the listen directive
    const nginxMajorMinor = nginxVersion.split('.').map(Number);
    const supportsHttp2Directive = (nginxMajorMinor[0] > 1) || (nginxMajorMinor[0] === 1 && nginxMajorMinor[1] >= 25);

    // Determine final port and listen directive
    const finalPort = usePort80 ? 80 : port;
    const listenDirective = networkAccess ? `0.0.0.0:${finalPort}` : `${finalPort}`;
    const listenDirectiveSsl = networkAccess
      ? `0.0.0.0:${sslPort} ssl${supportsHttp2Directive ? '' : ' http2'}`
      : `${sslPort} ssl${supportsHttp2Directive ? '' : ' http2'}`;

    // Build server_name - add wildcard if network access is enabled to accept any hostname
    const serverName = networkAccess
      ? `${domain || 'localhost'} _`  // _ is a catch-all server name
      : (domain || 'localhost');

    const isNodeJs = project.type === 'nodejs';
    const nodePort = project.nodePort || 3000;

    let serverConfig;

    if (isNodeJs) {
      // Node.js reverse-proxy configuration
      serverConfig = `
# DevBox Pro - ${name} (Node.js)
# Auto-generated configuration${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}
${usePort80 ? '# Port 80 enabled (Sole network access project)' : ''}

server {
    listen ${listenDirective}${usePort80 ? ' default_server' : ''};
    server_name ${serverName};

    charset utf-8;

    location / {
        proxy_pass http://127.0.0.1:${nodePort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    access_log "${this.dataPath.replace(/\\/g, '/')}/nginx/logs/${id}-access.log";
    error_log "${this.dataPath.replace(/\\/g, '/')}/nginx/logs/${id}-error.log";
}
`;
      // Add SSL block for Node.js if enabled
      if (ssl) {
        const certPath = path.join(this.dataPath, 'ssl', domain || id);
        serverConfig += `

server {
    listen ${listenDirectiveSsl};
${supportsHttp2Directive ? '    http2 on;\n' : ''}    server_name ${serverName};

    ssl_certificate "${certPath.replace(/\\/g, '/')}/cert.pem";
    ssl_certificate_key "${certPath.replace(/\\/g, '/')}/key.pem";
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    charset utf-8;

    location / {
        proxy_pass http://127.0.0.1:${nodePort};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
`;
      }
    } else {
      // Standard PHP FastCGI configuration
      serverConfig = `
# DevBox Pro - ${name}
# Auto-generated configuration${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}
${usePort80 ? '# Port 80 enabled (Sole network access project)' : ''}

server {
    listen ${listenDirective}${usePort80 ? ' default_server' : ''};
    server_name ${serverName};
    root "${docRootNginx}";
    index index.php index.html index.htm;

    charset utf-8;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        try_files $uri /index.php?$query_string;
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include ${fastcgiParamsPath};
        fastcgi_hide_header X-Powered-By;
        
        # Timeout settings for long-running PHP processes (0 = unlimited)
        fastcgi_read_timeout 0;
        fastcgi_connect_timeout 60s;
        fastcgi_send_timeout 0;
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
    listen ${listenDirectiveSsl};
${supportsHttp2Directive ? '    http2 on;\n' : ''}    server_name ${serverName};
    root "${docRootNginx}";
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
        try_files $uri /index.php?$query_string;
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include ${fastcgiParamsPath};
        fastcgi_hide_header X-Powered-By;
        
        # Timeout settings for long-running PHP processes (0 = unlimited)
        fastcgi_read_timeout 0;
        fastcgi_connect_timeout 60s;
        fastcgi_send_timeout 0;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }
}
`;
      }
    }

    // Save config
    const configPath = path.join(this.dataPath, 'nginx', 'sites', `${id}.conf`);
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, serverConfig);

    return { configPath, phpFpmPort: isNodeJs ? null : phpFpmPort };
  }

  // Generate Apache config for a project
  async generateApacheConfig(project) {
    const { id, name, domain, path: projectPath, phpVersion, ssl, networkAccess } = project;
    const port = project.port || 80;
    const sslPort = project.sslPort || 443;
    const phpFpmPort = 9000 + parseInt(id.slice(-4), 16) % 1000;

    // Network Access Logic
    const allProjects = this.configStore.get('projects', []);
    const networkProjects = allProjects.filter(p => p.networkAccess);
    // Use port 80 if this is the only project with network access
    const usePort80 = networkAccess && networkProjects.length === 1 && networkProjects[0].id === id;

    const finalPort = usePort80 ? 80 : port;

    // Determine document root
    // Priority: project.documentRoot > /public (if exists) > project root
    let docRoot;
    if (project.documentRoot) {
      // If documentRoot is "/", ".", or empty, use project root
      if (project.documentRoot === '/' || project.documentRoot === '.' || project.documentRoot === '') {
        docRoot = projectPath;
      } else if (path.isAbsolute(project.documentRoot) && project.documentRoot !== '/') {
        // Absolute path (but not just "/") - use as-is
        docRoot = project.documentRoot;
      } else {
        // Relative path - append to project path
        docRoot = path.join(projectPath, project.documentRoot);
      }
    } else {
      // Default behavior: /public for Laravel/modern frameworks, fallback to root
      docRoot = path.join(projectPath, 'public');
      if (project.type === 'wordpress' || !await fs.pathExists(docRoot)) {
        docRoot = projectPath;
      }
    }

    // Validate that docRoot exists and is a directory; fall back to project root if not
    const docRootStat = await fs.stat(docRoot).catch(() => null);
    if (!docRootStat || !docRootStat.isDirectory()) {
      docRoot = projectPath;
    }

    const docRootApache = docRoot.replace(/\\/g, '/');

    // Add ServerAlias * when network access is enabled to accept any hostname
    const serverAliasDirective = networkAccess ? '\n    ServerAlias *' : '';

    const isNodeJs = project.type === 'nodejs';
    const nodePort = project.nodePort || 3000;

    let vhostConfig;

    if (isNodeJs) {
      // Node.js reverse-proxy configuration
      vhostConfig = `
# DevBox Pro - ${name} (Node.js)
# Auto-generated configuration${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}
${usePort80 ? '# Port 80 enabled (Sole network access project)' : ''}

<VirtualHost *:${finalPort}>
    ServerName ${domain || 'localhost'}${serverAliasDirective}

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${nodePort}/
    ProxyPassReverse / http://127.0.0.1:${nodePort}/

    ErrorLog "${this.dataPath}/apache/logs/${id}-error.log"
    CustomLog "${this.dataPath}/apache/logs/${id}-access.log" combined
</VirtualHost>
`;
      if (ssl) {
        const certPath = path.join(this.dataPath, 'ssl', domain || id);
        vhostConfig += `

<VirtualHost *:${sslPort}>
    ServerName ${domain || 'localhost'}${serverAliasDirective}

    SSLEngine on
    SSLCertificateFile "${certPath}/cert.pem"
    SSLCertificateKeyFile "${certPath}/key.pem"

    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:${nodePort}/
    ProxyPassReverse / http://127.0.0.1:${nodePort}/

    ErrorLog "${this.dataPath}/apache/logs/${id}-ssl-error.log"
    CustomLog "${this.dataPath}/apache/logs/${id}-ssl-access.log" combined
</VirtualHost>
`;
      }
    } else {
      // Standard PHP FastCGI configuration
      vhostConfig = `
# DevBox Pro - ${name}
# Auto-generated configuration${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}
${usePort80 ? '# Port 80 enabled (Sole network access project)' : ''}

<VirtualHost *:${finalPort}>
    ServerName ${domain || 'localhost'}${serverAliasDirective}
    DocumentRoot "${docRootApache}"
    
    <Directory "${docRootApache}">
        Options Indexes FollowSymLinks MultiViews
        AllowOverride All
        Require all granted
        
        # Handle non-existent PHP files through Laravel's front controller
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteRule ^(.+\.php)$ /index.php [L,QSA]
    </Directory>

    # PHP-FPM/CGI proxy with timeout for long-running processes (0 = unlimited)
    ProxyTimeout 0
    <FilesMatch \.php$>
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
    ServerName ${domain || 'localhost'}${serverAliasDirective}
    DocumentRoot "${docRootApache}"
    
    SSLEngine on
    SSLCertificateFile "${certPath}/cert.pem"
    SSLCertificateKeyFile "${certPath}/key.pem"
    
    <Directory "${docRootApache}">
        Options Indexes FollowSymLinks MultiViews
        AllowOverride All
        Require all granted
        
        # Handle non-existent PHP files through Laravel's front controller
        RewriteEngine On
        RewriteCond %{REQUEST_FILENAME} !-f
        RewriteRule ^(.+\.php)$ /index.php [L,QSA]
    </Directory>

    # PHP-FPM/CGI proxy with timeout for long-running processes (0 = unlimited)
    ProxyTimeout 0
    <FilesMatch \.php$>
        SetHandler "proxy:fcgi://127.0.0.1:${phpFpmPort}"
    </FilesMatch>

    DirectoryIndex index.php index.html

    ErrorLog "${this.dataPath}/apache/logs/${id}-ssl-error.log"
    CustomLog "${this.dataPath}/apache/logs/${id}-ssl-access.log" combined
</VirtualHost>
`;
      }
    }

    // Save config
    const configPath = path.join(this.dataPath, 'apache', 'vhosts', `${id}.conf`);
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, vhostConfig);

    return { configPath, phpFpmPort: isNodeJs ? null : phpFpmPort };
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
          PHP_FCGI_MAX_REQUESTS: '100', // Restart workers after 100 requests to prevent memory accumulation
          PHP_FCGI_CHILDREN: '1', // Use 1 child process to reduce memory footprint (similar to Laragon)
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
    // Use the project's own web server preference, falling back to global setting
    const serverType = project.webServer || this.serverType;

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

    // Store process references with server version
    const serverVersion = project.webServerVersion || (serverType === 'nginx' ? '1.28' : '2.4');
    this.processes.set(project.id, {
      server: serverProcess,
      phpFpm: phpProcess,
      serverType,
      serverVersion,
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
      // Get the nginx version from project config, default to 1.28
      const nginxVersion = project.webServerVersion || '1.28';
      const nginxPath = this.getNginxPath(nginxVersion);
      const nginxBasePath = this.getNginxBasePath(nginxVersion);
      const confPath = path.join(this.dataPath, 'nginx', 'nginx.conf');

      // Create main nginx.conf that includes all sites
      await this.createMainNginxConfig(nginxVersion);

      serverProcess = spawn(nginxPath, ['-c', confPath, '-p', nginxBasePath], {
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } else {
      // Get the apache version from project config, default to 2.4
      const apacheVersion = project.webServerVersion || '2.4';
      const apachePath = this.getApachePath(apacheVersion);
      const confPath = path.join(this.dataPath, 'apache', 'httpd.conf');

      // Create main httpd.conf that includes all vhosts
      await this.createMainApacheConfig(apacheVersion);

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
