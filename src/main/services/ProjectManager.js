const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { spawn, exec } = require('child_process');
const http = require('http');
const httpProxy = require('http-proxy');
const os = require('os');
const net = require('net');
const { isPortAvailable, findAvailablePort } = require('../utils/PortUtils');
const CompatibilityManager = require('./CompatibilityManager');

// Helper function to spawn a process hidden on Windows
// On Windows, uses regular spawn with windowsHide
function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    const proc = spawn(command, args, {
      ...options,
      windowsHide: true,
    });
    
    return proc;
  } else {
    return spawn(command, args, {
      ...options,
      detached: true,
    });
  }
}

class ProjectManager {
  constructor(configStore, managers) {
    this.configStore = configStore;
    this.managers = managers;
    this.runningProjects = new Map();
    this.projectServers = new Map();
    this.proxy = httpProxy.createProxyServer({});
    this.compatibilityManager = new CompatibilityManager();
  }

  async initialize() {
    console.log('Initializing ProjectManager...');

    // Ensure projects array exists in config
    if (!this.configStore.get('projects')) {
      this.configStore.set('projects', []);
    }

    console.log('ProjectManager initialized');
  }

  /**
   * Ensure CLI is installed and added to PATH
   * This is called automatically when creating/importing projects
   */
  async ensureCliInstalled() {
    const cli = this.managers.cli;
    if (!cli) {
      console.warn('CLI manager not available');
      return;
    }

    try {
      const status = await cli.checkCliInstalled();
      
      // Install CLI script if not installed
      if (!status.installed) {
        console.log('Installing CLI scripts...');
        await cli.installCli();
      }

      // Add to PATH if not already in PATH (Windows only supports auto-add)
      if (!status.inPath && process.platform === 'win32') {
        console.log('Adding CLI to PATH...');
        try {
          await cli.addToPath();
          console.log('CLI added to PATH. Restart terminal to use.');
        } catch (error) {
          console.warn('Could not add CLI to PATH:', error.message);
        }
      }

      // Sync projects file for CLI
      await this.syncCliProjectsFile();
    } catch (error) {
      console.warn('Could not ensure CLI installed:', error.message);
    }
  }

  /**
   * Sync the projects.json file used by CLI scripts
   */
  async syncCliProjectsFile() {
    const cli = this.managers.cli;
    if (!cli) {
      return;
    }

    try {
      await cli.syncProjectsFile();
    } catch (error) {
      console.warn('Could not sync CLI projects file:', error.message);
    }
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

  async createProject(config, mainWindow = null) {
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
      webServerVersion: config.webServerVersion || '1.28', // Default version
      port,
      sslPort,
      domain: domainName,
      domains: [domainName],
      ssl: config.ssl !== false, // SSL enabled by default
      autoStart: config.autoStart || false,
      // Service configuration with version support
      services: {
        mysql: config.services?.mysql || false,
        mysqlVersion: config.services?.mysqlVersion || '8.4',
        mariadb: config.services?.mariadb || false,
        mariadbVersion: config.services?.mariadbVersion || '11.4',
        redis: config.services?.redis || false,
        redisVersion: config.services?.redisVersion || '7.4',
        queue: config.services?.queue || false,
        // Node.js for projects that need it
        nodejs: config.services?.nodejs || false,
        nodejsVersion: config.services?.nodejsVersion || '20',
      },
      environment: this.getDefaultEnvironment(projectType, config.name, port),
      supervisor: {
        workers: config.supervisor?.workers || 1,
        processes: [],
      },
      createdAt: new Date().toISOString(),
      lastStarted: null,
      // Compatibility warnings acknowledged by user
      compatibilityWarningsAcknowledged: config.compatibilityWarningsAcknowledged || false,
    };

    // Check service compatibility and store any warnings with the project
    const compatibilityConfig = {
      phpVersion: project.phpVersion,
      mysqlVersion: project.services.mysql ? project.services.mysqlVersion : null,
      mariadbVersion: project.services.mariadb ? project.services.mariadbVersion : null,
      redisVersion: project.services.redis ? project.services.redisVersion : null,
      nodejsVersion: project.services.nodejs ? project.services.nodejsVersion : null,
      projectType: project.type,
    };
    
    const compatibility = this.compatibilityManager.checkCompatibility(compatibilityConfig);
    project.compatibilityWarnings = compatibility.warnings || [];
    
    // If there are warnings and user hasn't acknowledged them, return warnings for UI to display
    if (compatibility.hasIssues && !config.compatibilityWarningsAcknowledged) {
      // Still create the project but include warnings for the UI to display
      console.log(`Compatibility warnings for project ${project.name}:`, compatibility.warnings);
    }

    // Create database for project if MySQL or MariaDB is enabled
    if (project.services.mysql || project.services.mariadb) {
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
        // Note: SSL certificates are signed by Root CA which is trusted during SslManager initialization
      } catch (error) {
        console.warn('Could not create SSL certificate:', error.message);
      }
    }

    // Create virtual host configuration (HTTP + HTTPS)
    // Skip if installing fresh - the document root doesn't exist yet
    if (!config.installFresh) {
      try {
        await this.createVirtualHost(project);
      } catch (error) {
        console.warn('Could not create virtual host:', error.message);
      }
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

    // Save project first (before installation which might take time)
    existingProjects.push(project);
    this.configStore.set('projects', existingProjects);

    // Auto-install CLI if not already installed
    await this.ensureCliInstalled();

    // Install fresh framework if requested - run async without blocking
    if (config.installFresh) {
      console.log('[createProject] installFresh is true, mainWindow:', mainWindow ? 'available' : 'not available');
      
      // Mark project as installing
      project.installing = true;
      
      // Run installation in background (don't await)
      this.runInstallation(project, mainWindow).catch(error => {
        console.error('Background installation failed:', error);
      });
    }

    console.log(`Project created: ${project.name} (${project.id})`);
    return project;
  }

  // Separate method for background installation
  async runInstallation(project, mainWindow) {
    const sendOutput = (text, type) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', {
          projectId: 'installation',
          text,
          type,
        });
      }
    };

    sendOutput(`Starting ${project.type} installation at ${project.path}...`, 'info');

    try {
      if (project.type === 'laravel') {
        console.log(`Installing fresh Laravel at ${project.path}...`);
        
        // Check if project directory already has files
        if (await fs.pathExists(project.path)) {
          const files = await fs.readdir(project.path);
          if (files.length > 0) {
            sendOutput(`Warning: Directory ${project.path} is not empty. Skipping Laravel installation.`, 'warning');
            sendOutput('If you want a fresh installation, please choose an empty directory.', 'info');
            project.installError = 'Directory not empty';
            project.installing = false;
            this.updateProjectInStore(project);
            sendOutput('', 'complete'); // Signal completion
            return;
          }
        }
        
        await this.installLaravel(project.path, project.phpVersion, project.name, mainWindow);
        
      } else if (project.type === 'wordpress') {
        console.log(`Installing fresh WordPress at ${project.path}...`);
        await this.installWordPress(project.path, mainWindow);
      }
      
      // Create virtual host now that the project files exist
      try {
        await this.createVirtualHost(project);
        sendOutput('✓ Virtual host configured', 'success');
      } catch (error) {
        sendOutput(`Warning: Could not create virtual host: ${error.message}`, 'warning');
      }
      
      // Run php artisan optimize for Laravel projects
      if (project.type === 'laravel') {
        try {
          sendOutput('Optimizing application...', 'info');
          sendOutput('$ php artisan optimize', 'command');
          
          const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
          const platform = process.platform === 'win32' ? 'win' : 'mac';
          const resourcePath = this.configStore.get('resourcePath') || path.join(require('electron').app.getPath('userData'), 'resources');
          const phpPath = path.join(resourcePath, 'php', project.phpVersion, platform, phpExe);
          
          if (await fs.pathExists(phpPath)) {
            await new Promise((resolve) => {
              const proc = spawn(phpPath, ['artisan', 'optimize'], { 
                cwd: project.path, 
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true 
              });
              proc.stdout.on('data', (data) => sendOutput(data.toString(), 'stdout'));
              proc.stderr.on('data', (data) => sendOutput(data.toString(), 'stderr'));
              proc.on('close', (code) => {
                if (code === 0) {
                  sendOutput('✓ Application optimized!', 'success');
                }
                resolve();
              });
              proc.on('error', () => resolve());
            });
          }
        } catch (e) {
          sendOutput(`Warning: Could not optimize application: ${e.message}`, 'warning');
        }
      }
      
      // Mark installation complete
      project.installing = false;
      this.updateProjectInStore(project);
      
      // Show thank you message
      sendOutput('', 'info');
      sendOutput('═══════════════════════════════════════════════════════════════', 'info');
      sendOutput('🎉 Thank you for using DevBox Pro!', 'success');
      sendOutput('', 'info');
      sendOutput(`Your project "${project.name}" is now available at:`, 'info');
      sendOutput(`   🌐 HTTP:  http://${project.domain}`, 'info');
      if (project.ssl) {
        sendOutput(`   🔒 HTTPS: https://${project.domain}`, 'info');
      }
      sendOutput('', 'info');
      sendOutput('Starting your project now...', 'info');
      sendOutput('═══════════════════════════════════════════════════════════════', 'info');
      
      // Auto-start the project
      try {
        await this.startProject(project.id);
        sendOutput('✓ Project started successfully!', 'success');
      } catch (startError) {
        sendOutput(`Warning: Could not auto-start project: ${startError.message}`, 'warning');
      }
      
      // Signal completion with redirect info
      sendOutput('', 'complete');
      
      // Send redirect signal to frontend
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('installation:complete', {
          projectId: project.id,
          domain: project.domain,
          ssl: project.ssl,
        });
      }
      
    } catch (error) {
      console.error('Failed to install framework:', error);
      project.installError = error.message;
      project.installing = false;
      this.updateProjectInStore(project);
      
      sendOutput(`✗ Installation failed: ${error.message}`, 'error');
      sendOutput('', 'complete');
    }
  }

  // Helper to update project in config store
  updateProjectInStore(project) {
    const projects = this.configStore.get('projects', []);
    const idx = projects.findIndex(p => p.id === project.id);
    if (idx !== -1) {
      projects[idx] = project;
      this.configStore.set('projects', projects);
    }
  }

  async installLaravel(projectPath, phpVersion = '8.4', projectName = 'laravel', mainWindow = null) {
    const parentPath = path.dirname(projectPath);
    const folderName = path.basename(projectPath);
    
    console.log('[installLaravel] Starting installation:', { projectPath, phpVersion, projectName, hasMainWindow: !!mainWindow });
    
    // Ensure parent directory exists
    await fs.ensureDir(parentPath);
    
    // Run composer create-project
    const binary = this.managers.binaryDownload;
    if (!binary) {
      throw new Error('BinaryDownloadManager not available');
    }

    // Output callback to send to renderer
    const onOutput = (text, type) => {
      // Clean up the text
      const cleanText = text.toString().replace(/\r\n/g, '\n').trim();
      if (!cleanText) return;
      
      console.log(`[Laravel Install] [${type}] ${cleanText}`);
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('terminal:output', {
            projectId: 'installation',
            text: cleanText,
            type,
          });
          console.log('[Laravel Install] Sent to renderer');
        } catch (err) {
          console.error('[Laravel Install] Failed to send to renderer:', err);
        }
      } else {
        console.warn('[Laravel Install] mainWindow not available');
      }
    };

    onOutput('Creating Laravel project...', 'info');
    onOutput(`$ composer create-project laravel/laravel ${folderName} --prefer-dist`, 'command');

    try {
      // Use composer to create Laravel project
      console.log('[installLaravel] Running composer create-project...');
      await binary.runComposer(
        parentPath,
        `create-project laravel/laravel ${folderName} --prefer-dist --no-interaction`,
        phpVersion,
        onOutput
      );
      console.log('[installLaravel] Composer create-project completed');

      onOutput('✓ Laravel files installed successfully!', 'success');
    } catch (error) {
      console.error('[installLaravel] Composer error:', error);
      onOutput(`✗ Composer error: ${error.message}`, 'error');
      throw error;
    }

    // Copy .env.example to .env if it exists
    try {
      const envExamplePath = path.join(projectPath, '.env.example');
      const envPath = path.join(projectPath, '.env');
      
      if (await fs.pathExists(envExamplePath) && !await fs.pathExists(envPath)) {
        onOutput('Creating .env file...', 'info');
        await fs.copy(envExamplePath, envPath);
        onOutput('✓ .env file created from .env.example', 'success');
      }
    } catch (e) {
      onOutput(`Warning: Could not create .env file: ${e.message}`, 'warning');
    }

    // Update .env with project-specific settings
    try {
      const envPath = path.join(projectPath, '.env');
      if (await fs.pathExists(envPath)) {
        let envContent = await fs.readFile(envPath, 'utf-8');
        
        // Update APP_NAME
        envContent = envContent.replace(/^APP_NAME=.*/m, `APP_NAME="${projectName}"`);
        
        // Update APP_URL
        const projectDomain = `${projectName.toLowerCase().replace(/[^a-z0-9]/g, '-')}.test`;
        envContent = envContent.replace(/^APP_URL=.*/m, `APP_URL=http://${projectDomain}`);
        
        // Update DB settings if project has MySQL enabled
        const project = this.configStore.get('projects', []).find(p => p.path === projectPath);
        if (project) {
          const dbName = this.sanitizeDatabaseName(projectName);
          // Get database credentials from settings
          const dbInfo = this.managers.database?.getDatabaseInfo() || {};
          const dbUser = dbInfo.user || 'root';
          const dbPassword = dbInfo.password || '';
          const dbPort = dbInfo.port || 3306;
          
          envContent = envContent.replace(/^DB_DATABASE=.*/m, `DB_DATABASE=${dbName}`);
          envContent = envContent.replace(/^DB_USERNAME=.*/m, `DB_USERNAME=${dbUser}`);
          envContent = envContent.replace(/^DB_PASSWORD=.*/m, `DB_PASSWORD=${dbPassword}`);
          envContent = envContent.replace(/^DB_PORT=.*/m, `DB_PORT=${dbPort}`);
        }
        
        await fs.writeFile(envPath, envContent);
        onOutput('✓ .env file configured', 'success');
      }
    } catch (e) {
      onOutput(`Warning: Could not update .env file: ${e.message}`, 'warning');
    }
    
    // Generate application key
    try {
      onOutput('Generating application key...', 'info');
      onOutput('$ php artisan key:generate', 'command');
      
      const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
      const platform = process.platform === 'win32' ? 'win' : 'mac';
      const resourcePath = this.configStore.get('resourcePath') || require('path').join(require('electron').app.getPath('userData'), 'resources');
      const phpPath = path.join(resourcePath, 'php', phpVersion, platform, phpExe);
      
      if (await fs.pathExists(phpPath)) {
        await new Promise((resolve, reject) => {
          const proc = spawn(phpPath, ['artisan', 'key:generate'], { 
            cwd: projectPath, 
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true 
          });
          proc.stdout.on('data', (data) => onOutput(data.toString(), 'stdout'));
          proc.stderr.on('data', (data) => onOutput(data.toString(), 'stderr'));
          proc.on('close', (code) => {
            if (code === 0) {
              onOutput('✓ Application key generated!', 'success');
              resolve();
            } else {
              onOutput(`Warning: key:generate exited with code ${code}`, 'warning');
              resolve(); // Don't fail
            }
          });
          proc.on('error', (err) => {
            onOutput(`Warning: ${err.message}`, 'warning');
            resolve();
          });
        });
      }
    } catch (e) {
      onOutput(`Warning: Could not generate app key: ${e.message}`, 'warning');
    }

    // Run npm install if package.json exists (like Laragon does)
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      if (await fs.pathExists(packageJsonPath)) {
        onOutput('Installing npm packages...', 'info');
        onOutput('$ npm install', 'command');
        
        // Try to use downloaded Node.js, fall back to system npm
        const nodeVersion = '22'; // Use LTS version
        const platform = process.platform === 'win32' ? 'win' : 'mac';
        const resourcePath = this.configStore.get('resourcePath') || require('path').join(require('electron').app.getPath('userData'), 'resources');
        const nodeDir = path.join(resourcePath, 'nodejs', nodeVersion, platform);
        
        let npmCmd = 'npm';
        
        // Check if we have local Node.js
        if (await fs.pathExists(nodeDir)) {
          if (process.platform === 'win32') {
            npmCmd = path.join(nodeDir, 'npm.cmd');
          } else {
            npmCmd = path.join(nodeDir, 'bin', 'npm');
          }
        }
        
        await new Promise((resolve) => {
          const npmProc = spawn(npmCmd, ['install'], {
            cwd: projectPath,
            shell: true,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            env: {
              ...process.env,
              PATH: process.platform === 'win32' 
                ? `${nodeDir};${process.env.PATH}`
                : `${path.join(nodeDir, 'bin')}:${process.env.PATH}`,
            },
          });
          
          npmProc.stdout.on('data', (data) => onOutput(data.toString(), 'stdout'));
          npmProc.stderr.on('data', (data) => onOutput(data.toString(), 'stderr'));
          npmProc.on('close', (code) => {
            if (code === 0) {
              onOutput('✓ npm packages installed successfully!', 'success');
            } else {
              onOutput(`npm install finished with code ${code} (non-critical)`, 'warning');
            }
            resolve();
          });
          npmProc.on('error', (err) => {
            onOutput(`npm not available: ${err.message} (non-critical)`, 'warning');
            resolve();
          });
        });
      }
    } catch (e) {
      onOutput(`npm install skipped: ${e.message}`, 'warning');
    }

    onOutput('', 'info');
    onOutput('🎉 Laravel project created successfully!', 'success');
    onOutput(`Project location: ${projectPath}`, 'info');
    
    return { success: true };
  }

  async installWordPress(projectPath) {
    // Ensure directory exists
    await fs.ensureDir(projectPath);
    
    // Download WordPress
    const wpUrl = 'https://wordpress.org/latest.zip';
    const downloadPath = path.join(projectPath, 'wordpress.zip');
    
    // TODO: Implement WordPress download and extraction
    console.log('WordPress installation not yet implemented');
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

    // Sync CLI projects file
    await this.syncCliProjectsFile();

    // Restart if was running
    if (isRunning) {
      await this.startProject(id);
    }

    return projects[index];
  }

  async deleteProject(id, deleteFiles = false) {
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

    // Remove domain from hosts file
    try {
      await this.removeFromHostsFile(project.domain);
    } catch (error) {
      console.warn('Error removing from hosts file:', error.message);
    }

    // Delete project files if requested
    if (deleteFiles && project.path) {
      try {
        console.log(`Deleting project files at: ${project.path}`);
        await fs.remove(project.path);
        console.log(`Project files deleted: ${project.path}`);
      } catch (error) {
        console.error('Error deleting project files:', error.message);
        throw new Error(`Failed to delete project files: ${error.message}`);
      }
    }

    // Remove project from config
    const projects = this.configStore.get('projects', []);
    const filtered = projects.filter((p) => p.id !== id);
    this.configStore.set('projects', filtered);

    // Sync CLI projects file
    await this.syncCliProjectsFile();

    console.log(`Project deleted: ${project.name} (${id})${deleteFiles ? ' - files also deleted' : ''}`);
    return { success: true, filesDeleted: deleteFiles };
  }

  async startProject(id) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    if (this.runningProjects.has(id)) {
      console.log(`Project ${project.name} is already running`);
      this.managers.log?.project(id, `Project ${project.name} is already running`);
      return { success: true, alreadyRunning: true };
    }

    console.log(`Starting project: ${project.name}`);
    this.managers.log?.project(id, `Starting project: ${project.name}`);
    this.managers.log?.project(id, `Type: ${project.type}, PHP: ${project.phpVersion}, Web Server: ${project.webServer}`);
    this.managers.log?.project(id, `Domain: ${project.domain}, Path: ${project.path}`);

    try {
      // Validate required binaries before starting
      const missingBinaries = await this.validateProjectBinaries(project);
      if (missingBinaries.length > 0) {
        const errorMsg = `Missing required binaries: ${missingBinaries.join(', ')}. Please install them from the Binary Manager.`;
        this.managers.log?.project(id, `ERROR: ${errorMsg}`);
        throw new Error(errorMsg);
      }

      // Start required services first
      const serviceResult = await this.startProjectServices(project);
      
      // Check if critical services failed
      if (!serviceResult.success) {
        const errorMsg = serviceResult.errors.length > 0 
          ? serviceResult.errors.join('; ') 
          : `Critical services failed to start: ${serviceResult.criticalFailures.join(', ')}`;
        throw new Error(errorMsg);
      }

      // Calculate PHP-CGI port (unique per project)
      const phpFpmPort = 9000 + (parseInt(project.id.slice(-4), 16) % 1000);

      let phpCgiProcess = null;
      let actualPhpFpmPort = phpFpmPort;
      
      // Only start PHP-CGI process for Nginx (uses FastCGI)
      // Apache uses Action/AddHandler CGI approach - invokes PHP-CGI directly per request
      const webServer = project.webServer || 'nginx';
      if (webServer === 'nginx') {
        const phpCgiResult = await this.startPhpCgi(project, phpFpmPort);
        phpCgiProcess = phpCgiResult.process;
        actualPhpFpmPort = phpCgiResult.port;
      }
      
      // Regenerate virtual host config to ensure correct port
      // Pass the actual PHP-CGI port in case it differs from the calculated one
      await this.createVirtualHost(project, actualPhpFpmPort);

      this.runningProjects.set(id, {
        phpCgiProcess: phpCgiProcess,
        phpFpmPort: actualPhpFpmPort,
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

      console.log(`Project ${project.name} started with PHP-CGI on port ${actualPhpFpmPort}`);
      this.managers.log?.project(id, `Project ${project.name} started successfully`);
      this.managers.log?.project(id, `PHP-CGI running on port ${actualPhpFpmPort}`);
      return { success: true, port: project.port, phpFpmPort: actualPhpFpmPort };
    } catch (error) {
      console.error(`Failed to start project ${project.name}:`, error);
      this.managers.log?.project(id, `Failed to start project: ${error.message}`, 'error');
      throw error;
    }
  }

  /**
   * Validate that all required binaries for a project are installed
   */
  async validateProjectBinaries(project) {
    const missing = [];
    const { app } = require('electron');
    const resourcePath = this.configStore.get('resourcePath') || path.join(app.getPath('userData'), 'resources');
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    
    // Check PHP version
    const phpVersion = project.phpVersion || '8.3';
    const phpVersions = this.managers.php?.phpVersions || {};
    if (!phpVersions[phpVersion]?.available) {
      missing.push(`PHP ${phpVersion}`);
    }
    
    // Check web server
    const webServer = project.webServer || 'nginx';
    const webServerVersion = project.webServerVersion || (webServer === 'nginx' ? '1.28' : '2.4');
    const webServerPath = path.join(resourcePath, webServer, webServerVersion, platform);
    if (!await fs.pathExists(webServerPath)) {
      missing.push(`${webServer === 'nginx' ? 'Nginx' : 'Apache'} ${webServerVersion}`);
    }
    
    // Check MySQL if enabled
    if (project.services?.mysql) {
      const mysqlVersion = project.services.mysqlVersion || '8.4';
      const mysqlPath = path.join(resourcePath, 'mysql', mysqlVersion, platform);
      if (!await fs.pathExists(mysqlPath)) {
        missing.push(`MySQL ${mysqlVersion}`);
      }
    }
    
    // Check MariaDB if enabled
    if (project.services?.mariadb) {
      const mariadbVersion = project.services.mariadbVersion || '11.4';
      const mariadbPath = path.join(resourcePath, 'mariadb', mariadbVersion, platform);
      if (!await fs.pathExists(mariadbPath)) {
        missing.push(`MariaDB ${mariadbVersion}`);
      }
    }
    
    // Check Redis if enabled
    if (project.services?.redis) {
      const redisVersion = project.services.redisVersion || '7.4';
      const redisPath = path.join(resourcePath, 'redis', redisVersion, platform);
      if (!await fs.pathExists(redisPath)) {
        missing.push(`Redis ${redisVersion}`);
      }
    }
    
    return missing;
  }

  // Start PHP-CGI process for FastCGI
  async startPhpCgi(project, port) {
    const phpVersion = project.phpVersion || '8.3';
    
    // Check if PHP version is available
    const phpVersions = this.managers.php?.phpVersions || {};
    if (!phpVersions[phpVersion]?.available) {
      throw new Error(`PHP ${phpVersion} is not installed. Please install it from the Binary Manager.`);
    }
    
    const phpPath = this.managers.php.getPhpBinaryPath(phpVersion);
    const phpDir = path.dirname(phpPath);
    const phpCgiPath = path.join(phpDir, process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi');
    
    // Check if php-cgi exists
    if (!await fs.pathExists(phpCgiPath)) {
      throw new Error(`PHP-CGI not found for PHP ${phpVersion}. The PHP installation may be incomplete. Please reinstall PHP ${phpVersion} from the Binary Manager.`);
    }

    // Check if port is available, find alternative if not
    let actualPort = port;
    if (!await isPortAvailable(port)) {
      console.log(`PHP-CGI port ${port} is in use, finding alternative...`);
      actualPort = await findAvailablePort(port, 100);
      if (!actualPort) {
        throw new Error(`Could not find available port for PHP-CGI (starting from ${port})`);
      }
      console.log(`PHP-CGI will use port ${actualPort} instead`);
    }

    console.log(`Starting PHP-CGI ${phpVersion} on port ${actualPort}...`);

    let phpCgiProcess;
    if (process.platform === 'win32') {
      // On Windows, use spawnHidden to run without a console window
      phpCgiProcess = spawnHidden(phpCgiPath, ['-b', `127.0.0.1:${actualPort}`], {
        cwd: project.path,
        env: {
          ...process.env,
          ...project.environment,
          PHP_FCGI_MAX_REQUESTS: '0',
          PHP_FCGI_CHILDREN: '4',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      
      phpCgiProcess.stdout?.on('data', (data) => {
        this.managers.log?.project(project.id, `[php-cgi] ${data.toString()}`);
      });

      phpCgiProcess.stderr?.on('data', (data) => {
        this.managers.log?.project(project.id, `[php-cgi] ${data.toString()}`);
      });

      phpCgiProcess.on('error', (error) => {
        console.error(`PHP-CGI error for ${project.name}:`, error);
      });

      phpCgiProcess.on('exit', (code) => {
        console.log(`PHP-CGI for ${project.name} exited with code ${code}`);
      });
    } else {
      phpCgiProcess = spawn(phpCgiPath, ['-b', `127.0.0.1:${actualPort}`], {
        cwd: project.path,
        env: {
          ...process.env,
          ...project.environment,
          PHP_FCGI_MAX_REQUESTS: '0',
          PHP_FCGI_CHILDREN: '4',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      phpCgiProcess.stdout.on('data', (data) => {
        this.managers.log?.project(project.id, `[php-cgi] ${data.toString()}`);
      });

      phpCgiProcess.stderr.on('data', (data) => {
        this.managers.log?.project(project.id, `[php-cgi] ${data.toString()}`);
      });

      phpCgiProcess.on('error', (error) => {
        console.error(`PHP-CGI error for ${project.name}:`, error);
      });

      phpCgiProcess.on('exit', (code) => {
        console.log(`PHP-CGI for ${project.name} exited with code ${code}`);
      });
    }

    // Wait for PHP-CGI to be ready (check if port is listening)
    const maxWait = 5000;
    const startTime = Date.now();
    let isListening = false;
    
    while (Date.now() - startTime < maxWait && !isListening) {
      isListening = !await isPortAvailable(actualPort);
      if (!isListening) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    if (!isListening) {
      console.warn(`PHP-CGI may not have started properly on port ${actualPort}`);
    }

    console.log(`PHP-CGI started for ${project.name} on port ${actualPort}`);
    return { process: phpCgiProcess, port: actualPort };
  }

  async stopProject(id) {
    const running = this.runningProjects.get(id);
    if (!running) {
      return { success: true, wasRunning: false };
    }

    const project = this.getProject(id);
    console.log(`Stopping project: ${project?.name || id}`);
    this.managers.log?.project(id, `Stopping project: ${project?.name || id}`);

    try {
      const kill = require('tree-kill');

      // Stop PHP-CGI process
      if (running.phpCgiProcess && running.phpCgiProcess.pid) {
        await new Promise((resolve) => {
          kill(running.phpCgiProcess.pid, 'SIGTERM', (err) => {
            if (err) console.error('Error killing PHP-CGI process:', err);
            resolve();
          });
        });
        console.log(`PHP-CGI stopped for ${project?.name || id}`);
      }

      // Stop supervisor processes
      if (project?.supervisor.processes.length > 0) {
        await this.managers.supervisor?.stopAllProcesses(id);
      }

      this.runningProjects.delete(id);
      console.log(`Project ${project?.name || id} stopped`);
      this.managers.log?.project(id, `Project ${project?.name || id} stopped successfully`);

      return { success: true, wasRunning: true };
    } catch (error) {
      console.error(`Error stopping project:`, error);
      throw error;
    }
  }

  /**
   * Stop all running projects
   * @returns {Object} Result with success status and count of stopped projects
   */
  async stopAllProjects() {
    const runningProjectIds = Array.from(this.runningProjects.keys());
    
    if (runningProjectIds.length === 0) {
      console.log('No running projects to stop');
      // Still do cleanup in case of orphan processes
      if (process.platform === 'win32') {
        await this.forceKillOrphanPhpProcesses();
      }
      return { success: true, stoppedCount: 0 };
    }

    console.log(`Stopping ${runningProjectIds.length} running project(s)...`);
    
    const results = [];
    for (const id of runningProjectIds) {
      try {
        await this.stopProject(id);
        results.push({ id, success: true });
      } catch (error) {
        console.error(`Error stopping project ${id}:`, error);
        results.push({ id, success: false, error: error.message });
      }
    }

    // Force kill any orphan PHP-CGI processes on Windows
    if (process.platform === 'win32') {
      await this.forceKillOrphanPhpProcesses();
    }

    const stoppedCount = results.filter(r => r.success).length;
    console.log(`Stopped ${stoppedCount}/${runningProjectIds.length} projects`);
    
    return { 
      success: results.every(r => r.success), 
      stoppedCount,
      results 
    };
  }

  /**
   * Force kill any orphan PHP-CGI processes on Windows
   */
  async forceKillOrphanPhpProcesses() {
    const { execSync } = require('child_process');
    try {
      execSync('taskkill /F /IM php-cgi.exe 2>nul', { 
        windowsHide: true, 
        timeout: 5000,
        stdio: 'ignore'
      });
      console.log('Killed orphan php-cgi.exe processes');
    } catch (e) {
      // Ignore - no processes to kill
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

  /**
   * Start all services required by a project
   * @returns {Object} Result with success status, failed services, and error messages
   */
  async startProjectServices(project) {
    const serviceManager = this.managers.service;
    if (!serviceManager) {
      console.warn('ServiceManager not available, skipping service auto-start');
      return { success: true, warning: 'ServiceManager not available' };
    }

    console.log(`Starting services for project ${project.name}...`);

    // Web server is critical - project cannot run without it
    const webServer = project.webServer || 'nginx';
    const webServerVersion = project.webServerVersion || (webServer === 'nginx' ? '1.28' : '2.4');
    
    const servicesToStart = [];

    // Only start the web server the project needs (with version)
    if (webServer === 'nginx') {
      servicesToStart.push({ name: 'nginx', version: webServerVersion, critical: true });
    } else if (webServer === 'apache') {
      servicesToStart.push({ name: 'apache', version: webServerVersion, critical: true });
    }

    // Database (mysql or mariadb) with versions
    if (project.services?.mysql) {
      const mysqlVersion = project.services.mysqlVersion || '8.4';
      servicesToStart.push({ name: 'mysql', version: mysqlVersion, critical: false });
    }
    if (project.services?.mariadb) {
      const mariadbVersion = project.services.mariadbVersion || '11.4';
      servicesToStart.push({ name: 'mariadb', version: mariadbVersion, critical: false });
    }

    // Redis with version
    if (project.services?.redis) {
      const redisVersion = project.services.redisVersion || '7.4';
      servicesToStart.push({ name: 'redis', version: redisVersion, critical: false });
    }

    // Always start mailpit for email testing
    servicesToStart.push({ name: 'mailpit', critical: false });

    // phpMyAdmin if database is used
    if (project.services?.mysql || project.services?.mariadb) {
      servicesToStart.push({ name: 'phpmyadmin', critical: false });
    }

    const results = {
      success: true,
      started: [],
      failed: [],
      criticalFailures: [],
      errors: [],
    };

    // Start each service
    for (const service of servicesToStart) {
      try {
        const status = serviceManager.serviceStatus.get(service.name);
        
        // For versioned services, check if the correct version is running
        const isVersioned = serviceManager.serviceConfigs[service.name]?.versioned;
        const requestedVersion = service.version;
        const runningVersion = status?.version;
        
        // Check if we need to start (or start a different version)
        const needsStart = !status || status.status !== 'running';
        const needsDifferentVersion = isVersioned && requestedVersion && runningVersion && runningVersion !== requestedVersion;
        
        // For web servers, check if we should restart to claim standard ports
        if ((service.name === 'nginx' || service.name === 'apache') && 
            status && status.status === 'running' && !needsDifferentVersion) {
          // Check if this web server is on alternate ports but could use standard ports
          const ports = serviceManager.getServicePorts(service.name);
          const isOnAlternatePorts = ports?.httpPort === 8081;
          const standardPortsAvailable = serviceManager.standardPortOwner === null;
          
          if (isOnAlternatePorts && standardPortsAvailable) {
            console.log(`Restarting ${service.name} to claim standard ports (80/443)...`);
            await serviceManager.restartService(service.name, requestedVersion);
            results.started.push(service.name);
            continue;
          }
        }
        
        // If a different version is needed, we can run both simultaneously
        // Check if the requested version is already running
        if (isVersioned && requestedVersion) {
          const versionRunning = serviceManager.isVersionRunning(service.name, requestedVersion);
          if (versionRunning) {
            console.log(`${service.name} ${requestedVersion} already running`);
            results.started.push(`${service.name}:${requestedVersion}`);
            continue;
          }
        }
        
        if (needsStart || (isVersioned && !serviceManager.isVersionRunning(service.name, requestedVersion))) {
          console.log(`Auto-starting ${service.name}${requestedVersion ? ' ' + requestedVersion : ''}...`);
          const result = await serviceManager.startService(service.name, requestedVersion);
          
          // Check if service actually started (could be not_installed)
          if (result.status === 'not_installed') {
            const versionStr = requestedVersion ? ` ${requestedVersion}` : '';
            const errorMsg = `${service.name}${versionStr} is not installed. Please download it from Binary Manager.`;
            results.failed.push(service.name);
            results.errors.push(errorMsg);
            if (service.critical) {
              results.criticalFailures.push(service.name);
              results.success = false;
            }
          } else if (result.success) {
            results.started.push(`${service.name}${requestedVersion ? ':' + requestedVersion : ''}`);
          }
        } else if (status && status.status === 'running') {
          results.started.push(`${service.name}${runningVersion ? ':' + runningVersion : ''}`);
        }
      } catch (error) {
        const versionStr = service.version ? ` ${service.version}` : '';
        const errorMsg = `Failed to start ${service.name}${versionStr}: ${error.message}`;
        console.warn(errorMsg);
        results.failed.push(service.name);
        results.errors.push(errorMsg);
        
        if (service.critical) {
          results.criticalFailures.push(service.name);
          results.success = false;
        }
      }
    }

    if (results.success) {
      console.log(`Services started for project ${project.name}`);
      this.managers.log?.project(project.id, `Services ready: ${results.started.join(', ')}`);
    } else {
      console.error(`Critical services failed for project ${project.name}:`, results.criticalFailures);
      this.managers.log?.project(project.id, `Service failures: ${results.errors.join('; ')}`, 'error');
    }

    return results;
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
      case 'laravel': {
        // Get database credentials from settings
        const dbInfo = this.managers?.database?.getDatabaseInfo() || {};
        const dbUser = dbInfo.user || 'root';
        const dbPassword = dbInfo.password || '';
        const dbPort = dbInfo.port || 3306;
        
        return {
          ...baseEnv,
          APP_NAME: projectName,
          APP_KEY: '',
          APP_URL: `http://localhost:${port}`,
          DB_CONNECTION: 'mysql',
          DB_HOST: '127.0.0.1',
          DB_PORT: String(dbPort),
          DB_DATABASE: this.sanitizeDatabaseName(projectName),
          DB_USERNAME: dbUser,
          DB_PASSWORD: dbPassword,
          CACHE_DRIVER: 'redis',
          QUEUE_CONNECTION: 'redis',
          SESSION_DRIVER: 'redis',
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: '6379',
          MAIL_MAILER: 'smtp',
          MAIL_HOST: '127.0.0.1',
          MAIL_PORT: '1025',
        };
      }

      case 'symfony': {
        // Get database credentials from settings
        const dbInfo = this.managers?.database?.getDatabaseInfo() || {};
        const dbUser = dbInfo.user || 'root';
        const dbPassword = dbInfo.password || '';
        const dbPort = dbInfo.port || 3306;
        const dbName = this.sanitizeDatabaseName(projectName);
        
        return {
          ...baseEnv,
          DATABASE_URL: `mysql://${dbUser}:${dbPassword}@127.0.0.1:${dbPort}/${dbName}`,
          MAILER_DSN: 'smtp://127.0.0.1:1025',
        };
      }

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
    // Add all project domains to hosts file
    const domainsToAdd = [];
    
    // Add main domain
    if (project.domain) {
      domainsToAdd.push(project.domain);
    }
    
    // Add any additional domains
    if (project.domains && Array.isArray(project.domains)) {
      for (const domain of project.domains) {
        if (domain && !domainsToAdd.includes(domain)) {
          domainsToAdd.push(domain);
        }
      }
    }
    
    // Add each domain to hosts file
    for (const domain of domainsToAdd) {
      try {
        const result = await this.addToHostsFile(domain);
        if (result?.success) {
          console.log(`Hosts file updated for ${domain}`);
        }
      } catch (error) {
        console.warn(`Could not add ${domain} to hosts file:`, error.message);
      }
    }
  }

  // Create virtual host configuration for the project
  async createVirtualHost(project, phpFpmPort = null) {
    const webServer = project.webServer || this.configStore.get('settings.webServer', 'nginx');
    
    if (webServer === 'nginx') {
      await this.createNginxVhost(project, phpFpmPort);
      // Reload nginx to pick up config changes
      try {
        await this.managers.service?.reloadNginx();
      } catch (error) {
        console.warn('Could not reload nginx:', error.message);
      }
    } else {
      await this.createApacheVhost(project);
      // Reload Apache to pick up config changes
      try {
        await this.managers.service?.reloadApache();
      } catch (error) {
        console.warn('Could not reload Apache:', error.message);
      }
    }

    console.log(`Virtual host created for ${project.domain} using ${webServer}`);
  }

  // Create Nginx virtual host
  async createNginxVhost(project, overridePhpFpmPort = null) {
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const resourcesPath = path.join(app.getPath('userData'), 'resources');
    const sitesDir = path.join(dataPath, 'nginx', 'sites');
    const sslDir = path.join(dataPath, 'ssl', project.domain);
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const fastcgiParamsPath = path.join(resourcesPath, 'nginx', platform, 'conf', 'fastcgi_params').replace(/\\/g, '/');

    await fs.ensureDir(sitesDir);

    const documentRoot = this.getDocumentRoot(project);
    
    // Ensure document root exists
    await fs.ensureDir(documentRoot);
    
    // Use override port if provided, otherwise calculate default
    const phpFpmPort = overridePhpFpmPort || (9000 + (parseInt(project.id.slice(-4), 16) % 1000));
    
    // Get dynamic ports from ServiceManager
    const serviceManager = this.managers.service;
    const nginxPorts = serviceManager?.getServicePorts('nginx');
    const httpPort = nginxPorts?.httpPort || 80;
    const httpsPort = nginxPorts?.sslPort || 443;

    console.log(`Creating Nginx vhost for ${project.domain} with PHP-CGI on port ${phpFpmPort}`);

    // Generate nginx config with both HTTP and HTTPS
    // PHP-CGI runs on phpFpmPort for FastCGI
    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
# Ports: HTTP=${httpPort}, HTTPS=${httpsPort}

# HTTP Server
server {
    listen ${httpPort};
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
        include ${fastcgiParamsPath};
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

    // Add HTTPS server block if SSL is enabled AND certificates exist
    let certPath = path.join(sslDir, 'cert.pem');
    let keyPath = path.join(sslDir, 'key.pem');
    let certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);
    
    // Auto-create SSL certificates if SSL is enabled but certs don't exist
    if (project.ssl && !certsExist) {
      console.log(`SSL enabled for ${project.domain} but certificates not found. Creating certificates...`);
      try {
        await this.managers.ssl?.createCertificate(project.domains);
        // Re-check if certificates were created successfully
        certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);
        if (certsExist) {
          console.log(`SSL certificates created successfully for ${project.domain}`);
        }
      } catch (error) {
        console.warn(`Failed to create SSL certificates for ${project.domain}:`, error.message);
      }
    }
    
    if (project.ssl && !certsExist) {
      console.warn(`SSL enabled for ${project.domain} but certificates not found at ${sslDir}. Skipping SSL block.`);
    }
    
    if (project.ssl && certsExist) {
      config += `
# HTTPS Server (SSL)
server {
    listen ${httpsPort} ssl;
    http2 on;
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
        include ${fastcgiParamsPath};
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
    
    // Ensure document root exists
    await fs.ensureDir(documentRoot);
    
    const idSlice = project.id.slice(-4);
    const parsedInt = parseInt(idSlice, 16);
    const modResult = parsedInt % 1000;
    let phpFpmPort = 9000 + modResult;
    
    // Ensure port is a valid number and convert to string explicitly
    if (isNaN(phpFpmPort) || phpFpmPort < 9000 || phpFpmPort > 9999) {
      console.error(`[Apache Vhost] Invalid PHP-CGI port calculated: ${phpFpmPort}. Using default 9000.`);
      phpFpmPort = 9000;
    }
    
    // Convert to string and validate - ensure no extra characters
    const phpFpmPortStr = String(phpFpmPort).trim();
    console.log(`[Apache Vhost] Project: ${project.name}, ID: ${project.id}`);
    console.log(`[Apache Vhost] Port calculation: slice="${idSlice}", parseInt=${parsedInt}, mod=${modResult}`);
    console.log(`[Apache Vhost] PHP-CGI port: ${phpFpmPortStr} (type: ${typeof phpFpmPortStr}, length: ${phpFpmPortStr.length})`);
    
    // Get dynamic ports from ServiceManager
    const serviceManager = this.managers.service;
    const apachePorts = serviceManager?.getServicePorts('apache');
    const httpPort = apachePorts?.httpPort || 80;
    const httpsPort = apachePorts?.sslPort || 443;

    // Get PHP-CGI path for this PHP version
    const phpVersion = project.phpVersion || '8.4';
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const resourcesPath = path.join(app.getPath('userData'), 'resources');
    const phpCgiPath = path.join(resourcesPath, 'php', phpVersion, platform, 'php-cgi.exe').replace(/\\/g, '/');

    // Generate Apache config with both HTTP and HTTPS
    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
# Apache running on ports ${httpPort}/${httpsPort}
# PHP Version: ${phpVersion}

# HTTP Virtual Host
<VirtualHost *:${httpPort}>
    ServerName ${project.domain}
    ServerAlias www.${project.domain}
    DocumentRoot "${documentRoot}"
    
    <Directory "${documentRoot}">
        Options Indexes FollowSymLinks MultiViews ExecCGI
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

    # PHP Configuration using Action/AddHandler (like Laragon)
    ScriptAlias /php-cgi/ "${path.dirname(phpCgiPath).replace(/\\/g, '/')}/"
    <Directory "${path.dirname(phpCgiPath).replace(/\\/g, '/')}">
        AllowOverride None
        Options None
        Require all granted
    </Directory>
    
    Action application/x-httpd-php "/php-cgi/php-cgi.exe"
    AddHandler application/x-httpd-php .php

    DirectoryIndex index.php index.html

    ErrorLog "${dataPath}/apache/logs/${project.id}-error.log"
    CustomLog "${dataPath}/apache/logs/${project.id}-access.log" combined
</VirtualHost>
`;

    // Check if SSL certificates exist for HTTPS
    let certPath = path.join(sslDir, 'cert.pem');
    let keyPath = path.join(sslDir, 'key.pem');
    let certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);

    // Auto-create SSL certificates if SSL is enabled but certs don't exist
    if (project.ssl && !certsExist) {
      console.log(`SSL enabled for ${project.domain} but certificates not found. Creating certificates...`);
      try {
        await this.managers.ssl?.createCertificate(project.domains);
        // Re-check if certificates were created successfully
        certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);
        if (certsExist) {
          console.log(`SSL certificates created successfully for ${project.domain}`);
        }
      } catch (error) {
        console.warn(`Failed to create SSL certificates for ${project.domain}:`, error.message);
      }
    }

    if (project.ssl && !certsExist) {
      console.warn(`SSL enabled for ${project.domain} but certificates not found at ${sslDir}. Skipping SSL block.`);
    }

    // Add HTTPS virtual host if SSL is enabled and certs exist
    if (project.ssl && certsExist) {
      config += `
# HTTPS Virtual Host (SSL)
<VirtualHost *:${httpsPort}>
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
        Options Indexes FollowSymLinks MultiViews ExecCGI
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

    # PHP Configuration using Action/AddHandler (like Laragon)
    ScriptAlias /php-cgi/ "${path.dirname(phpCgiPath).replace(/\\\\/g, '/')}/"
    <Directory "${path.dirname(phpCgiPath).replace(/\\\\/g, '/')}">
        AllowOverride None
        Options None
        Require all granted
    </Directory>
    
    Action application/x-httpd-php "/php-cgi/php-cgi.exe"
    AddHandler application/x-httpd-php .php

    DirectoryIndex index.php index.html

    ErrorLog "${dataPath}/apache/logs/${project.id}-ssl-error.log"
    CustomLog "${dataPath}/apache/logs/${project.id}-ssl-access.log" combined
</VirtualHost>
`;
    }

    // Debug: Log the SetHandler line to verify correct port
    const setHandlerMatches = config.match(/SetHandler "proxy:fcgi:\/\/127\.0\.0\.1:(\d+)"/g);
    if (setHandlerMatches) {
      console.log(`[Apache Vhost] SetHandler directives in config:`);
      setHandlerMatches.forEach((match, idx) => {
        console.log(`  ${idx + 1}. ${match}`);
      });
    }
    
    // Save config file
    const configPath = path.join(vhostsDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);
    
    // Verify what was actually written to the file
    const writtenContent = await fs.readFile(configPath, 'utf-8');
    const writtenMatches = writtenContent.match(/SetHandler "proxy:fcgi:\/\/127\.0\.0\.1:(\d+)"/g);
    if (writtenMatches) {
      console.log(`[Apache Vhost] Verified SetHandler in written file:`);
      writtenMatches.forEach((match, idx) => {
        console.log(`  ${idx + 1}. ${match}`);
      });
    }

    // Ensure logs directory exists
    await fs.ensureDir(path.join(dataPath, 'apache', 'logs'));

    return configPath;
  }

  // Add domain to hosts file (requires admin privileges)
  async addToHostsFile(domain) {
    if (!domain) return;
    
    const hostsPath = process.platform === 'win32' 
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    try {
      const hostsContent = await fs.readFile(hostsPath, 'utf-8');
      
      // Check if domain already exists (check both with and without www)
      const domainRegex = new RegExp(`^\\s*127\\.0\\.0\\.1\\s+${domain.replace('.', '\\.')}\\s*$`, 'm');
      if (domainRegex.test(hostsContent)) {
        console.log(`Domain ${domain} already in hosts file`);
        return { success: true, alreadyExists: true };
      }

      // Entries to add
      const entries = [
        `127.0.0.1\t${domain}`,
        `127.0.0.1\twww.${domain}`
      ];
      
      // Try to append using sudo-prompt for proper elevation
      const sudo = require('sudo-prompt');
      const options = {
        name: 'DevBox Pro',
        icns: undefined // Can add icon path later
      };

      if (process.platform === 'win32') {
        // Create a batch script to add the entries
        const { app } = require('electron');
        const tempDir = app.getPath('temp');
        const scriptPath = path.join(tempDir, 'devbox-hosts-update.bat');
        
        // Build the batch commands to echo each entry
        const batchContent = entries.map(entry => 
          `echo ${entry}>> "${hostsPath}"`
        ).join('\r\n');
        
        await fs.writeFile(scriptPath, batchContent);
        
        return new Promise((resolve) => {
          sudo.exec(`cmd /c "${scriptPath}"`, options, async (error, stdout, stderr) => {
            // Clean up temp file
            try { await fs.remove(scriptPath); } catch (e) {}
            
            if (error) {
              console.warn(`Could not update hosts file automatically: ${error.message}`);
              console.warn(`Please add manually:\n${entries.join('\n')}`);
              resolve({ success: false, error: error.message });
            } else {
              console.log(`Added ${domain} to hosts file`);
              resolve({ success: true });
            }
          });
        });
      } else {
        // On macOS/Linux, use sudo-prompt with tee
        const entry = entries.join('\n');
        const command = `sh -c "echo '${entry}' >> ${hostsPath}"`;
        
        return new Promise((resolve) => {
          sudo.exec(command, options, (error, stdout, stderr) => {
            if (error) {
              console.warn(`Could not update hosts file automatically: ${error.message}`);
              console.warn(`Please add manually:\n${entries.join('\n')}`);
              resolve({ success: false, error: error.message });
            } else {
              console.log(`Added ${domain} to hosts file`);
              resolve({ success: true });
            }
          });
        });
      }
    } catch (error) {
      console.warn(`Could not read hosts file: ${error.message}`);
      console.warn(`Please add manually: 127.0.0.1\t${domain}`);
      return { success: false, error: error.message };
    }
  }

  // Remove domain from hosts file
  async removeFromHostsFile(domain) {
    if (!domain) return;
    
    const hostsPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    try {
      let hostsContent = await fs.readFile(hostsPath, 'utf-8');
      
      // Remove lines containing the domain
      const lines = hostsContent.split('\n').filter(line => {
        const trimmed = line.trim();
        // Only filter out DevBox Pro entries for this domain
        return !trimmed.includes(domain) || !trimmed.startsWith('127.0.0.1');
      });
      
      const newContent = lines.join('\n');
      
      if (newContent !== hostsContent) {
        const sudo = require('sudo-prompt');
        const options = {
          name: 'DevBox Pro',
          icns: undefined
        };
        
        if (process.platform === 'win32') {
          const { app } = require('electron');
          const tempDir = app.getPath('temp');
          const tempHostsPath = path.join(tempDir, 'hosts-new');
          
          // Write new content to temp file
          await fs.writeFile(tempHostsPath, newContent);
          
          // Use sudo to copy the temp file to the hosts location
          const command = `copy /Y "${tempHostsPath}" "${hostsPath}"`;
          
          return new Promise((resolve) => {
            sudo.exec(`cmd /c ${command}`, options, async (error, stdout, stderr) => {
              try { await fs.remove(tempHostsPath); } catch (e) {}
              
              if (error) {
                console.warn(`Could not remove ${domain} from hosts file: ${error.message}`);
                resolve({ success: false, error: error.message });
              } else {
                console.log(`Removed ${domain} from hosts file`);
                resolve({ success: true });
              }
            });
          });
        } else {
          const { app } = require('electron');
          const tempDir = app.getPath('temp');
          const tempHostsPath = path.join(tempDir, 'hosts-new');
          
          await fs.writeFile(tempHostsPath, newContent);
          
          return new Promise((resolve) => {
            sudo.exec(`cp "${tempHostsPath}" "${hostsPath}"`, options, async (error, stdout, stderr) => {
              try { await fs.remove(tempHostsPath); } catch (e) {}
              
              if (error) {
                console.warn(`Could not remove ${domain} from hosts file: ${error.message}`);
                resolve({ success: false, error: error.message });
              } else {
                console.log(`Removed ${domain} from hosts file`);
                resolve({ success: true });
              }
            });
          });
        }
      }
      
      return { success: true, nothingToRemove: true };
    } catch (error) {
      console.warn(`Could not update hosts file: ${error.message}`);
      return { success: false, error: error.message };
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

    const oldWebServer = project.webServer || 'nginx';
    
    // If same web server, nothing to do
    if (oldWebServer === newWebServer) {
      return { success: true, webServer: newWebServer, message: 'Already using this web server' };
    }

    const wasRunning = this.runningProjects.has(projectId);
    
    // Stop the project if running
    if (wasRunning) {
      await this.stopProject(projectId);
    }

    // Remove old vhost config from OLD web server
    await this.removeVirtualHost(project);

    // Check if any other projects are still using the old web server
    const allProjects = this.configStore.get('projects', []);
    const otherProjectsOnOldServer = allProjects.filter(p => 
      p.id !== projectId && 
      (p.webServer || 'nginx') === oldWebServer &&
      this.runningProjects.has(p.id)
    );
    
    // If no other projects use the old web server, stop it to free up ports
    if (otherProjectsOnOldServer.length === 0) {
      console.log(`No other projects using ${oldWebServer}, stopping it to free ports...`);
      try {
        await this.managers.service?.stopService(oldWebServer);
        // Wait for ports to be fully released
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.warn(`Could not stop ${oldWebServer}:`, error.message);
      }
    } else {
      console.log(`${otherProjectsOnOldServer.length} other project(s) still using ${oldWebServer}, keeping it running`);
    }

    // Update project with new web server
    const projects = this.configStore.get('projects', []);
    const index = projects.findIndex((p) => p.id === projectId);
    if (index !== -1) {
      projects[index] = {
        ...projects[index],
        webServer: newWebServer,
        updatedAt: new Date().toISOString(),
      };
      this.configStore.set('projects', projects);
    }
    project.webServer = newWebServer;

    // Create new vhost config BEFORE starting the new web server
    await this.createVirtualHost(project);

    // Restart if was running
    if (wasRunning) {
      await this.startProject(projectId);
    }

    return { success: true, webServer: newWebServer };
  }

  /**
   * Scan the projects directory for folders that aren't registered
   * Returns an array of discovered projects with detected type
   */
  async scanUnregisteredProjects() {
    const settings = this.configStore.get('settings', {});
    const projectsDir = settings.defaultProjectsPath;

    if (!projectsDir || !(await fs.pathExists(projectsDir))) {
      console.log('Projects directory not configured or does not exist');
      return [];
    }

    // Get all registered project paths (normalized)
    const registeredPaths = this.getAllProjects().map((p) => 
      path.normalize(p.path).toLowerCase()
    );

    const unregistered = [];

    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        // Skip hidden folders and common non-project folders
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(projectsDir, entry.name);
        const normalizedPath = path.normalize(fullPath).toLowerCase();

        // Skip if already registered
        if (registeredPaths.includes(normalizedPath)) continue;

        // Check if it looks like a PHP project
        const isPhpProject = await this.looksLikePhpProject(fullPath);
        if (!isPhpProject) continue;

        // Detect project type
        const type = await this.detectProjectType(fullPath);

        unregistered.push({
          name: entry.name,
          path: fullPath,
          type,
        });
      }
    } catch (error) {
      console.error('Error scanning for unregistered projects:', error);
    }

    console.log(`Found ${unregistered.length} unregistered project(s)`);
    return unregistered;
  }

  /**
   * Check if a folder looks like a PHP project
   */
  async looksLikePhpProject(folderPath) {
    try {
      // Check for common PHP project indicators
      const indicators = [
        'composer.json',
        'index.php',
        'wp-config.php',
        'wp-config-sample.php',
        'artisan', // Laravel
        'public/index.php',
        'bin/console', // Symfony
      ];

      for (const indicator of indicators) {
        if (await fs.pathExists(path.join(folderPath, indicator))) {
          return true;
        }
      }

      // Check if there are any .php files in the root
      const entries = await fs.readdir(folderPath);
      return entries.some((entry) => entry.endsWith('.php'));
    } catch (error) {
      return false;
    }
  }

  /**
   * Register an existing project folder (import without creating new files)
   */
  async registerExistingProject(config) {
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

    // Generate domain name from folder name
    const domainName = `${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.test`;

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
      ssl: true,
      autoStart: false,
      services: {
        mysql: config.database === 'mysql',
        mariadb: config.database === 'mariadb',
        redis: false,
        queue: false,
      },
      environment: this.getDefaultEnvironment(projectType, config.name, port),
      supervisor: {
        workers: 1,
        processes: [],
      },
      createdAt: new Date().toISOString(),
      lastStarted: null,
    };

    // Create database for project if database is enabled
    if (config.database && config.database !== 'none') {
      const dbName = this.sanitizeDatabaseName(config.name);
      project.environment.DB_DATABASE = dbName;

      try {
        await this.managers.database?.createDatabase(dbName);
      } catch (error) {
        console.warn('Could not create database:', error.message);
      }
    }

    // Create SSL certificate
    try {
      await this.managers.ssl?.createCertificate(project.domains);
    } catch (error) {
      console.warn('Could not create SSL certificate:', error.message);
    }

    // Create virtual host configuration
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

    // Save project
    existingProjects.push(project);
    this.configStore.set('projects', existingProjects);

    // Auto-install CLI if not already installed
    await this.ensureCliInstalled();

    console.log(`Existing project registered: ${project.name} (${project.id})`);
    return project;
  }

  /**
   * Check compatibility of service versions
   * @param {Object} config - Configuration with version info
   * @returns {Object} Compatibility check result with warnings
   */
  checkCompatibility(config) {
    return this.compatibilityManager.checkCompatibility(config);
  }

  /**
   * Get compatibility rules for display
   * @returns {Array} List of compatibility rules
   */
  getCompatibilityRules() {
    return this.compatibilityManager.getAllRules();
  }

  /**
   * Get project service versions summary
   * @param {string} id - Project ID
   * @returns {Object} Service versions info
   */
  getProjectServiceVersions(id) {
    const project = this.getProject(id);
    if (!project) {
      return null;
    }

    return {
      phpVersion: project.phpVersion,
      webServer: project.webServer,
      webServerVersion: project.webServerVersion || '1.28',
      mysql: project.services?.mysql ? project.services.mysqlVersion || '8.4' : null,
      mariadb: project.services?.mariadb ? project.services.mariadbVersion || '11.4' : null,
      redis: project.services?.redis ? project.services.redisVersion || '7.4' : null,
      nodejs: project.services?.nodejs ? project.services.nodejsVersion || '20' : null,
      compatibilityWarnings: project.compatibilityWarnings || [],
    };
  }

  /**
   * Update service versions for a project
   * @param {string} id - Project ID
   * @param {Object} versions - New version configuration
   * @returns {Object} Updated project
   */
  async updateProjectServiceVersions(id, versions) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    const updates = {};

    // Update individual version fields
    if (versions.phpVersion !== undefined) {
      updates.phpVersion = versions.phpVersion;
    }
    if (versions.webServerVersion !== undefined) {
      updates.webServerVersion = versions.webServerVersion;
    }
    if (versions.services) {
      updates.services = {
        ...project.services,
        ...versions.services,
      };
    }

    // Check compatibility of new configuration
    const compatConfig = {
      phpVersion: updates.phpVersion || project.phpVersion,
      mysqlVersion: (updates.services?.mysql ?? project.services?.mysql) 
        ? (updates.services?.mysqlVersion || project.services?.mysqlVersion) : null,
      mariadbVersion: (updates.services?.mariadb ?? project.services?.mariadb)
        ? (updates.services?.mariadbVersion || project.services?.mariadbVersion) : null,
      redisVersion: (updates.services?.redis ?? project.services?.redis)
        ? (updates.services?.redisVersion || project.services?.redisVersion) : null,
      nodejsVersion: (updates.services?.nodejs ?? project.services?.nodejs)
        ? (updates.services?.nodejsVersion || project.services?.nodejsVersion) : null,
      projectType: project.type,
    };

    const compatibility = this.compatibilityManager.checkCompatibility(compatConfig);
    updates.compatibilityWarnings = compatibility.warnings || [];

    return this.updateProject(id, updates);
  }
}

module.exports = { ProjectManager };
