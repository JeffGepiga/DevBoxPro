const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const { getPlatformKey, resolvePhpBinaryPath, resolvePhpCgiPath } = require('../../../utils/PhpPathResolver');

module.exports = {
  async createProject(config, mainWindow = null) {
    const settings = this.configStore.get('settings', {});
    const existingProjects = this.configStore.get('projects', []);

    if (!config.path || typeof config.path !== 'string' || !config.path.trim()) {
      throw new Error('Project path is required. Please go back to the Details step and enter a valid project path.');
    }

    if (!config.name || !config.name.trim()) {
      throw new Error('Project name is required.');
    }

    const existingProject = this.findProjectByPath(existingProjects, config.path);
    if (existingProject) {
      if (existingProject.installing || existingProject.installError) {
        const filteredProjects = existingProjects.filter((project) => project.id !== existingProject.id);
        this.configStore.set('projects', filteredProjects);

        if (config.installFresh) {
          try {
            const projectDir = config.path;
            if (await fs.pathExists(projectDir)) {
              const files = await fs.readdir(projectDir);
              const hasVendor = files.includes('vendor');
              const hasArtisan = files.includes('artisan');
              const hasComposerJson = files.includes('composer.json');

              if (hasVendor || hasArtisan || hasComposerJson) {
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

    const projectsAfterCleanup = this.configStore.get('projects', []);
    const sameNameProject = this.findProjectByName(projectsAfterCleanup, config.name);
    if (sameNameProject) {
      throw new Error(`A project with the name "${config.name}" already exists.\n\nPlease choose a different name.`);
    }

    const id = uuidv4();
    const projectType = config.type || (await this.detectProjectType(config.path));
    const resourcePath = this.getResourcesPath();
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';

    if (projectType !== 'nodejs') {
      const phpVersion = config.phpVersion || '8.3';
      const resolvedPlatform = getPlatformKey();
      const phpPath = resolvePhpBinaryPath(resourcePath, phpVersion, resolvedPlatform);
      const phpCgiPath = resolvePhpCgiPath(resourcePath, phpVersion, resolvedPlatform);
      const isPlaywright = process.env.PLAYWRIGHT_TEST === 'true';

      if (!isPlaywright && (!phpPath || !phpCgiPath)) {
        throw new Error(`PHP ${phpVersion} is not installed. Please download it from the Binary Manager before creating a project.`);
      }
    }

    const currentProjects = this.configStore.get('projects', []);
    const usedPorts = currentProjects.map((project) => project.port);
    let port = settings.portRangeStart || 8000;
    while (usedPorts.includes(port)) {
      port++;
    }

    let sslPort = 443;
    const usedSslPorts = currentProjects.map((project) => project.sslPort).filter(Boolean);
    while (usedSslPorts.includes(sslPort)) {
      sslPort++;
    }

    let nodePort = config.nodePort || 3000;
    if (projectType === 'nodejs') {
      const usedNodePorts = currentProjects.map((project) => project.nodePort).filter(Boolean);
      while (usedNodePorts.includes(nodePort)) {
        nodePort++;
      }
    }

    const webServer = config.webServer || settings.webServer || 'nginx';
    let defaultWebServerVersion = this.getDefaultWebServerVersion(webServer);
    const webServerDir = path.join(resourcePath, webServer);
    if (await fs.pathExists(webServerDir)) {
      const installedVersions = (await fs.readdir(webServerDir))
        .filter((version) => !version.includes('.'))
        .sort((left, right) => parseFloat(right) - parseFloat(left));
      if (installedVersions.length > 0) {
        defaultWebServerVersion = installedVersions[0];
      }
    }

    const defaultTld = this.configStore.get('settings.defaultTld', 'test');
    const domainName = config.domain || `${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${defaultTld}`;
    const projectServices = {
      mysql: config.services?.mysql || false,
      mysqlVersion: config.services?.mysqlVersion || '8.4',
      mariadb: config.services?.mariadb || false,
      mariadbVersion: config.services?.mariadbVersion || '11.4',
      redis: config.services?.redis || false,
      redisVersion: config.services?.redisVersion || '7.4',
      queue: config.services?.queue || false,
      nodejs: projectType === 'nodejs' ? true : (config.services?.nodejs || false),
      nodejsVersion: config.services?.nodejsVersion || '20',
      postgresql: config.services?.postgresql || false,
      postgresqlVersion: config.services?.postgresqlVersion || '17',
      mongodb: config.services?.mongodb || false,
      mongodbVersion: config.services?.mongodbVersion || '8.0',
      python: config.services?.python || false,
      pythonVersion: config.services?.pythonVersion || '3.13',
      memcached: config.services?.memcached || false,
      memcachedVersion: config.services?.memcachedVersion || '1.6',
      minio: config.services?.minio || false,
    };

    const project = {
      id,
      name: config.name,
      path: config.path,
      type: projectType,
      phpVersion: config.phpVersion || '8.3',
      webServer,
      webServerVersion: config.webServerVersion || defaultWebServerVersion,
      port,
      sslPort,
      domain: domainName,
      domains: [domainName],
      ssl: config.ssl !== false,
      autoStart: config.autoStart || false,
      services: projectServices,
      environment: this.getDefaultEnvironment(projectType, config.name, port, { services: projectServices, database: config.database }),
      supervisor: {
        workers: config.supervisor?.workers || 1,
        processes: [],
      },
      nodePort: projectType === 'nodejs' ? nodePort : undefined,
      nodeStartCommand: projectType === 'nodejs' ? (config.nodeStartCommand || 'npm start') : undefined,
      nodeFramework: projectType === 'nodejs' ? (config.nodeFramework || '') : undefined,
      createdAt: new Date().toISOString(),
      lastStarted: null,
      compatibilityWarningsAcknowledged: config.compatibilityWarningsAcknowledged || false,
    };

    const compatibilityConfig = {
      phpVersion: project.phpVersion,
      mysqlVersion: project.services.mysql ? project.services.mysqlVersion : null,
      mariadbVersion: project.services.mariadb ? project.services.mariadbVersion : null,
      redisVersion: project.services.redis ? project.services.redisVersion : null,
      nodejsVersion: project.services.nodejs ? project.services.nodejsVersion : null,
      type: project.type,
      installFresh: config.installFresh || false,
    };

    const compatibility = this.compatibilityManager.checkCompatibility(compatibilityConfig);
    project.compatibilityWarnings = compatibility.warnings || [];

    if (project.services.mysql || project.services.mariadb) {
      const dbName = this.sanitizeDatabaseName(config.name);
      project.environment.DB_DATABASE = dbName;

      try {
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

    if (project.ssl) {
      try {
        await this.managers.ssl?.createCertificate(project.domains);
      } catch (error) {
        this.managers.log?.systemWarn('Could not create SSL certificate', { project: config.name, error: error.message });
      }
    }

    if (!config.installFresh && config.projectSource !== 'clone') {
      try {
        await this.createVirtualHost(project);
      } catch (error) {
        this.managers.log?.systemWarn('Could not create virtual host', { project: config.name, error: error.message });
      }
    }

    try {
      await this.addToHostsFile(project.domain);
    } catch (error) {
      this.managers.log?.systemWarn('Could not update hosts file', { project: config.name, error: error.message });
    }

    if (project.services.queue && project.type === 'laravel') {
      project.supervisor.processes.push({
        name: 'queue-worker',
        command: 'php artisan queue:work',
        autostart: true,
        autorestart: true,
        numprocs: project.supervisor.workers,
      });
    }

    if (project.type === 'nodejs') {
      const nodejsVersion = project.services?.nodejsVersion || '20';
      const nodeResourcePath = this.getResourcesPath();
      const nodePlatform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
      const nodeDir = path.join(nodeResourcePath, 'nodejs', nodejsVersion, nodePlatform);
      project.supervisor.processes.push({
        name: 'nodejs-app',
        command: project.nodeStartCommand || 'npm start',
        autostart: true,
        autorestart: true,
        numprocs: 1,
        environment: {
          PORT: String(project.nodePort || 3000),
          NODE_PATH: nodeDir,
        },
      });
    }

    const shouldInstall = config.installFresh || config.projectSource === 'clone' || projectType === 'nodejs';
    if (shouldInstall) {
      project.installing = true;
      project.cloneConfig = config.projectSource === 'clone'
        ? {
            repositoryUrl: config.repositoryUrl,
            authType: config.authType || 'public',
            accessToken: config.accessToken,
          }
        : null;
    }

    const projectsToSave = this.configStore.get('projects', []);
    projectsToSave.push(project);
    this.configStore.set('projects', projectsToSave);

    await this.ensureCliInstalled();

    if (shouldInstall) {
      this.runInstallation(project, mainWindow).catch((error) => {
        this.managers.log?.systemError('Background installation failed', { project: project.name, error: error.message });
      });
    }

    return project;
  },

  updateProjectInStore(project) {
    const projects = this.configStore.get('projects', []);
    const index = projects.findIndex((entry) => entry.id === project.id);
    if (index !== -1) {
      projects[index] = project;
      this.configStore.set('projects', projects);
    }
  },
};