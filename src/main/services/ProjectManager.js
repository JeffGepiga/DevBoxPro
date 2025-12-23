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

    // Track which project currently owns port 80 for network access
    // First project to start with networkAccess gets port 80
    this.networkPort80Owner = null;
  }

  async initialize() {
    // Ensure projects array exists in config
    if (!this.configStore.get('projects')) {
      this.configStore.set('projects', []);
    }

    // Initialize compatibility manager (loads cached config)
    await this.compatibilityManager.initialize();
  }

  /**
   * Ensure CLI is installed and added to PATH
   * This is called automatically when creating/importing projects
   */
  async ensureCliInstalled() {
    const cli = this.managers.cli;
    if (!cli) {
      this.managers.log?.systemWarn('CLI manager not available');
      return;
    }

    try {
      const status = await cli.checkCliInstalled();

      // Install CLI script if not installed
      if (!status.installed) {
        await cli.installCli();
      }

      // Add to PATH if not already in PATH (Windows only supports auto-add)
      if (!status.inPath && process.platform === 'win32') {
        try {
          await cli.addToPath();
        } catch (error) {
          // Silently ignore PATH errors
        }
      }

      // Sync projects file for CLI
      await this.syncCliProjectsFile();
    } catch (error) {
      this.managers.log?.systemWarn('Could not ensure CLI installed', { error: error.message });
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

      // Auto-initialize terminal commands if enabled and not yet set up
      if (cli.getDirectShimsEnabled()) {
        const status = await cli.checkCliInstalled();
        if (!status.installed || !status.inPath) {
          // Install shims and add to PATH automatically
          await cli.installCli();
          await cli.installDirectShims();
          await cli.addToPath();
          this.managers.log?.systemInfo('Terminal commands auto-initialized');
        }
      }
    } catch (error) {
      this.managers.log?.systemWarn('Could not sync CLI projects file', { error: error.message });
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
    const settings = this.configStore.get('settings', {});
    const existingProjects = this.configStore.get('projects', []);

    // Check if a project already exists at this path
    const normalizedPath = path.normalize(config.path).toLowerCase();
    const existingProject = existingProjects.find(p =>
      path.normalize(p.path).toLowerCase() === normalizedPath
    );

    if (existingProject) {
      // Project at this path already exists - check if it was a failed installation
      if (existingProject.installing || existingProject.installError) {
        // Remove the failed project and allow re-creation
        const filteredProjects = existingProjects.filter(p => p.id !== existingProject.id);
        this.configStore.set('projects', filteredProjects);
        // Debug log removed - project retry is handled gracefully

        // Clean up any partial files from the failed installation if it's a fresh install retry
        if (config.installFresh) {
          try {
            const projectDir = config.path;
            if (await fs.pathExists(projectDir)) {
              const files = await fs.readdir(projectDir);
              // Only clean if it looks like a partial installation (has vendor or artisan but not complete)
              const hasVendor = files.includes('vendor');
              const hasArtisan = files.includes('artisan');
              const hasComposerJson = files.includes('composer.json');

              if (hasVendor || hasArtisan || hasComposerJson) {
                // Debug log removed - cleanup is internal operation
                await fs.remove(projectDir);
              }
            }
          } catch (cleanupError) {
            this.managers.log?.systemWarn('Could not clean up partial installation', { error: cleanupError.message });
          }
        }
      } else {
        throw new Error(`A project already exists at this path: ${config.path}\n\nProject name: "${existingProject.name}"\n\nPlease choose a different location or delete the existing project first.`);
      }
    }

    // Check if a project with the same name already exists (to avoid confusion)
    // Re-fetch after potentially removing failed project
    const projectsAfterCleanup = this.configStore.get('projects', []);
    const sameNameProject = projectsAfterCleanup.find(p =>
      p.name.toLowerCase() === config.name.toLowerCase()
    );

    if (sameNameProject) {
      throw new Error(`A project with the name "${config.name}" already exists.\n\nPlease choose a different name.`);
    }

    const id = uuidv4();

    // Validate that required PHP version is installed before creating project
    const phpVersion = config.phpVersion || '8.3';
    const { app } = require('electron');
    const resourcePath = this.configStore.get('resourcePath') || path.join(app.getPath('userData'), 'resources');
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const phpDir = path.join(resourcePath, 'php', phpVersion, platform);
    const phpExe = platform === 'win' ? 'php.exe' : 'php';
    const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';

    if (!await fs.pathExists(path.join(phpDir, phpExe)) || !await fs.pathExists(path.join(phpDir, phpCgiExe))) {
      throw new Error(`PHP ${phpVersion} is not installed. Please download it from the Binary Manager before creating a project.`);
    }

    // Re-fetch projects list (it may have changed after removing failed project)
    const currentProjects = this.configStore.get('projects', []);

    // Find available port
    const usedPorts = currentProjects.map((p) => p.port);
    let port = settings.portRangeStart || 8000;
    while (usedPorts.includes(port)) {
      port++;
    }

    // SSL port (443 base + offset)
    let sslPort = 443;
    const usedSslPorts = currentProjects.map((p) => p.sslPort).filter(Boolean);
    while (usedSslPorts.includes(sslPort)) {
      sslPort++;
    }

    // Detect project type if not specified
    const projectType = config.type || (await this.detectProjectType(config.path));

    // Determine default web server version from installed versions
    let defaultWebServerVersion = '1.28';
    const webServer = config.webServer || settings.webServer || 'nginx';
    const webServerDir = path.join(resourcePath, webServer);
    if (await fs.pathExists(webServerDir)) {
      const installedVersions = (await fs.readdir(webServerDir))
        .filter(v => !v.includes('.'))  // Filter out files
        .sort((a, b) => parseFloat(b) - parseFloat(a));  // Sort descending (latest first)
      if (installedVersions.length > 0) {
        defaultWebServerVersion = installedVersions[0];
      }
    }

    // Generate domain name from project name
    const domainName = config.domain || `${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.test`;

    const project = {
      id,
      name: config.name,
      path: config.path,
      type: projectType,
      phpVersion: config.phpVersion || '8.3',
      webServer: webServer,
      webServerVersion: config.webServerVersion || defaultWebServerVersion,
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
    }

    // Create database for project if MySQL or MariaDB is enabled
    if (project.services.mysql || project.services.mariadb) {
      const dbName = this.sanitizeDatabaseName(config.name);
      project.environment.DB_DATABASE = dbName;

      try {
        // Set the active database type and get the version based on project configuration
        let dbVersion = null;
        if (project.services.mariadb && this.managers.database) {
          await this.managers.database.setActiveDatabaseType('mariadb');
          dbVersion = project.services.mariadbVersion || '11.4';
        } else if (project.services.mysql && this.managers.database) {
          await this.managers.database.setActiveDatabaseType('mysql');
          dbVersion = project.services.mysqlVersion || '8.4';
        }

        await this.managers.database?.createDatabase(dbName, dbVersion);
      } catch (error) {
        this.managers.log?.systemWarn('Could not create database during project creation', { project: config.name, error: error.message });
      }
    }

    // Create SSL certificate if enabled
    if (project.ssl) {
      try {
        await this.managers.ssl?.createCertificate(project.domains);
        // Note: SSL certificates are signed by Root CA which is trusted during SslManager initialization
      } catch (error) {
        this.managers.log?.systemWarn('Could not create SSL certificate', { project: config.name, error: error.message });
      }
    }

    // Create virtual host configuration (HTTP + HTTPS)
    // Skip if installing fresh OR cloning - the document root doesn't exist yet
    if (!config.installFresh && config.projectSource !== 'clone') {
      try {
        await this.createVirtualHost(project);
      } catch (error) {
        this.managers.log?.systemWarn('Could not create virtual host', { project: config.name, error: error.message });
      }
    }

    // Add domain to hosts file
    try {
      await this.addToHostsFile(project.domain);
    } catch (error) {
      this.managers.log?.systemWarn('Could not update hosts file', { project: config.name, error: error.message });
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
    // Re-fetch to ensure we have latest list
    const projectsToSave = this.configStore.get('projects', []);
    projectsToSave.push(project);
    this.configStore.set('projects', projectsToSave);

    // Auto-install CLI if not already installed
    await this.ensureCliInstalled();

    // Install fresh framework OR clone from repository - run async without blocking
    if (config.installFresh || config.projectSource === 'clone') {
      // Mark project as installing
      project.installing = true;

      // Store clone config for runInstallation
      project.cloneConfig = config.projectSource === 'clone' ? {
        repositoryUrl: config.repositoryUrl,
        authType: config.authType || 'public',
        accessToken: config.accessToken,
      } : null;

      // Run installation in background (don't await)
      this.runInstallation(project, mainWindow).catch(error => {
        this.managers.log?.systemError('Background installation failed', { project: project.name, error: error.message });
      });
    }

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

    sendOutput(`Starting ${project.cloneConfig ? 'repository clone' : project.type} installation at ${project.path}...`, 'info');

    try {
      // Handle Git clone first if specified
      if (project.cloneConfig && project.cloneConfig.repositoryUrl) {
        sendOutput('═══════════════════════════════════════════════════════════════', 'info');
        sendOutput('📥 Cloning Repository...', 'info');
        sendOutput(`$ git clone ${project.cloneConfig.repositoryUrl}`, 'command');
        sendOutput('═══════════════════════════════════════════════════════════════', 'info');

        const gitManager = this.managers.git;
        if (!gitManager) {
          throw new Error('Git manager not available. Please install Git first.');
        }

        // Clone the repository
        const cloneResult = await gitManager.cloneRepository(
          project.cloneConfig.repositoryUrl,
          project.path,
          {
            authType: project.cloneConfig.authType,
            accessToken: project.cloneConfig.accessToken,
            onProgress: (progress) => {
              if (progress.phase) {
                sendOutput(`   ${progress.phase}: ${progress.percent || 0}%`, 'info');
              }
            },
          }
        );

        if (!cloneResult.success) {
          throw new Error(cloneResult.error || 'Git clone failed');
        }

        sendOutput('✓ Repository cloned successfully!', 'success');
        sendOutput('', 'info');

        // For cloned Laravel projects, run composer install
        if (project.type === 'laravel') {
          await this.runPostCloneLaravelSetup(project, mainWindow);
        }

      } else if (project.type === 'laravel') {
        // Fresh Laravel installation
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

        await this.installLaravel(project, mainWindow);

      } else if (project.type === 'wordpress') {
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
      this.managers.log?.systemError('Failed to install framework', { project: project.name, error: error.message });
      // Mark installation as failed but keep the project usable
      // User can fix it manually (e.g., run composer install in terminal)
      project.installError = error.message;
      project.installing = false;
      project.needsManualSetup = true; // Flag to indicate manual setup needed
      this.updateProjectInStore(project);

      sendOutput(`✗ Installation failed: ${error.message}`, 'error');
      sendOutput('', 'info');
      sendOutput('─────────────────────────────────────────────────────────────', 'info');
      sendOutput('💡 You can fix this manually:', 'info');
      sendOutput('   1. Click "I\'ll Fix It Manually" to go to your project', 'info');
      sendOutput('   2. Open a terminal in your project folder', 'info');
      sendOutput('   3. Run: composer install', 'info');
      sendOutput('   4. Run: php artisan key:generate (for Laravel)', 'info');
      sendOutput('─────────────────────────────────────────────────────────────', 'info');
      sendOutput('', 'complete');
    }
  }

  // Post-clone setup for Laravel projects (composer install, .env, key:generate)
  async runPostCloneLaravelSetup(project, mainWindow) {
    const sendOutput = (text, type) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal:output', {
          projectId: 'installation',
          text,
          type,
        });
      }
    };

    const projectPath = project.path;
    const phpVersion = project.phpVersion || '8.4';
    const useNodejs = project.services?.nodejs !== false;
    const nodejsVersion = project.services?.nodejsVersion || '20';

    const binary = this.managers.binaryDownload;
    if (!binary) {
      throw new Error('BinaryDownloadManager not available');
    }

    // Check if composer.json exists
    const composerJsonPath = path.join(projectPath, 'composer.json');
    if (await fs.pathExists(composerJsonPath)) {
      sendOutput('Running composer install...', 'info');
      sendOutput('$ composer install --no-interaction', 'command');

      try {
        await binary.runComposer(
          projectPath,
          'install --no-interaction',
          phpVersion,
          (text, type) => sendOutput(text, type)
        );
        sendOutput('✓ Dependencies installed successfully!', 'success');
      } catch (error) {
        sendOutput(`Warning: composer install failed: ${error.message}`, 'warning');
        sendOutput('You may need to run composer install manually.', 'info');
      }
    }

    // Copy .env.example to .env if it exists
    try {
      const envExamplePath = path.join(projectPath, '.env.example');
      const envPath = path.join(projectPath, '.env');

      if (await fs.pathExists(envExamplePath) && !await fs.pathExists(envPath)) {
        sendOutput('Creating .env file...', 'info');
        await fs.copy(envExamplePath, envPath);
        sendOutput('✓ .env file created from .env.example', 'success');
      }
    } catch (e) {
      sendOutput(`Warning: Could not create .env file: ${e.message}`, 'warning');
    }

    // Update .env with database settings
    try {
      const envPath = path.join(projectPath, '.env');
      if (await fs.pathExists(envPath)) {
        let envContent = await fs.readFile(envPath, 'utf-8');

        // Update database settings
        const dbName = this.sanitizeDatabaseName(project.name);
        const dbInfo = this.managers.database?.getDatabaseInfo() || {};
        const dbUser = dbInfo.user || 'root';
        const dbPassword = dbInfo.password || '';
        const dbPort = dbInfo.port || 3306;

        envContent = envContent.replace(/^DB_DATABASE=.*/m, `DB_DATABASE=${dbName}`);
        envContent = envContent.replace(/^DB_USERNAME=.*/m, `DB_USERNAME=${dbUser}`);
        envContent = envContent.replace(/^DB_PASSWORD=.*/m, `DB_PASSWORD=${dbPassword}`);
        envContent = envContent.replace(/^DB_PORT=.*/m, `DB_PORT=${dbPort}`);

        // Update APP_URL
        envContent = envContent.replace(/^APP_URL=.*/m, `APP_URL=http://${project.domain}`);

        await fs.writeFile(envPath, envContent);
        sendOutput('✓ .env file configured', 'success');
      }
    } catch (e) {
      sendOutput(`Warning: Could not update .env file: ${e.message}`, 'warning');
    }

    // Generate application key
    try {
      sendOutput('Generating application key...', 'info');
      sendOutput('$ php artisan key:generate', 'command');

      const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
      const platform = process.platform === 'win32' ? 'win' : 'mac';
      const resourcePath = this.configStore.get('resourcePath') || path.join(require('electron').app.getPath('userData'), 'resources');
      const phpPath = path.join(resourcePath, 'php', phpVersion, platform, phpExe);

      if (await fs.pathExists(phpPath)) {
        await new Promise((resolve) => {
          const proc = spawn(phpPath, ['artisan', 'key:generate'], {
            cwd: projectPath,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
          });
          proc.stdout.on('data', (data) => sendOutput(data.toString(), 'stdout'));
          proc.stderr.on('data', (data) => sendOutput(data.toString(), 'stderr'));
          proc.on('close', (code) => {
            if (code === 0) {
              sendOutput('✓ Application key generated!', 'success');
            }
            resolve();
          });
          proc.on('error', () => resolve());
        });
      }
    } catch (e) {
      sendOutput(`Warning: Could not generate app key: ${e.message}`, 'warning');
    }

    // Run npm install if package.json exists AND Node.js service is enabled
    if (useNodejs) {
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
          sendOutput('Installing npm packages...', 'info');
          sendOutput('$ npm install', 'command');

          const platform = process.platform === 'win32' ? 'win' : 'mac';
          const resourcePath = this.configStore.get('resourcePath') || path.join(require('electron').app.getPath('userData'), 'resources');
          const nodeDir = path.join(resourcePath, 'nodejs', nodejsVersion, platform);

          let npmCmd = 'npm';

          if (await fs.pathExists(nodeDir)) {
            npmCmd = process.platform === 'win32' ? path.join(nodeDir, 'npm.cmd') : path.join(nodeDir, 'bin', 'npm');
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

            npmProc.stdout.on('data', (data) => sendOutput(data.toString(), 'stdout'));
            npmProc.stderr.on('data', (data) => sendOutput(data.toString(), 'stderr'));
            npmProc.on('close', (code) => {
              if (code === 0) {
                sendOutput('✓ npm packages installed successfully!', 'success');
              } else {
                sendOutput(`npm install finished with code ${code} (non-critical)`, 'warning');
              }
              resolve();
            });
            npmProc.on('error', (err) => {
              sendOutput(`npm not available: ${err.message} (non-critical)`, 'warning');
              resolve();
            });
          });
        }
      } catch (e) {
        sendOutput(`npm install skipped: ${e.message}`, 'warning');
      }
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

  async installLaravel(project, mainWindow = null) {
    const projectPath = project.path;
    const phpVersion = project.phpVersion || '8.4';
    const projectName = project.name || 'laravel';
    const useNodejs = project.services?.nodejs !== false; // Default to true for backwards compatibility
    const nodejsVersion = project.services?.nodejsVersion || '20';

    const parentPath = path.dirname(projectPath);
    const folderName = path.basename(projectPath);

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

      if (mainWindow && !mainWindow.isDestroyed()) {
        try {
          mainWindow.webContents.send('terminal:output', {
            projectId: 'installation',
            text: cleanText,
            type,
          });
        } catch (err) {
          // Ignore send errors
        }
      }
    };

    onOutput('Creating Laravel project...', 'info');
    onOutput(`$ composer create-project laravel/laravel ${folderName} --prefer-dist`, 'command');

    try {
      // Use composer to create Laravel project
      await binary.runComposer(
        parentPath,
        `create-project laravel/laravel ${folderName} --prefer-dist --no-interaction`,
        phpVersion,
        onOutput
      );

      onOutput('✓ Laravel files installed successfully!', 'success');
    } catch (error) {
      this.managers.log?.systemError('[installLaravel] Composer error', { error: error.message });
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

    // Run npm install if package.json exists AND Node.js service is enabled
    if (!useNodejs) {
      onOutput('Skipping npm install (Node.js service not selected)', 'info');
    } else {
      try {
        const packageJsonPath = path.join(projectPath, 'package.json');
        if (await fs.pathExists(packageJsonPath)) {
          onOutput('Installing npm packages...', 'info');
          onOutput('$ npm install', 'command');

          // Use selected Node.js version
          const platform = process.platform === 'win32' ? 'win' : 'mac';
          const resourcePath = this.configStore.get('resourcePath') || require('path').join(require('electron').app.getPath('userData'), 'resources');
          const nodeDir = path.join(resourcePath, 'nodejs', nodejsVersion, platform);

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

    // If environment was updated, sync to .env file for Laravel projects
    if (updates.environment && projects[index].type === 'laravel') {
      try {
        await this.syncEnvFile(projects[index]);
      } catch (error) {
        this.managers.log?.systemWarn('Could not sync .env file', { project: projects[index].name, error: error.message });
      }
    }

    // Restart if was running
    if (isRunning) {
      await this.startProject(id);
    }

    return projects[index];
  }

  /**
   * Sync environment variables to the project's .env file
   */
  async syncEnvFile(project) {
    if (!project.path || !project.environment) {
      return;
    }

    const envPath = path.join(project.path, '.env');

    if (!await fs.pathExists(envPath)) {
      return;
    }

    let envContent = await fs.readFile(envPath, 'utf-8');

    // Update each environment variable
    for (const [key, value] of Object.entries(project.environment)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      const newLine = `${key}=${value}`;

      if (regex.test(envContent)) {
        // Replace existing line
        envContent = envContent.replace(regex, newLine);
      } else {
        // Add new line at the end
        envContent = envContent.trim() + '\n' + newLine + '\n';
      }
    }
    await fs.writeFile(envPath, envContent);
  }

  /**
   * Read environment variables from the project's .env file
   */
  async readEnvFile(projectId) {
    const project = this.getProject(projectId);
    if (!project || !project.path) {
      throw new Error('Project not found');
    }

    const envPath = path.join(project.path, '.env');

    if (!await fs.pathExists(envPath)) {
      return {};
    }

    const envContent = await fs.readFile(envPath, 'utf-8');
    const environment = {};

    // Parse .env file - handle multi-line values in quotes
    const lines = envContent.split('\n');
    let currentKey = null;
    let currentValue = '';
    let inMultilineQuote = null; // null, '"', or "'"

    for (const line of lines) {
      // If we're in a multi-line value, accumulate until closing quote
      if (inMultilineQuote) {
        currentValue += '\n' + line;
        // Check if this line ends the multi-line value
        const trimmedLine = line.trimEnd();
        if (trimmedLine.endsWith(inMultilineQuote) && !trimmedLine.endsWith('\\' + inMultilineQuote)) {
          // End of multi-line value - remove the closing quote
          currentValue = currentValue.slice(0, -1);
          environment[currentKey] = currentValue;
          currentKey = null;
          currentValue = '';
          inMultilineQuote = null;
        }
        continue;
      }

      // Skip comments and empty lines
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      // Parse KEY=VALUE format
      const equalsIndex = trimmed.indexOf('=');
      if (equalsIndex > 0) {
        const key = trimmed.substring(0, equalsIndex).trim();
        let value = trimmed.substring(equalsIndex + 1).trim();

        // Check for quoted values
        const startsWithDoubleQuote = value.startsWith('"');
        const startsWithSingleQuote = value.startsWith("'");

        if (startsWithDoubleQuote || startsWithSingleQuote) {
          const quote = startsWithDoubleQuote ? '"' : "'";
          const valueWithoutStartQuote = value.slice(1);

          // Check if value ends with the same quote (single-line quoted value)
          if (valueWithoutStartQuote.endsWith(quote) && !valueWithoutStartQuote.endsWith('\\' + quote)) {
            // Single-line quoted value - remove both quotes
            environment[key] = valueWithoutStartQuote.slice(0, -1);
          } else {
            // Multi-line quoted value - start accumulating
            currentKey = key;
            currentValue = valueWithoutStartQuote;
            inMultilineQuote = quote;
          }
        } else {
          // Unquoted value
          environment[key] = value;
        }
      }
    }

    // Handle unclosed multi-line value (edge case)
    if (currentKey && inMultilineQuote) {
      environment[currentKey] = currentValue;
    }

    return environment;
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
      this.managers.log?.systemWarn('Error removing virtual host', { project: project.name, error: error.message });
    }

    // Remove domain from hosts file
    try {
      await this.removeFromHostsFile(project.domain);
    } catch (error) {
      this.managers.log?.systemWarn('Error removing from hosts file', { project: project.name, error: error.message });
    }

    // Delete project files if requested
    if (deleteFiles && project.path) {
      try {
        await fs.remove(project.path);
      } catch (error) {
        this.managers.log?.systemError('Error deleting project files', { project: project.name, path: project.path, error: error.message });
        throw new Error(`Failed to delete project files: ${error.message}`);
      }
    }

    // Remove project from config
    const projects = this.configStore.get('projects', []);
    const filtered = projects.filter((p) => p.id !== id);
    this.configStore.set('projects', filtered);

    // Sync CLI projects file
    await this.syncCliProjectsFile();

    return { success: true, filesDeleted: deleteFiles };
  }

  async startProject(id) {
    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    if (this.runningProjects.has(id)) {
      this.managers.log?.project(id, `Project ${project.name} is already running`);
      return { success: true, alreadyRunning: true };
    }

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

      // Calculate PHP-CGI port (unique per project) - needed for vhost config
      const phpFpmPort = 9000 + (parseInt(project.id.slice(-4), 16) % 1000);

      // Regenerate virtual host config BEFORE starting services
      // This ensures the vhost config has correct paths for the current web server version
      await this.createVirtualHost(project, phpFpmPort);

      // Start required services (nginx/apache, mysql, redis, etc.)
      const serviceResult = await this.startProjectServices(project);

      // Check if critical services failed
      if (!serviceResult.success) {
        const errorMsg = serviceResult.errors.length > 0
          ? serviceResult.errors.join('; ')
          : `Critical services failed to start: ${serviceResult.criticalFailures.join(', ')}`;
        throw new Error(errorMsg);
      }

      let phpCgiProcess = null;
      let actualPhpFpmPort = phpFpmPort;

      // Only start PHP-CGI process for Nginx (uses FastCGI)
      // Apache uses Action/AddHandler CGI approach - invokes PHP-CGI directly per request
      const webServer = project.webServer || 'nginx';
      if (webServer === 'nginx') {
        const phpCgiResult = await this.startPhpCgi(project, phpFpmPort);
        phpCgiProcess = phpCgiResult.process;
        actualPhpFpmPort = phpCgiResult.port;

        // If port changed due to availability, regenerate vhost with correct port
        if (actualPhpFpmPort !== phpFpmPort) {
          await this.createVirtualHost(project, actualPhpFpmPort);
        }
      }

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

      this.managers.log?.project(id, `Project ${project.name} started successfully`);
      this.managers.log?.project(id, `PHP-CGI running on port ${actualPhpFpmPort}`);
      return { success: true, port: project.port, phpFpmPort: actualPhpFpmPort };
    } catch (error) {
      this.managers.log?.systemError(`Failed to start project ${project.name}`, { error: error.message });
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

    // Check PHP version - check filesystem directly for both php and php-cgi
    const phpVersion = project.phpVersion || '8.3';
    const phpExe = platform === 'win' ? 'php.exe' : 'php';
    const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';
    const phpPath = path.join(resourcePath, 'php', phpVersion, platform);
    const phpExists = await fs.pathExists(path.join(phpPath, phpExe));
    const phpCgiExists = await fs.pathExists(path.join(phpPath, phpCgiExe));
    if (!phpExists || !phpCgiExists) {
      missing.push(`PHP ${phpVersion}`);
    }

    // Check web server - auto-fix if configured version doesn't exist
    const webServer = project.webServer || 'nginx';
    let webServerVersion = project.webServerVersion || (webServer === 'nginx' ? '1.28' : '2.4');
    const webServerPath = path.join(resourcePath, webServer, webServerVersion, platform);

    if (!await fs.pathExists(webServerPath)) {
      // Try to find an available version
      const webServerDir = path.join(resourcePath, webServer);
      let availableVersion = null;

      if (await fs.pathExists(webServerDir)) {
        const versions = await fs.readdir(webServerDir);
        for (const v of versions) {
          const vPath = path.join(webServerDir, v, platform);
          if (await fs.pathExists(vPath)) {
            availableVersion = v;
            break;
          }
        }
      }

      if (availableVersion) {
        // Auto-fix: Update project config with available version
        const projects = this.configStore.get('projects', []);
        const index = projects.findIndex(p => p.id === project.id);
        if (index !== -1) {
          projects[index].webServerVersion = availableVersion;
          this.configStore.set('projects', projects);
          // Also update the project object in memory
          project.webServerVersion = availableVersion;
          this.managers.log?.systemInfo(`Auto-updated ${project.name} web server version from ${webServerVersion} to ${availableVersion}`);
        }
      } else {
        missing.push(`${webServer === 'nginx' ? 'Nginx' : 'Apache'} ${webServerVersion}`);
      }
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
    const { app } = require('electron');
    const resourcePath = this.configStore.get('resourcePath') || path.join(app.getPath('userData'), 'resources');
    const platform = process.platform === 'win32' ? 'win' : 'mac';

    // Check if PHP version is available - check filesystem directly
    const phpExe = platform === 'win' ? 'php.exe' : 'php';
    const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';
    const phpDir = path.join(resourcePath, 'php', phpVersion, platform);
    const phpPath = path.join(phpDir, phpExe);
    const phpCgiPath = path.join(phpDir, phpCgiExe);

    if (!await fs.pathExists(phpPath)) {
      throw new Error(`PHP ${phpVersion} is not installed at:\n${phpPath}\n\nPlease install PHP ${phpVersion} from the Binary Manager.`);
    }

    // Check if php-cgi exists
    if (!await fs.pathExists(phpCgiPath)) {
      throw new Error(`PHP-CGI not found for PHP ${phpVersion} at:\n${phpCgiPath}\n\nThe PHP installation may be incomplete. Please reinstall PHP ${phpVersion} from the Binary Manager.`);
    }

    // Check if port is available, find alternative if not
    let actualPort = port;
    if (!await isPortAvailable(port)) {
      actualPort = await findAvailablePort(port, 100);
      if (!actualPort) {
        throw new Error(`Could not find available port for PHP-CGI (starting from ${port})`);
      }
    }

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
        this.managers.log?.systemError(`PHP-CGI error for ${project.name}`, { error: error.message });
      });

      phpCgiProcess.on('exit', (code) => {
        // Process exited
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
        this.managers.log?.systemError(`PHP-CGI error for ${project.name}`, { error: error.message });
      });

      phpCgiProcess.on('exit', (code) => {
        // Process exited
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

    this.managers.log?.systemWarn(`PHP-CGI may not have started properly on port ${actualPort}`);

    return { process: phpCgiProcess, port: actualPort };
  }

  async stopProject(id) {
    const running = this.runningProjects.get(id);
    if (!running) {
      return { success: true, wasRunning: false };
    }

    const project = this.getProject(id);
    this.managers.log?.project(id, `Stopping project: ${project?.name || id}`);

    try {
      const kill = require('tree-kill');

      // Stop PHP-CGI process
      if (running.phpCgiProcess && running.phpCgiProcess.pid) {
        await new Promise((resolve) => {
          kill(running.phpCgiProcess.pid, 'SIGTERM', (err) => {
            if (err) this.managers.log?.systemError('Error killing PHP-CGI process', { error: err.message });
            resolve();
          });
        });
      }

      // Stop supervisor processes
      if (project?.supervisor.processes.length > 0) {
        await this.managers.supervisor?.stopAllProcesses(id);
      }

      this.runningProjects.delete(id);

      // Release port 80 ownership if this project owned it
      if (this.networkPort80Owner === id) {
        this.networkPort80Owner = null;
      }

      // Stop project services that are no longer needed by other running projects
      if (project) {
        const serviceResult = await this.stopProjectServices(project);
        if (serviceResult.stopped?.length > 0) {
          this.managers.log?.project(id, `Stopped unused services: ${serviceResult.stopped.join(', ')}`);
        }
      }

      this.managers.log?.project(id, `Project ${project?.name || id} stopped successfully`);

      return { success: true, wasRunning: true };
    } catch (error) {
      this.managers.log?.systemError('Error stopping project', { project: project?.name, id, error: error.message });
      throw error;
    }
  }

  /**
   * Get the list of services a project depends on
   * @param {Object} project - The project object
   * @returns {Array} List of service dependencies with name and version
   */
  getProjectServiceDependencies(project) {
    const services = [];

    // Web server
    const webServer = project.webServer || 'nginx';
    const webServerVersion = project.webServerVersion || (webServer === 'nginx' ? '1.28' : '2.4');
    services.push({ name: webServer, version: webServerVersion });

    // Database
    if (project.services?.mysql) {
      services.push({ name: 'mysql', version: project.services.mysqlVersion || '8.4' });
    }
    if (project.services?.mariadb) {
      services.push({ name: 'mariadb', version: project.services.mariadbVersion || '11.4' });
    }

    // Redis
    if (project.services?.redis) {
      services.push({ name: 'redis', version: project.services.redisVersion || '7.4' });
    }

    // Mailpit
    if (project.services?.mailpit) {
      services.push({ name: 'mailpit', version: null });
    }

    // phpMyAdmin
    if (project.services?.phpmyadmin) {
      services.push({ name: 'phpmyadmin', version: null });
    }

    return services;
  }

  /**
   * Stop services that are no longer needed by any running project
   * @param {Object} project - The project that was just stopped
   * @returns {Object} Result with stopped services and failures
   */
  async stopProjectServices(project) {
    const serviceManager = this.managers.service;
    if (!serviceManager) {
      return { success: true, stopped: [], failed: [] };
    }

    // Get services this project uses
    const projectServices = this.getProjectServiceDependencies(project);

    // Get all OTHER running projects (excluding this one since it's already removed from runningProjects)
    const otherRunningProjects = Array.from(this.runningProjects.keys())
      .map(id => this.getProject(id))
      .filter(p => p);

    // For each service, check if any other project needs it
    const servicesToStop = [];
    for (const service of projectServices) {
      const isNeededByOther = otherRunningProjects.some(otherProject => {
        const otherServices = this.getProjectServiceDependencies(otherProject);
        return otherServices.some(s =>
          s.name === service.name &&
          (s.version === service.version || s.version === null || service.version === null)
        );
      });

      if (!isNeededByOther) {
        servicesToStop.push(service);
      }
    }

    // Stop services that are no longer needed
    const results = { success: true, stopped: [], failed: [] };
    for (const service of servicesToStop) {
      try {
        this.managers.log?.project(project.id, `Stopping ${service.name}${service.version ? ':' + service.version : ''} (no longer needed)...`);
        await serviceManager.stopService(service.name, service.version);
        results.stopped.push(`${service.name}${service.version ? ':' + service.version : ''}`);
      } catch (error) {
        this.managers.log?.project(project.id, `Failed to stop ${service.name}: ${error.message}`, 'error');
        results.failed.push({ service: service.name, error: error.message });
      }
    }

    return results;
  }

  /**
   * Stop all running projects
   * @returns {Object} Result with success status and count of stopped projects
   */
  async stopAllProjects() {
    const runningProjectIds = Array.from(this.runningProjects.keys());

    if (runningProjectIds.length === 0) {
      // Still do cleanup in case of orphan processes
      if (process.platform === 'win32') {
        await this.forceKillOrphanPhpProcesses();
      }
      return { success: true, stoppedCount: 0 };
    }

    const results = [];
    for (const id of runningProjectIds) {
      try {
        await this.stopProject(id);
        results.push({ id, success: true });
      } catch (error) {
        this.managers.log?.systemError(`Error stopping project ${id}`, { error: error.message });
        results.push({ id, success: false, error: error.message });
      }
    }

    // Force kill any orphan PHP-CGI processes on Windows
    if (process.platform === 'win32') {
      await this.forceKillOrphanPhpProcesses();
    }

    const stoppedCount = results.filter(r => r.success).length;

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
    // Kill both php-cgi.exe and php.exe (used for artisan serve, composer, etc.)
    const processes = ['php-cgi.exe', 'php.exe'];
    for (const proc of processes) {
      try {
        execSync(`taskkill /F /IM ${proc} 2>nul`, {
          windowsHide: true,
          timeout: 5000,
          stdio: 'ignore'
        });
      } catch (e) {
        // Ignore - no processes to kill
      }
    }
  }

  async startSupervisorProcesses(project) {
    for (const processConfig of project.supervisor.processes) {
      if (processConfig.autostart) {
        try {
          await this.managers.supervisor?.startProcess(project.id, processConfig);
        } catch (error) {
          this.managers.log?.systemError(`Failed to start supervisor process ${processConfig.name}`, { project: project.name, error: error.message });
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
      return { success: true, warning: 'ServiceManager not available' };
    }

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

    // Mailpit for email testing (optional)
    if (project.services?.mailpit) {
      servicesToStart.push({ name: 'mailpit', critical: false });
    }

    // phpMyAdmin if enabled and database is used
    if (project.services?.phpmyadmin && (project.services?.mysql || project.services?.mariadb)) {
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
            results.started.push(`${service.name}:${requestedVersion}`);
            continue;
          }
        }

        if (needsStart || (isVersioned && !serviceManager.isVersionRunning(service.name, requestedVersion))) {
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
        this.managers.log?.systemWarn(errorMsg);
        results.failed.push(service.name);
        results.errors.push(errorMsg);

        if (service.critical) {
          results.criticalFailures.push(service.name);
          results.success = false;
        }
      }
    }

    if (results.success) {
      this.managers.log?.project(project.id, `Services ready: ${results.started.join(', ')}`);
    } else {
      this.managers.log?.systemError(`Critical services failed for project ${project.name}`, { failures: results.criticalFailures });
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
    const domain = project.domains?.[0] || project.domain;

    // Get actual port from ServiceManager based on web server type
    const webServer = project.webServer || 'nginx';
    const serviceManager = this.managers.service;
    const ports = serviceManager?.getServicePorts(webServer);

    // Determine which port to use based on SSL setting
    // All projects on same web server share the SSL port (SNI handles certificate selection)
    let port;
    if (project.ssl) {
      port = ports?.sslPort || 443;
    } else {
      // For HTTP, use project's unique port if network access and not owning port 80
      if (project.networkAccess && this.networkPort80Owner !== project.id && project.port) {
        port = project.port;
      } else {
        port = ports?.httpPort || 80;
      }
    }

    // Only include port in URL if it's not the default (80 for http, 443 for https)
    const isDefaultPort = (protocol === 'http' && port === 80) || (protocol === 'https' && port === 443);
    const portSuffix = isDefaultPort ? '' : `:${port}`;

    return `${protocol}://${domain}${portSuffix}`;
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

  /**
   * Detect project info from a folder path (for Import Project feature)
   * @param {string} folderPath - Path to the folder to analyze
   * @returns {Object} Project info with name, path, and detected type
   */
  async detectProjectTypeFromPath(folderPath) {
    const type = await this.detectProjectType(folderPath);
    const name = path.basename(folderPath);

    return {
      name,
      path: folderPath,
      type
    };
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
        await this.addToHostsFile(domain);
      } catch (error) {
        this.managers.log?.systemWarn(`Could not add ${domain} to hosts file`, { error: error.message });
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
        this.managers.log?.systemWarn('Could not reload nginx', { error: error.message });
      }
    } else {
      await this.createApacheVhost(project);
      // Reload Apache to pick up config changes
      try {
        await this.managers.service?.reloadApache();
      } catch (error) {
        this.managers.log?.systemWarn('Could not reload Apache', { error: error.message });
      }
    }
  }

  // Create Nginx virtual host
  async createNginxVhost(project, overridePhpFpmPort = null) {
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const resourcesPath = path.join(app.getPath('userData'), 'resources');
    const sitesDir = path.join(dataPath, 'nginx', 'sites');
    const sslDir = path.join(dataPath, 'ssl', project.domain);
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    let nginxVersion = project.webServerVersion || '1.28';

    // Validate that the nginx version exists, fall back to available version if not
    const nginxVersionPath = path.join(resourcesPath, 'nginx', nginxVersion, platform);
    if (!await fs.pathExists(nginxVersionPath)) {
      // Try to find an available nginx version
      const nginxDir = path.join(resourcesPath, 'nginx');
      if (await fs.pathExists(nginxDir)) {
        const availableVersions = await fs.readdir(nginxDir);
        for (const v of availableVersions) {
          const vPath = path.join(nginxDir, v, platform);
          if (await fs.pathExists(vPath)) {
            this.managers.log?.systemWarn(`Nginx ${nginxVersion} not found, using ${v} instead`, { project: project.name });
            nginxVersion = v;
            // Update project config with available version
            const projects = this.configStore.get('projects', []);
            const index = projects.findIndex(p => p.id === project.id);
            if (index !== -1) {
              projects[index].webServerVersion = v;
              this.configStore.set('projects', projects);
            }
            break;
          }
        }
      }
    }

    const fastcgiParamsPath = path.join(resourcesPath, 'nginx', nginxVersion, platform, 'conf', 'fastcgi_params').replace(/\\/g, '/');

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

    // Network Access Logic - Enable binding to all interfaces for LAN access
    const networkAccess = project.networkAccess || false;

    // First-come-first-served port 80 allocation for network access
    // Use networkPort80Owner to track which PROJECT owns port 80 (not just which web server)
    let canUsePort80 = false;
    if (networkAccess) {
      // Check if this project can use port 80
      if (this.networkPort80Owner === null) {
        // No project owns port 80 yet - check if actually available
        canUsePort80 = await isPortAvailable(80) && httpPort === 80;
        if (canUsePort80) {
          this.networkPort80Owner = project.id; // Claim port 80 for this project
        }
      } else if (this.networkPort80Owner === project.id) {
        // This project already owns port 80
        canUsePort80 = true;
      }
      // If another project owns port 80, canUsePort80 stays false
    }

    // Determine final port - shared SSL port for all projects on same web server
    let finalHttpPort;
    if (networkAccess) {
      if (canUsePort80) {
        finalHttpPort = 80; // Clean URL with Port 80
      } else {
        // Another project owns port 80 - use project's unique HTTP port
        finalHttpPort = project.port || httpPort;
      }
    } else {
      finalHttpPort = httpPort;
    }
    // All projects on same web server share SSL port (SNI handles certificate selection)

    // Determine listen directive - bind to all interfaces if network access enabled
    // Note: Don't add default_server as main nginx.conf already has one
    const listenDirective = networkAccess
      ? `0.0.0.0:${finalHttpPort}`
      : `${httpPort}`;
    const listenDirectiveSsl = networkAccess
      ? `0.0.0.0:${httpsPort} ssl`
      : `${httpsPort} ssl`;

    // Build server_name - ONLY add wildcard (_) for port 80 owner to accept IP access
    // Other projects should NOT have wildcard to allow proper SNI certificate selection
    const serverName = (networkAccess && canUsePort80)
      ? `${project.domain} www.${project.domain} _`  // Port 80 owner can match any hostname (for IP access)
      : `${project.domain} www.${project.domain}`;   // Others: specific domain only (for proper SNI)

    // Generate nginx config with both HTTP and HTTPS
    // PHP-CGI runs on phpFpmPort for FastCGI
    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
# Ports: HTTP=${finalHttpPort}, HTTPS=${httpsPort}${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}${canUsePort80 ? '\n# Port 80 (first-come-first-served)' : ''}

# HTTP Server
server {
    listen ${listenDirective};
    server_name ${serverName};
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
      try {
        await this.managers.ssl?.createCertificate(project.domains);
        // Re-check if certificates were created successfully
        certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);
      } catch (error) {
        this.managers.log?.systemWarn(`Failed to create SSL certificates for ${project.domain}`, { error: error.message });
      }
    }

    if (project.ssl && !certsExist) {
      this.managers.log?.systemWarn(`SSL enabled for ${project.domain} but certificates not found at ${sslDir}. Skipping SSL block.`);
    }

    if (project.ssl && certsExist) {
      config += `
# HTTPS Server (SSL)
server {
    listen ${listenDirectiveSsl};
    http2 on;
    server_name ${serverName};
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
    const sslDir = path.join(dataPath, 'ssl', project.domain).replace(/\\/g, '/');

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
      this.managers.log?.systemError(`[Apache Vhost] Invalid PHP-CGI port calculated: ${phpFpmPort}. Using default 9000.`);
      phpFpmPort = 9000;
    }

    // Convert to string and validate - ensure no extra characters
    const phpFpmPortStr = String(phpFpmPort).trim();

    // Get dynamic ports from ServiceManager
    const serviceManager = this.managers.service;
    const apachePorts = serviceManager?.getServicePorts('apache');
    const httpPort = apachePorts?.httpPort || 80;
    const httpsPort = apachePorts?.sslPort || 443;

    // Network Access Logic - Enable binding to all interfaces for LAN access
    const networkAccess = project.networkAccess || false;

    // First-come-first-served port 80 allocation for network access
    // Use networkPort80Owner to track which PROJECT owns port 80 (not just which web server)
    let canUsePort80 = false;
    if (networkAccess) {
      // Check if this project can use port 80
      if (this.networkPort80Owner === null) {
        // No project owns port 80 yet - check if actually available
        canUsePort80 = await isPortAvailable(80) && httpPort === 80;
        if (canUsePort80) {
          this.networkPort80Owner = project.id; // Claim port 80 for this project
        }
      } else if (this.networkPort80Owner === project.id) {
        // This project already owns port 80
        canUsePort80 = true;
      }
      // If another project owns port 80, canUsePort80 stays false
    }

    // Determine final port - shared SSL port for all projects on same web server
    let finalHttpPort;
    if (networkAccess) {
      if (canUsePort80) {
        finalHttpPort = 80; // Clean URL with Port 80
      } else {
        // Another project owns port 80 - use project's unique HTTP port
        finalHttpPort = project.port || httpPort;
      }
    } else {
      finalHttpPort = httpPort;
    }
    // All projects on same web server share SSL port (SNI handles certificate selection)

    const listenAddress = networkAccess ? '0.0.0.0' : '*';

    // Build ServerAlias - NO wildcard to ensure proper SNI certificate selection
    // Apache uses first loaded vhost as default for unmatched requests (load order)
    const serverAlias = `www.${project.domain}`;

    // Get PHP-CGI path for this PHP version
    const phpVersion = project.phpVersion || '8.4';
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const resourcesPath = path.join(app.getPath('userData'), 'resources');
    const phpCgiPath = path.join(resourcesPath, 'php', phpVersion, platform, 'php-cgi.exe').replace(/\\/g, '/');

    // Generate Apache config with both HTTP and HTTPS
    // NOTE: Listen directives are handled in createApacheConfig (httpd.conf) - not in vhosts

    let config = `
# DevBox Pro - ${project.name}
# Domain: ${project.domain}
# Generated: ${new Date().toISOString()}
# Apache running on ports HTTP=${finalHttpPort}, SSL=${httpsPort}
# PHP Version: ${phpVersion}${networkAccess ? '\n# Network Access: ENABLED - accessible from local network' : ''}${canUsePort80 ? '\n# Port 80 (first-come-first-served)' : ''}

# HTTP Virtual Host
<VirtualHost ${listenAddress}:${finalHttpPort}>
    ServerName ${project.domain}
    ServerAlias ${serverAlias}
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
      try {
        await this.managers.ssl?.createCertificate(project.domains);
        // Re-check if certificates were created successfully
        certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);
      } catch (error) {
        this.managers.log?.systemWarn(`Failed to create SSL certificates for ${project.domain}`, { error: error.message });
      }
    }

    if (project.ssl && !certsExist) {
      this.managers.log?.systemWarn(`SSL enabled for ${project.domain} but certificates not found at ${sslDir}. Skipping SSL block.`);
    }

    // Add HTTPS virtual host if SSL is enabled and certs exist
    if (project.ssl && certsExist) {
      const listenAddressSsl = networkAccess ? '0.0.0.0' : '*';
      config += `
# HTTPS Virtual Host (SSL) - Port ${httpsPort}
<VirtualHost ${listenAddressSsl}:${httpsPort}>
    ServerName ${project.domain}
    ServerAlias ${serverAlias}
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

    // Save config file
    const configPath = path.join(vhostsDir, `${project.id}.conf`);
    await fs.writeFile(configPath, config);

    // Ensure logs directory exists
    await fs.ensureDir(path.join(dataPath, 'apache', 'logs'));

    return configPath;
  }

  /**
   * Validate domain name to prevent command injection
   * Only allows safe characters that are valid in domain names
   * @param {string} domain - The domain to validate
   * @returns {boolean} True if domain is valid and safe
   */
  validateDomainName(domain) {
    if (!domain || typeof domain !== 'string') {
      return false;
    }

    // Strict domain validation - only alphanumeric, hyphens, and dots
    // Must start and end with alphanumeric
    const domainPattern = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

    if (!domainPattern.test(domain)) {
      this.managers.log?.systemWarn('Invalid domain name rejected', { domain: domain.substring(0, 50) });
      return false;
    }

    // Additional safety: block any shell metacharacters
    const dangerousChars = /[;&|`$(){}[\]<>\\'"!#~*?]/;
    if (dangerousChars.test(domain)) {
      this.managers.log?.systemWarn('Domain contains dangerous characters', { domain: domain.substring(0, 50) });
      return false;
    }

    return true;
  }

  // Add domain to hosts file (requires admin privileges)
  async addToHostsFile(domain) {
    if (!domain) return;

    // Security: Validate domain before using in any commands
    if (!this.validateDomainName(domain)) {
      this.managers.log?.systemWarn('Rejected invalid domain for hosts file', { domain: domain.substring(0, 50) });
      return { success: false, error: 'Invalid domain name format' };
    }

    const hostsPath = process.platform === 'win32'
      ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
      : '/etc/hosts';

    try {
      const hostsContent = await fs.readFile(hostsPath, 'utf-8');

      // Check if domain already exists (check both with and without www)
      // Escape dots for regex
      const escapedDomain = domain.replace(/\./g, '\\.');
      const domainRegex = new RegExp(`^\\s*127\\.0\\.0\\.1\\s+${escapedDomain}\\s*$`, 'm');
      if (domainRegex.test(hostsContent)) {
        return { success: true, alreadyExists: true };
      }

      // Entries to add - domain already validated, safe to use
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

      const { app } = require('electron');
      const tempDir = app.getPath('temp');

      if (process.platform === 'win32') {
        // Security: Write entries to a temp file first, then use type command to append
        // This avoids shell interpretation of the domain content
        const tempEntriesPath = path.join(tempDir, 'devbox-hosts-entries.txt');
        const scriptPath = path.join(tempDir, 'devbox-hosts-update.bat');

        // Write the entries directly to a file (no shell involved)
        await fs.writeFile(tempEntriesPath, '\r\n' + entries.join('\r\n') + '\r\n', 'utf8');

        // Create batch script that uses type to append the file content
        const batchContent = `type "${tempEntriesPath}" >> "${hostsPath}"`;
        await fs.writeFile(scriptPath, batchContent);

        return new Promise((resolve) => {
          sudo.exec(`cmd /c "${scriptPath}"`, options, async (error, stdout, stderr) => {
            // Clean up temp files
            try { await fs.remove(scriptPath); } catch (e) { }
            try { await fs.remove(tempEntriesPath); } catch (e) { }

            if (error) {
              this.managers.log?.systemWarn(`Could not update hosts file automatically`, { error: error.message });
              resolve({ success: false, error: error.message });
            } else {
              resolve({ success: true });
            }
          });
        });
      } else {
        // On macOS/Linux, write entries to temp file and use cat to append
        const tempEntriesPath = path.join(tempDir, 'devbox-hosts-entries.txt');

        // Write entries directly to file (no shell involved)
        await fs.writeFile(tempEntriesPath, '\n' + entries.join('\n') + '\n', 'utf8');

        // Use cat with proper escaping - the temp file path is trusted
        const command = `cat "${tempEntriesPath}" >> "${hostsPath}"`;

        return new Promise((resolve) => {
          sudo.exec(command, options, async (error, stdout, stderr) => {
            // Clean up temp file
            try { await fs.remove(tempEntriesPath); } catch (e) { }

            if (error) {
              this.managers.log?.systemWarn(`Could not update hosts file automatically`, { error: error.message });
              resolve({ success: false, error: error.message });
            } else {
              resolve({ success: true });
            }
          });
        });
      }
    } catch (error) {
      this.managers.log?.systemWarn(`Could not read hosts file`, { error: error.message });
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
              try { await fs.remove(tempHostsPath); } catch (e) { }

              if (error) {
                this.managers.log?.systemWarn(`Could not remove ${domain} from hosts file`, { error: error.message });
                resolve({ success: false, error: error.message });
              } else {
                // Domain removed from hosts file
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
              try { await fs.remove(tempHostsPath); } catch (e) { }

              if (error) {
                this.managers.log?.systemWarn(`Could not remove ${domain} from hosts file`, { error: error.message });
                resolve({ success: false, error: error.message });
              } else {
                // Domain removed from hosts file
                resolve({ success: true });
              }
            });
          });
        }
      }

      return { success: true, nothingToRemove: true };
    } catch (error) {
      this.managers.log?.systemWarn(`Could not update hosts file`, { error: error.message });
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

    // Virtual host removed
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
      // Stopping old web server - no other projects using it
      try {
        await this.managers.service?.stopService(oldWebServer);
        // Wait for ports to be fully released
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        this.managers.log?.systemWarn(`Could not stop ${oldWebServer}`, { error: error.message });
      }
    } else {
      // Other projects still using old web server - keeping it running
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
      // Projects directory not configured or does not exist
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
      this.managers.log?.systemError('Error scanning for unregistered projects', { error: error.message });
    }

    // Found unregistered projects in scanning
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
        this.managers.log?.systemWarn('Could not create database', { error: error.message });
      }
    }

    // Create SSL certificate
    try {
      await this.managers.ssl?.createCertificate(project.domains);
    } catch (error) {
      this.managers.log?.systemWarn('Could not create SSL certificate', { error: error.message });
    }

    // Create virtual host configuration
    try {
      await this.createVirtualHost(project);
    } catch (error) {
      this.managers.log?.systemWarn('Could not create virtual host', { error: error.message });
    }

    // Add domain to hosts file
    try {
      await this.addToHostsFile(project.domain);
    } catch (error) {
      this.managers.log?.systemWarn('Could not update hosts file', { error: error.message });
    }

    // Save project
    existingProjects.push(project);
    this.configStore.set('projects', existingProjects);

    // Auto-install CLI if not already installed
    await this.ensureCliInstalled();

    // Existing project registered successfully
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

  /**
   * Check for compatibility rule updates from remote config
   * @returns {Object} Update check result
   */
  async checkCompatibilityUpdates() {
    return this.compatibilityManager.checkForUpdates();
  }

  /**
   * Apply compatibility rule updates from remote config
   * @returns {Object} Apply result
   */
  async applyCompatibilityUpdates() {
    return this.compatibilityManager.applyUpdates();
  }

  /**
   * Get compatibility config info
   * @returns {Object} Config info
   */
  getCompatibilityConfigInfo() {
    return this.compatibilityManager.getConfigInfo();
  }
}

module.exports = { ProjectManager };
