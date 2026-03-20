const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  async scanUnregisteredProjects() {
    const settings = this.configStore.get('settings', {});
    const projectsDir = settings.defaultProjectsPath;

    if (!projectsDir || !(await fs.pathExists(projectsDir))) {
      return [];
    }

    const registeredPaths = this.getAllProjects().map((project) =>
      path.normalize(project.path).toLowerCase()
    );

    const unregistered = [];

    try {
      const entries = await fs.readdir(projectsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;

        const fullPath = path.join(projectsDir, entry.name);
        const normalizedPath = path.normalize(fullPath).toLowerCase();

        if (registeredPaths.includes(normalizedPath)) continue;

        const isPhpProject = await this.looksLikePhpProject(fullPath);
        if (!isPhpProject) continue;

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

    return unregistered;
  },

  async looksLikePhpProject(folderPath) {
    try {
      const indicators = [
        'composer.json',
        'index.php',
        'wp-config.php',
        'wp-config-sample.php',
        'artisan',
        'public/index.php',
        'bin/console',
      ];

      for (const indicator of indicators) {
        if (await fs.pathExists(path.join(folderPath, indicator))) {
          return true;
        }
      }

      const entries = await fs.readdir(folderPath);
      return entries.some((entry) => entry.endsWith('.php'));
    } catch {
      return false;
    }
  },

  async registerExistingProject(config) {
    const id = uuidv4();
    const settings = this.configStore.get('settings', {});
    const existingProjects = this.configStore.get('projects', []);
    const projectServices = config.services || {};

    if (!config.path || !config.path.trim()) {
      throw new Error('Project path is required. Please choose an existing project folder to import.');
    }

    if (!config.name || !config.name.trim()) {
      throw new Error('Project name is required.');
    }

    const existingProject = this.findProjectByPath(existingProjects, config.path);
    if (existingProject) {
      throw new Error(`This folder is already registered as project "${existingProject.name}".`);
    }

    const sameNameProject = this.findProjectByName(existingProjects, config.name);
    if (sameNameProject) {
      throw new Error(`A project with the name "${config.name}" already exists.\n\nPlease choose a different name.`);
    }

    const usedPorts = existingProjects.map((project) => project.port);
    let port = settings.portRangeStart || 8000;
    while (usedPorts.includes(port)) {
      port += 1;
    }

    let sslPort = 443;
    const usedSslPorts = existingProjects.map((project) => project.sslPort).filter(Boolean);
    while (usedSslPorts.includes(sslPort)) {
      sslPort += 1;
    }

    const projectType = config.type || (await this.detectProjectType(config.path));
    const defaultTld = settings.defaultTld || 'test';
    const domainName = config.domain || `${config.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.${defaultTld}`;
    const webServer = config.webServer || settings.webServer || 'nginx';
    const webServerVersion = config.webServerVersion || this.getDefaultWebServerVersion(webServer);

    const project = {
      id,
      name: config.name,
      path: config.path,
      type: projectType,
      phpVersion: config.phpVersion || '8.3',
      webServer,
      webServerVersion,
      port,
      sslPort,
      domain: domainName,
      domains: [domainName],
      ssl: config.ssl !== false,
      autoStart: config.autoStart || false,
      services: {
        mysql: projectServices.mysql || config.database === 'mysql',
        mysqlVersion: projectServices.mysqlVersion || '8.4',
        mariadb: projectServices.mariadb || config.database === 'mariadb',
        mariadbVersion: projectServices.mariadbVersion || '11.4',
        redis: projectServices.redis || false,
        redisVersion: projectServices.redisVersion || '7.4',
        queue: projectServices.queue || false,
        nodejs: projectType === 'nodejs' ? true : (projectServices.nodejs || false),
        nodejsVersion: projectServices.nodejsVersion || config.nodeVersion || '20',
        postgresql: projectServices.postgresql || false,
        postgresqlVersion: projectServices.postgresqlVersion || '17',
        mongodb: projectServices.mongodb || false,
        mongodbVersion: projectServices.mongodbVersion || '8.0',
        python: projectServices.python || false,
        pythonVersion: projectServices.pythonVersion || '3.13',
        memcached: projectServices.memcached || false,
        memcachedVersion: projectServices.memcachedVersion || '1.6',
        minio: projectServices.minio || false,
      },
      environment: this.getDefaultEnvironment(projectType, config.name, port),
      supervisor: {
        workers: 1,
        processes: [],
      },
      documentRoot: config.documentRoot || '',
      nodePort: projectType === 'nodejs' ? (config.nodePort || 3000) : undefined,
      nodeStartCommand: projectType === 'nodejs' ? (config.nodeStartCommand || 'npm start') : undefined,
      nodeFramework: projectType === 'nodejs' ? (config.nodeFramework || '') : undefined,
      createdAt: new Date().toISOString(),
      lastStarted: null,
    };

    if (project.services.mysql || project.services.mariadb) {
      const dbName = this.sanitizeDatabaseName(config.name);
      project.environment.DB_DATABASE = dbName;

      try {
        const dbVersion = project.services.mariadb ? project.services.mariadbVersion : project.services.mysqlVersion;
        await this.managers.database?.createDatabase(dbName, dbVersion);
      } catch (error) {
        this.managers.log?.systemWarn('Could not create database', { error: error.message });
      }
    }

    if (project.ssl) {
      try {
        await this.managers.ssl?.createCertificate(project.domains);
      } catch (error) {
        this.managers.log?.systemWarn('Could not create SSL certificate', { error: error.message });
      }
    }

    try {
      await this.createVirtualHost(project);
    } catch (error) {
      this.managers.log?.systemWarn('Could not create virtual host', { error: error.message });
    }

    try {
      await this.addToHostsFile(project.domain);
    } catch (error) {
      this.managers.log?.systemWarn('Could not update hosts file', { error: error.message });
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

    existingProjects.push(project);
    this.configStore.set('projects', existingProjects);

    await this.ensureCliInstalled();

    return project;
  },
};
