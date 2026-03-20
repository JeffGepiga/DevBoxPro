const path = require('path');
const fs = require('fs-extra');
const { getDefaultVersion } = require('../../../shared/serviceConfig');

const DEFAULT_DATABASE_VERSIONS = {
  mysql: '8.4',
  mariadb: '11.4',
};

const DEFAULT_DATABASE_PORTS = {
  mysql: 3306,
  mariadb: 3310,
};

module.exports = {
  getDataPath() {
    if (typeof this.configStore.getDataPath === 'function') {
      return this.configStore.getDataPath();
    }

    if (typeof this.configStore.get === 'function') {
      const configuredDataPath = this.configStore.get('dataPath');
      if (configuredDataPath) {
        return configuredDataPath;
      }
    }

    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'data');
  },

  getResourcesPath() {
    if (typeof this.configStore.getResourcesPath === 'function') {
      return this.configStore.getResourcesPath();
    }

    if (typeof this.configStore.get === 'function') {
      const configuredResourcePath = this.configStore.get('resourcePath');
      if (configuredResourcePath) {
        return configuredResourcePath;
      }
    }

    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'resources');
  },

  getProjectDatabaseSelection(project = {}) {
    const services = project?.services || {};
    const explicitDatabase = project?.database;
    const activeDatabaseInfo = this.managers?.database?.getDatabaseInfo?.() || {};

    if (services.mariadb || explicitDatabase === 'mariadb') {
      return {
        type: 'mariadb',
        version: services.mariadbVersion || DEFAULT_DATABASE_VERSIONS.mariadb,
        explicit: true,
      };
    }

    if (services.mysql || explicitDatabase === 'mysql') {
      return {
        type: 'mysql',
        version: services.mysqlVersion || DEFAULT_DATABASE_VERSIONS.mysql,
        explicit: true,
      };
    }

    const activeType = activeDatabaseInfo.type || 'mysql';
    return {
      type: activeType,
      version: activeDatabaseInfo.version || DEFAULT_DATABASE_VERSIONS[activeType] || DEFAULT_DATABASE_VERSIONS.mysql,
      explicit: false,
    };
  },

  getProjectDatabaseConfig(project = {}) {
    const settings = this.configStore?.get('settings', {}) || {};
    const activeDatabaseInfo = this.managers?.database?.getDatabaseInfo?.() || {};
    const serviceManager = this.managers?.service;
    const selection = this.getProjectDatabaseSelection(project);
    const dbType = selection.type;
    const dbVersion = selection.version;
    const serviceConfig = serviceManager?.serviceConfigs?.[dbType];
    const runningVersionInfo = serviceManager?.runningVersions?.get(dbType)?.get(dbVersion);

    let dbPort = activeDatabaseInfo.port || DEFAULT_DATABASE_PORTS[dbType] || DEFAULT_DATABASE_PORTS.mysql;
    if (selection.explicit) {
      dbPort = runningVersionInfo?.port
        || (serviceManager?.getVersionPort
          ? serviceManager.getVersionPort(dbType, dbVersion, serviceConfig?.defaultPort || DEFAULT_DATABASE_PORTS[dbType] || DEFAULT_DATABASE_PORTS.mysql)
          : (serviceConfig?.defaultPort || DEFAULT_DATABASE_PORTS[dbType] || DEFAULT_DATABASE_PORTS.mysql));
    }

    const dbUser = settings.dbUser || activeDatabaseInfo.user || 'root';
    const dbPassword = settings.dbPassword !== undefined ? settings.dbPassword : (activeDatabaseInfo.password || '');
    const dbName = this.sanitizeDatabaseName(project?.name || 'app');
    const symfonyServerVersion = dbType === 'mariadb' ? `${dbVersion}-MariaDB` : dbVersion;
    const encodedUser = encodeURIComponent(dbUser);
    const encodedPassword = encodeURIComponent(dbPassword);
    const encodedDbName = encodeURIComponent(dbName);
    const encodedServerVersion = encodeURIComponent(symfonyServerVersion);

    return {
      type: dbType,
      version: dbVersion,
      host: '127.0.0.1',
      port: dbPort,
      user: dbUser,
      password: dbPassword,
      database: dbName,
      laravelConnection: 'mysql',
      symfonyDatabaseUrl: `mysql://${encodedUser}:${encodedPassword}@127.0.0.1:${dbPort}/${encodedDbName}?serverVersion=${encodedServerVersion}`,
    };
  },

  getPhpFpmPort(project) {
    const projectId = String(project?.id || '');
    const parsedInt = parseInt(projectId.slice(-4), 16);

    if (!Number.isNaN(parsedInt)) {
      return 9000 + (parsedInt % 1000);
    }

    let hash = 0;
    for (const char of projectId) {
      hash = ((hash << 5) - hash) + char.charCodeAt(0);
      hash |= 0;
    }

    return 9000 + (Math.abs(hash) % 1000);
  },

  getDefaultWebServerVersion(webServer = 'nginx') {
    return getDefaultVersion(webServer);
  },

  getEffectiveWebServer(project) {
    return project?.webServer || 'nginx';
  },

  getEffectiveWebServerVersion(project, webServer = null) {
    const effectiveWebServer = webServer || this.getEffectiveWebServer(project);
    return project?.webServerVersion || this.getDefaultWebServerVersion(effectiveWebServer);
  },

  getProjectDomains(project) {
    const domains = project?.domains?.length ? project.domains : (project?.domain ? [project.domain] : []);
    return [...new Set(domains.filter(Boolean))];
  },

  getProjectPrimaryDomain(project) {
    return this.getProjectDomains(project)[0] || project?.domain || '';
  },

  getProjectServerNameEntries(project, includeCatchAll = false) {
    const primaryDomain = this.getProjectPrimaryDomain(project);
    const domains = this.getProjectDomains(project);

    return [...new Set([
      ...domains,
      primaryDomain ? `www.${primaryDomain}` : null,
      primaryDomain ? `*.${primaryDomain}` : null,
      includeCatchAll ? '_' : null,
    ].filter(Boolean))];
  },

  getProjectServerAliasEntries(project, includeCatchAll = false) {
    const primaryDomain = this.getProjectPrimaryDomain(project);
    const domains = this.getProjectDomains(project);

    return [...new Set([
      primaryDomain ? `www.${primaryDomain}` : null,
      primaryDomain ? `*.${primaryDomain}` : null,
      ...domains.filter((domain) => domain !== primaryDomain),
      includeCatchAll ? '*' : null,
    ].filter(Boolean))];
  },

  getProjectLocalAccessPorts(project) {
    const frontDoorOwner = this.managers.service?.standardPortOwner;
    if (frontDoorOwner) {
      return { httpPort: 80, sslPort: 443 };
    }

    const webServer = this.getEffectiveWebServer(project);
    const webServerVersion = this.getEffectiveWebServerVersion(project, webServer);
    const servicePorts = this.managers.service?.getServicePorts(webServer, webServerVersion) || { httpPort: 80, sslPort: 443 };

    if (project?.networkAccess && this.networkPort80Owner !== project?.id && project?.port) {
      return {
        httpPort: project.port,
        sslPort: servicePorts.sslPort || 443,
      };
    }

    return servicePorts;
  },

  async ensureProjectSslCertificates(project, sslDir) {
    const certPath = path.join(sslDir, 'cert.pem');
    const keyPath = path.join(sslDir, 'key.pem');
    let certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);

    if (project.ssl && certsExist && this.managers.ssl?.certificateMatchesCurrentCA) {
      const matchesCurrentCA = await this.managers.ssl.certificateMatchesCurrentCA(project.domain);
      if (!matchesCurrentCA) {
        certsExist = false;
        this.managers.log?.systemWarn(`Regenerating SSL certificate for ${project.domain} because it does not match the current DevBox Root CA`);
      }
    }

    if (project.ssl && !certsExist) {
      try {
        await this.managers.ssl?.createCertificate(project.domains || [project.domain]);
        certsExist = await fs.pathExists(certPath) && await fs.pathExists(keyPath);
      } catch (error) {
        this.managers.log?.systemWarn(`Failed to create SSL certificates for ${project.domain}`, { error: error.message });
      }
    }

    return certsExist;
  },

  getProjectProxyBackendHttpPort(project) {
    const webServer = this.getEffectiveWebServer(project);
    const projectVersion = this.getEffectiveWebServerVersion(project, webServer);
    const servicePorts = this.managers.service?.getServicePorts(webServer, projectVersion);
    const fallbackHttpPort = webServer === 'apache' ? 8084 : 8081;
    const serviceHttpPort = servicePorts?.httpPort || fallbackHttpPort;

    if (!project?.networkAccess) {
      return serviceHttpPort;
    }

    return project?.port || serviceHttpPort;
  },

  getFrontDoorOwner() {
    const webServer = this.managers.service?.standardPortOwner;
    if (!webServer) {
      return null;
    }

    return {
      webServer,
      version: this.managers.service?.standardPortOwnerVersion || this.getDefaultWebServerVersion(webServer),
    };
  },

  frontDoorServesProjectDirectly(project) {
    const frontDoorOwner = this.getFrontDoorOwner();
    if (!frontDoorOwner) {
      return false;
    }

    const projectWebServer = this.getEffectiveWebServer(project);
    const projectVersion = this.getEffectiveWebServerVersion(project, projectWebServer);

    return frontDoorOwner.webServer === projectWebServer && frontDoorOwner.version === projectVersion;
  },

  projectNeedsFrontDoorProxy(project) {
    return Boolean(this.getFrontDoorOwner()) && !this.frontDoorServesProjectDirectly(project);
  },

  async ensureApacheListenConfig(project, vhostResult, targetApacheVersion = null) {
    const needsConfigRegen = vhostResult?.networkAccess
      && vhostResult?.finalHttpPort !== vhostResult?.httpPort;

    if (!needsConfigRegen) {
      return;
    }

    try {
      const serviceManager = this.managers.service;
      const apacheVersion = targetApacheVersion
        || serviceManager?.serviceStatus?.get('apache')?.version
        || this.getEffectiveWebServerVersion(project, 'apache');
      const apachePath = serviceManager?.getApachePath(apacheVersion);
      const dataPath = this.getDataPath();
      const confPath = path.join(dataPath, 'apache', 'httpd.conf');
      const logsPath = path.join(dataPath, 'apache', 'logs');
      const ports = serviceManager?.getServicePorts('apache', apacheVersion);

      if (!apachePath || !confPath) {
        return;
      }

      await serviceManager.createApacheConfig(
        apachePath,
        confPath,
        logsPath,
        ports?.httpPort || 80,
        ports?.sslPort || 443,
        [vhostResult.finalHttpPort]
      );
      this.managers.log?.systemInfo(`Regenerated httpd.conf to include Listen for port ${vhostResult.finalHttpPort}`);
    } catch (error) {
      this.managers.log?.systemWarn('Could not regenerate httpd.conf', { error: error.message });
    }
  },

  async syncProjectLocalProxy(project) {
    const frontDoorOwner = this.getFrontDoorOwner();

    if (!frontDoorOwner || !this.projectNeedsFrontDoorProxy(project)) {
      return false;
    }

    const backendHttpPort = this.getProjectProxyBackendHttpPort(project);
    const ownerVersion = frontDoorOwner.version;

    if (frontDoorOwner.webServer === 'nginx') {
      await this.createProxyNginxVhost(project, backendHttpPort, ownerVersion);
    } else {
      await this.createProxyApacheVhost(project, backendHttpPort, ownerVersion);
    }

    return true;
  },

  getComparableVhostState(project) {
    const webServer = this.getEffectiveWebServer(project);

    return JSON.stringify({
      domain: project?.domain || '',
      domains: this.getProjectDomains(project),
      path: project?.path || '',
      documentRoot: project?.documentRoot || '',
      phpVersion: project?.phpVersion || '',
      ssl: Boolean(project?.ssl),
      networkAccess: Boolean(project?.networkAccess),
      type: project?.type || '',
      port: project?.port || null,
      nodePort: project?.nodePort || null,
      webServer,
      webServerVersion: this.getEffectiveWebServerVersion(project, webServer),
    });
  },

  hasVhostConfigChanges(previousProject, nextProject) {
    return this.getComparableVhostState(previousProject) !== this.getComparableVhostState(nextProject);
  },

  async reloadWebServerConfigIfRunning(webServer, version = null) {
    const serviceManager = this.managers.service;
    if (!serviceManager?.isVersionRunning) {
      return;
    }

    const effectiveVersion = version || this.getDefaultWebServerVersion(webServer);
    if (!serviceManager.isVersionRunning(webServer, effectiveVersion)) {
      return;
    }

    try {
      if (webServer === 'nginx') {
        await serviceManager.reloadNginx(effectiveVersion);
      } else if (webServer === 'apache') {
        await serviceManager.reloadApache(effectiveVersion);
      }
    } catch (error) {
      this.managers.log?.systemWarn(`Could not reload ${webServer} after removing stale vhost config`, { error: error.message });
    }
  },

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
  },

  getProjectUrl(project) {
    const protocol = project.ssl ? 'https' : 'http';
    const domain = this.getProjectPrimaryDomain(project);
    const ports = this.getProjectLocalAccessPorts(project);
    const port = project.ssl ? (ports?.sslPort || 443) : (ports?.httpPort || 80);
    const isDefaultPort = (protocol === 'http' && port === 80) || (protocol === 'https' && port === 443);
    const portSuffix = isDefaultPort ? '' : `:${port}`;

    return `${protocol}://${domain}${portSuffix}`;
  },

  getDocumentRoot(project) {
    if (project.documentRoot) {
      if (project.documentRoot === '/' || project.documentRoot === '.' || project.documentRoot === '') {
        return project.path;
      }
      if (path.isAbsolute(project.documentRoot) && project.documentRoot !== '/') {
        return project.documentRoot;
      }
      return path.join(project.path, project.documentRoot);
    }

    switch (project.type) {
      case 'laravel':
        return path.join(project.path, 'public');
      case 'symfony':
        return path.join(project.path, 'public');
      case 'wordpress':
        return project.path;
      default: {
        const publicPath = path.join(project.path, 'public');
        const wwwPath = path.join(project.path, 'www');
        const webPath = path.join(project.path, 'web');

        if (fs.existsSync(publicPath)) return publicPath;
        if (fs.existsSync(wwwPath)) return wwwPath;
        if (fs.existsSync(webPath)) return webPath;

        return project.path;
      }
    }
  },
};
