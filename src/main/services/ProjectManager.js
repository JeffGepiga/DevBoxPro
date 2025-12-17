const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { spawn, exec } = require('child_process');
const http = require('http');
const httpProxy = require('http-proxy');
const os = require('os');

class ProjectManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.runningProjects = new Map();
    this.projectServers = new Map();
    this.proxy = httpProxy.createProxyServer({});
  }

  async initialize() {
    console.log('Initializing ProjectManager...');

    // Ensure projects array exists in config
    if (!this.configStore.get('projects')) {
      this.configStore.set('projects', []);
    }

    console.log('ProjectManager initialized');
  }

  getAllProjects() {
    return this.configStore.get('projects', []).map((project) => ({
      ...project,
      isRunning: this.runningProjects.has(project.id),
    }));
  }

  getProject(id) {
    const projects = this.configStore.get('projects', []);
    const project = projects.find((p) => p.id === id);
    if (project) {
      project.isRunning = this.runningProjects.has(id);
    }
    return project;
  }

  async createProject(config) {
    const id = uuidv4();
    const settings = this.configStore.get('settings', {});
    const existingProjects = this.configStore.get('projects', []);

    // Find available port
    const usedPorts = existingProjects.map((p) => p.port);
    let port = settings.portRangeStart || 8000;
    while (usedPorts.includes(port)) {
      port++;
    }

    // SSL port (443 base + offset)
    let sslPort = 443;
    const usedSslPorts = existingProjects.map((p) => p.sslPort).filter(Boolean);
    while (usedSslPorts.includes(sslPort)) {
      sslPort++;
    }

    // Detect project type if not specified
    const projectType = config.type || (await this.detectProjectType(config.path));

    // Generate domain name from project name
    const domainName = config.domain || `${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.test`;

    const project = {
      id,
      name: config.name,
      path: config.path,
      type: projectType,
      phpVersion: config.phpVersion || '8.3',
      webServer: config.webServer || settings.webServer || 'nginx',
      port,
      sslPort,
      domain: domainName,
      domains: [domainName],
      ssl: config.ssl !== false, // SSL enabled by default
      autoStart: config.autoStart || false,
      services: {
        mysql: config.services?.mysql !== false,
        redis: config.services?.redis || false,
        queue: config.services?.queue || false,
      },
      environment: this.getDefaultEnvironment(projectType, config.name, port),
      supervisor: {
        workers: config.supervisor?.workers || 1,
        processes: [],
      },
      createdAt: new Date().toISOString(),
      lastStarted: null,
    };

    // Create database for project if MySQL is enabled
    if (project.services.mysql) {
      const dbName = this.sanitizeDatabaseName(config.name);
      project.environment.DB_DATABASE = dbName;

      try {
        await this.managers.database?.createDatabase(dbName);
      } catch (error) {
        console.warn('Could not create database:', error.message);
      }
    }

    // Create SSL certificate if enabled
    if (project.ssl) {
      try {
        await this.managers.ssl?.createCertificate(project.domains);
      } catch (error) {
        console.warn('Could not create SSL certificate:', error.message);
      }
    }

    // Create virtual host configuration (HTTP + HTTPS)
    try {
      await this.createVirtualHost(project);
    } catch (error) {
      console.warn('Could not create virtual host:', error.message);
    }

    // Add domain to hosts file
    try {
      await this.addToHostsFile(project.domain);
    } catch (error) {
      console.warn('Could not update hosts file:', error.message);
    }

    // Set up queue worker if enabled
    if (project.services.queue && project.type === 'laravel') {
      project.supervisor.processes.push({
        name: 'queue-worker',
        command: 'php artisan queue:work',
        autostart: true,
        autorestart: true,
        numprocs: project.supervisor.workers,
      });
    }

    // Save project
    existingProjects.push(project);
    this.configStore.set('projects', existingProjects);

    console.log(`Project created: ${project.name} (${project.id})`);
    return project;
  }

  async updateProject(id, updates) {
    const projects = this.configStore.get('projects', []);
    const index = projects.findIndex((p) => p.id === id);

    if (index === -1) {
      throw new Error('Project not found');
    }

    const isRunning = this.runningProjects.has(id);
    if (isRunning) {
      await this.stopProject(id);
    }

    // Merge updates
    projects[index] = {
      ...projects[index],
      ...updates,
      id, // Preserve ID
      updatedAt: new Date().toISOString(),
    };

    this.configStore.set('projects', projects);

    // Restart if was running
    if (isRunning) {
      await this.startProject(id);
    }

    return projects[index];
  }

  async deleteProject(id) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    // Stop if running
    if (this.runningProjects.has(id)) {
      await this.stopProject(id);
    }

    // Remove virtual host configuration
    try {
      await this.removeVirtualHost(project);
    } catch (error) {
      console.warn('Error removing virtual host:', error.message);
    }

    // Remove project from config
    const projects = this.configStore.get('projects', []);
    const filtered = projects.filter((p) => p.id !== id);
    this.configStore.set('projects', filtered);

    console.log(`Project deleted: ${project.name} (${id})`);
    return { success: true };
  }

  async startProject(id) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    if (this.runningProjects.has(id)) {
      console.log(`Project ${project.name} is already running`);
      return { success: true, alreadyRunning: true };
    }

    console.log(`Starting project: ${project.name}`);

    try {
      // Get PHP binary path
      const phpPath = this.managers.php.getPhpBinaryPath(project.phpVersion);

      // Determine document root based on project type
      const documentRoot = this.getDocumentRoot(project);

      // Start PHP built-in server
      const serverProcess = spawn(phpPath, ['-S', `127.0.0.1:${project.port}`, '-t', documentRoot], {
        cwd: project.path,
        env: {
          ...process.env,
          ...project.environment,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      serverProcess.stdout.on('data', (data) => {
        this.managers.log?.project(id, data.toString());
      });

      serverProcess.stderr.on('data', (data) => {
        this.managers.log?.project(id, data.toString());
      });

      serverProcess.on('error', (error) => {
        console.error(`Project ${project.name} server error:`, error);
        this.runningProjects.delete(id);
      });

      serverProcess.on('exit', (code) => {
        console.log(`Project ${project.name} server exited with code ${code}`);
        this.runningProjects.delete(id);
      });

      this.runningProjects.set(id, {
        process: serverProcess,
        startedAt: new Date(),
      });

      // Start supervisor processes
      if (project.supervisor.processes.length > 0) {
        await this.startSupervisorProcesses(project);
      }

      // Update hosts file for custom domains (if possible)
      await this.updateHostsFile(project);

      // Update last started time
      const projects = this.configStore.get('projects', []);
      const index = projects.findIndex((p) => p.id === id);
      if (index !== -1) {
        projects[index].lastStarted = new Date().toISOString();
        this.configStore.set('projects', projects);
      }

      console.log(`Project ${project.name} started on port ${project.port}`);
      return { success: true, port: project.port };
    } catch (error) {
      console.error(`Failed to start project ${project.name}:`, error);
      throw error;
    }
  }

  async stopProject(id) {
    const running = this.runningProjects.get(id);
    if (!running) {
      return { success: true, wasRunning: false };
    }

    const project = this.getProject(id);
    console.log(`Stopping project: ${project?.name || id}`);

    try {
      const kill = require('tree-kill');

      // Stop main server process
      if (running.process && running.process.pid) {
        await new Promise((resolve) => {
          kill(running.process.pid, 'SIGTERM', (err) => {
            if (err) console.error('Error killing process:', err);
            resolve();
          });
        });
      }

      // Stop supervisor processes
      if (project?.supervisor.processes.length > 0) {
        await this.managers.supervisor?.stopAllProcesses(id);
      }

      this.runningProjects.delete(id);
      console.log(`Project ${project?.name || id} stopped`);

      return { success: true, wasRunning: true };
    } catch (error) {
      console.error(`Error stopping project:`, error);
      throw error;
    }
  }

  async startSupervisorProcesses(project) {
    for (const processConfig of project.supervisor.processes) {
      if (processConfig.autostart) {
        try {
          await this.managers.supervisor?.startProcess(project.id, processConfig);
        } catch (error) {
          console.error(`Failed to start supervisor process ${processConfig.name}:`, error);
        }
      }
    }
  }

  getProjectStatus(id) {
    const project = this.getProject(id);
    const running = this.runningProjects.get(id);

    return {
      id,
      name: project?.name,
      isRunning: !!running,
      port: project?.port,
      uptime: running ? Date.now() - running.startedAt.getTime() : null,
      domains: project?.domains,
      ssl: project?.ssl,
      url: running ? this.getProjectUrl(project) : null,
    };
  }

  getProjectUrl(project) {
    const protocol = project.ssl ? 'https' : 'http';
    const domain = project.domains?.[0] || `localhost:${project.port}`;
    return `${protocol}://${domain}`;
  }

  getDocumentRoot(project) {
    switch (project.type) {
      case 'laravel':
        return path.join(project.path, 'public');
      case 'symfony':
        return path.join(project.path, 'public');
      case 'wordpress':
        return project.path;
      default:
        // Check for common directories
        const publicPath = path.join(project.path, 'public');
        const wwwPath = path.join(project.path, 'www');
        const webPath = path.join(project.path, 'web');

        if (fs.existsSync(publicPath)) return publicPath;
        if (fs.existsSync(wwwPath)) return wwwPath;
        if (fs.existsSync(webPath)) return webPath;

        return project.path;
    }
  }

  async detectProjectType(projectPath) {
    try {
      // Check for Laravel
      const composerPath = path.join(projectPath, 'composer.json');
      if (await fs.pathExists(composerPath)) {
        const composer = await fs.readJson(composerPath);
        if (composer.require?.['laravel/framework']) {
          return 'laravel';
        }
        if (composer.require?.['symfony/framework-bundle']) {
          return 'symfony';
        }
      }

      // Check for WordPress
      if (await fs.pathExists(path.join(projectPath, 'wp-config.php'))) {
        return 'wordpress';
      }
      if (await fs.pathExists(path.join(projectPath, 'wp-config-sample.php'))) {
        return 'wordpress';
      }

      return 'custom';
    } catch (error) {
      return 'custom';
    }
  }

  getDefaultEnvironment(projectType, projectName, port) {
    const baseEnv = {
      APP_ENV: 'local',
      APP_DEBUG: 'true',
    };

    switch (projectType) {
      case 'laravel':
        return {
          ...baseEnv,
          APP_NAME: projectName,
          APP_KEY: '',
          APP_URL: `http://localhost:${port}`,
          DB_CONNECTION: 'mysql',
          DB_HOST: '127.0.0.1',
          DB_PORT: '3306',
          DB_DATABASE: this.sanitizeDatabaseName(projectName),
          DB_USERNAME: 'root',
          DB_PASSWORD: '',
          CACHE_DRIVER: 'redis',
          QUEUE_CONNECTION: 'redis',
          SESSION_DRIVER: 'redis',
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: '6379',
          MAIL_MAILER: 'smtp',
          MAIL_HOST: '127.0.0.1',
          MAIL_PORT: '1025',
        };

      case 'symfony':
        return {
          ...baseEnv,
          DATABASE_URL: `mysql://root:@127.0.0.1:3306/${this.sanitizeDatabaseName(projectName)}`,
          MAILER_DSN: 'smtp://127.0.0.1:1025',
        };

      case 'wordpress':
        return {
          ...baseEnv,
          WP_DEBUG: 'true',
        };

      default:
        return baseEnv;
    }
  }

  sanitizeDatabaseName(name) {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 64);
  }

  async updateHostsFile(project) {
    // This would require elevated permissions
    // For now, we'll just log a message
    const domains = project.domains.join(', ');
    console.log(`Note: Add the following to your hosts file for custom domains: 127.0.0.1 ${domains}`);

    // In a production app, you might use a local DNS server or
    // prompt the user for admin permissions to modify the hosts file
  }

  // Create virtual host configuration for the project
  async createVirtualHost(project) {
    const webServer = project.webServer || this.configStore.get('settings.webServer', 'nginx');
    
    if (webServer === 'nginx') {
      await this.createNginxVhost(project);
    } else {
      await this.createApacheVhost(project);
    }

    console.log(`Virtual host created for ${project.domain} using ${webServer}`);
  }

  // Create Nginx virtual host
  async createNginxVhost(project) {
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const sitesDir = path.join(dataPath, 'nginx', 'sites');
    const sslDir = path.join(dataPath, 'ssl', project.domain);

    await fs.ensureDir(sitesDir);

    const documentRoot = this.getDocumentRoot(project);
    const phpFpmPort = 9000 + (parseInt(project.id.slice(-4), 16) % 1000);

    // Generate nginx config with both HTTP and HTTPS
    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}

# HTTP Server
server {
    listen 80;
    server_name ${project.domain} www.${project.domain};
    root "${documentRoot.replace(/\\/g, '/')}";
    index index.php index.html index.htm;

    charset utf-8;
    client_max_body_size 128M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_hide_header X-Powered-By;
        fastcgi_read_timeout 300;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }

    access_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-access.log";
    error_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-error.log";
}
`;

    // Add HTTPS server block if SSL is enabled
    if (project.ssl) {
      config += `
# HTTPS Server (SSL)
server {
    listen 443 ssl http2;
    server_name ${project.domain} www.${project.domain};
    root "${documentRoot.replace(/\\/g, '/')}";
    index index.php index.html index.htm;

    # SSL Configuration
    ssl_certificate "${sslDir.replace(/\\/g, '/')}/cert.pem";
    ssl_certificate_key "${sslDir.replace(/\\/g, '/')}/key.pem";
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    charset utf-8;
    client_max_body_size 128M;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location = /favicon.ico { access_log off; log_not_found off; }
    location = /robots.txt  { access_log off; log_not_found off; }

    error_page 404 /index.php;

    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:${phpFpmPort};
        fastcgi_index index.php;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
        fastcgi_hide_header X-Powered-By;
        fastcgi_read_timeout 300;
    }

    location ~ /\\.(?!well-known).* {
        deny all;
    }

    access_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-ssl-access.log";
    error_log "${dataPath.replace(/\\/g, '/')}/nginx/logs/${project.id}-ssl-error.log";
}
`;
    }

    // Save config file
    const configPath = path.join(sitesDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);

    // Ensure logs directory exists
    await fs.ensureDir(path.join(dataPath, 'nginx', 'logs'));

    return configPath;
  }

  // Create Apache virtual host
  async createApacheVhost(project) {
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
    const sslDir = path.join(dataPath, 'ssl', project.domain);

    await fs.ensureDir(vhostsDir);

    const documentRoot = this.getDocumentRoot(project);
    const phpFpmPort = 9000 + (parseInt(project.id.slice(-4), 16) % 1000);

    // Generate Apache config with both HTTP and HTTPS
    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}

# HTTP Virtual Host
<VirtualHost *:80>
    ServerName ${project.domain}
    ServerAlias www.${project.domain}
    DocumentRoot "${documentRoot}"
    
    <Directory "${documentRoot}">
        Options Indexes FollowSymLinks MultiViews
        AllowOverride All
        Require all granted
        
        # Enable .htaccess
        <IfModule mod_rewrite.c>
            RewriteEngine On
            RewriteBase /
            RewriteCond %{REQUEST_FILENAME} !-f
            RewriteCond %{REQUEST_FILENAME} !-d
            RewriteRule ^(.*)$ index.php?$1 [L,QSA]
        </IfModule>
    </Directory>

    # PHP-FPM Configuration
    <FilesMatch \\.php$>
        SetHandler "proxy:fcgi://127.0.0.1:${phpFpmPort}"
    </FilesMatch>

    DirectoryIndex index.php index.html

    ErrorLog "${dataPath}/apache/logs/${project.id}-error.log"
    CustomLog "${dataPath}/apache/logs/${project.id}-access.log" combined
</VirtualHost>
`;

    // Add HTTPS virtual host if SSL is enabled
    if (project.ssl) {
      config += `
# HTTPS Virtual Host (SSL)
<VirtualHost *:443>
    ServerName ${project.domain}
    ServerAlias www.${project.domain}
    DocumentRoot "${documentRoot}"
    
    # SSL Configuration
    SSLEngine on
    SSLCertificateFile "${sslDir}/cert.pem"
    SSLCertificateKeyFile "${sslDir}/key.pem"
    
    # Modern SSL configuration
    SSLProtocol all -SSLv3 -TLSv1 -TLSv1.1
    SSLCipherSuite ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256
    SSLHonorCipherOrder off
    
    # Security headers
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Frame-Options "SAMEORIGIN"
    Header always set X-Content-Type-Options "nosniff"
    
    <Directory "${documentRoot}">
        Options Indexes FollowSymLinks MultiViews
        AllowOverride All
        Require all granted
        
        <IfModule mod_rewrite.c>
            RewriteEngine On
            RewriteBase /
            RewriteCond %{REQUEST_FILENAME} !-f
            RewriteCond %{REQUEST_FILENAME} !-d
            RewriteRule ^(.*)$ index.php?$1 [L,QSA]
        </IfModule>
    </Directory>

    <FilesMatch \\.php$>
        SetHandler "proxy:fcgi://127.0.0.1:${phpFpmPort}"
    </FilesMatch>

    DirectoryIndex index.php index.html

    ErrorLog "${dataPath}/apache/logs/${project.id}-ssl-error.log"
    CustomLog "${dataPath}/apache/logs/${project.id}-ssl-access.log" combined
</VirtualHost>
`;
    }

    // Save config file
    const configPath = path.join(vhostsDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);

    // Ensure logs directory exists
    await fs.ensureDir(path.join(dataPath, 'apache', 'logs'));

    return configPath;
  }

  // Add domain to hosts file (requires admin privileges)
  async addToHostsFile(domain) {
    const hostsPath = process.platform === 'win32' 
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    try {
      const hostsContent = await fs.readFile(hostsPath, 'utf-8');
      
      // Check if domain already exists
      if (hostsContent.includes(domain)) {
        console.log(`Domain ${domain} already in hosts file`);
        return;
      }

      // Entry to add
      const entry = `\n127.0.0.1\t${domain}\n127.0.0.1\twww.${domain}`;
      
      // Try to append (may fail without admin rights)
      if (process.platform === 'win32') {
        // On Windows, we need to use PowerShell with admin rights
        const { exec } = require('child_process');
        const command = `powershell -Command "Start-Process powershell -ArgumentList '-Command', 'Add-Content -Path ''${hostsPath}'' -Value ''${entry.replace(/\n/g, '`n')}''' -Verb RunAs"`;
        
        return new Promise((resolve, reject) => {
          exec(command, (error) => {
            if (error) {
              console.warn(`Could not update hosts file automatically. Please add manually:\n127.0.0.1\t${domain}`);
              resolve(); // Don't reject, just warn
            } else {
              console.log(`Added ${domain} to hosts file`);
              resolve();
            }
          });
        });
      } else {
        // On macOS/Linux
        const command = `echo '${entry}' | sudo tee -a ${hostsPath}`;
        return new Promise((resolve, reject) => {
          exec(command, (error) => {
            if (error) {
              console.warn(`Could not update hosts file automatically. Please add manually:\n127.0.0.1\t${domain}`);
              resolve();
            } else {
              console.log(`Added ${domain} to hosts file`);
              resolve();
            }
          });
        });
      }
    } catch (error) {
      console.warn(`Could not read hosts file: ${error.message}`);
      console.warn(`Please add manually: 127.0.0.1\t${domain}`);
    }
  }

  // Remove domain from hosts file
  async removeFromHostsFile(domain) {
    const hostsPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    try {
      let hostsContent = await fs.readFile(hostsPath, 'utf-8');
      
      // Remove lines containing the domain
      const lines = hostsContent.split('\n').filter(line => {
        const trimmed = line.trim();
        return !trimmed.includes(domain);
      });
      
      const newContent = lines.join('\n');
      
      if (newContent !== hostsContent) {
        if (process.platform === 'win32') {
          console.warn(`Please remove ${domain} from hosts file manually`);
        } else {
          console.warn(`Please remove ${domain} from hosts file manually`);
        }
      }
    } catch (error) {
      console.warn(`Could not update hosts file: ${error.message}`);
    }
  }

  // Remove virtual host when project is deleted
  async removeVirtualHost(project) {
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    
    // Remove nginx config
    const nginxConfig = path.join(dataPath, 'nginx', 'sites', `${project.id}.conf`);
    if (await fs.pathExists(nginxConfig)) {
      await fs.remove(nginxConfig);
    }

    // Remove apache config
    const apacheConfig = path.join(dataPath, 'apache', 'vhosts', `${project.id}.conf`);
    if (await fs.pathExists(apacheConfig)) {
      await fs.remove(apacheConfig);
    }

    // Try to remove from hosts file
    await this.removeFromHostsFile(project.domain);

    console.log(`Virtual host removed for ${project.domain}`);
  }

  // Switch web server for a project
  async switchWebServer(projectId, newWebServer) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    // Remove old vhost config
    await this.removeVirtualHost(project);

    // Update project
    project.webServer = newWebServer;
    await this.updateProject(projectId, { webServer: newWebServer });

    // Create new vhost config
    await this.createVirtualHost(project);

    return { success: true, webServer: newWebServer };
  }
}

module.exports = { ProjectManager };
