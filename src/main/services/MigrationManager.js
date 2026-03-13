const fs = require('fs-extra');
const os = require('os');
const path = require('path');

class MigrationManager {
  constructor(pathResolver, app) {
    this.pathResolver = pathResolver;
    this.app = app;
    this.portableRoot = pathResolver.getPortableRoot(app);
    this.newDataPath = pathResolver.getDataPath(app);
    this.newResourcesPath = pathResolver.getResourcesPath(app);
    this.oldDataPath = path.join(os.homedir(), '.devbox-pro');
    this.oldResourcesPath = path.join(app.getPath('userData'), 'resources');
    this.legacyUserDataPath = path.join(app.getPath('userData'), 'data');
  }

  getLegacyInstallMigrationMarkerPath() {
    return path.join(this.newDataPath, 'legacy-install-migration.v2.done');
  }

  getMigrationMarkerPath() {
    return path.join(this.newDataPath, 'migration.done');
  }

  getRegenerationPendingPath() {
    return path.join(this.newDataPath, 'config-regeneration.pending');
  }

  getConfigRegeneratedMarkerPath() {
    return path.join(this.newDataPath, 'config-regenerated.flag');
  }

  getLegacyInstallRoots() {
    const roots = [];
    const exePath = typeof this.app?.getPath === 'function' ? this.app.getPath('exe') : '';
    const exeDir = exePath ? path.dirname(exePath) : null;

    if (exeDir) {
      roots.push(exeDir);
    }

    if (process.platform === 'win32') {
      const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
      const localPrograms = path.join(localAppData, 'Programs');
      const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
      const programFilesX86 = process.env['ProgramFiles(x86)'];

      roots.push(
        path.join(localPrograms, 'DevBox Pro'),
        path.join(localPrograms, 'DevBoxPro'),
        path.join(programFiles, 'DevBox Pro'),
        path.join(programFiles, 'DevBoxPro')
      );

      if (programFilesX86) {
        roots.push(
          path.join(programFilesX86, 'DevBox Pro'),
          path.join(programFilesX86, 'DevBoxPro')
        );
      }
    }

    return [...new Set(roots.filter(Boolean))];
  }

  async getLegacyInstallSources() {
    const sources = [];

    const legacyUserDataPath = this.legacyUserDataPath;
    const legacyUserDataResourcesPath = path.join(this.app.getPath('userData'), 'resources');
    const hasLegacyUserData = await fs.pathExists(legacyUserDataPath);
    const hasLegacyUserDataResources = await fs.pathExists(legacyUserDataResourcesPath)
      && path.resolve(legacyUserDataResourcesPath) !== path.resolve(this.newResourcesPath);

    if (hasLegacyUserData || hasLegacyUserDataResources) {
      sources.push({
        root: this.app.getPath('userData'),
        dataPath: legacyUserDataPath,
        resourcesPath: legacyUserDataResourcesPath,
        hasData: hasLegacyUserData && path.resolve(legacyUserDataPath) !== path.resolve(this.newDataPath),
        hasResources: hasLegacyUserDataResources,
      });
    }

    for (const root of this.getLegacyInstallRoots()) {
      const dataPath = path.join(root, 'data');
      const resourcesPath = path.join(root, 'resources-user');
      const hasData = await fs.pathExists(dataPath);
      const hasResources = await fs.pathExists(resourcesPath);

      if (!hasData && !hasResources) {
        continue;
      }

      if (path.resolve(dataPath) === path.resolve(this.newDataPath) || path.resolve(resourcesPath) === path.resolve(this.newResourcesPath)) {
        continue;
      }

      sources.push({ root, dataPath, resourcesPath, hasData, hasResources });
    }

    return sources.filter((source) => source.hasData || source.hasResources);
  }

  async needsLegacyInstallMigration() {
    if (await fs.pathExists(this.getLegacyInstallMigrationMarkerPath())) {
      return false;
    }

    const sources = await this.getLegacyInstallSources();
    return sources.length > 0;
  }

  async migrateLegacyInstallData(onProgress) {
    const sources = await this.getLegacyInstallSources();
    if (sources.length === 0) {
      await this.markLegacyInstallMigrationDone();
      return false;
    }

    await fs.ensureDir(this.newDataPath);
    await fs.ensureDir(this.newResourcesPath);

    for (const source of sources) {
      if (source.hasData) {
        onProgress?.(`Importing existing DevBox data from ${source.root}...`);
        await fs.copy(source.dataPath, this.newDataPath, { overwrite: false });
      }

      if (source.hasResources) {
        onProgress?.(`Importing downloaded binaries from ${source.root}...`);
        await fs.copy(source.resourcesPath, this.newResourcesPath, { overwrite: false });
      }
    }

    await this.markConfigRegenerationPending();
    await this.markLegacyInstallMigrationDone();
    return true;
  }

  async needsMigration() {
    if (!this.portableRoot) {
      return false;
    }

    if (await fs.pathExists(this.getMigrationMarkerPath())) {
      return false;
    }

    return fs.pathExists(this.oldDataPath);
  }

  async migrate(onProgress) {
    await fs.ensureDir(this.newDataPath);
    await fs.ensureDir(this.newResourcesPath);

    const skippedDbDirs = ['mysql/data', 'postgresql', 'mongodb'];

    onProgress?.('Copying configuration and project data...');
    await fs.copy(this.oldDataPath, this.newDataPath, {
      overwrite: false,
      filter: (sourcePath) => !skippedDbDirs.some((dir) => sourcePath.includes(dir)),
    });

    if (await fs.pathExists(this.oldResourcesPath)) {
      onProgress?.('Copying downloaded binaries...');
      await fs.copy(this.oldResourcesPath, this.newResourcesPath, { overwrite: false });
    }

    await this.markConfigRegenerationPending();
    await this.markDone();
  }

  async markDone() {
    await fs.ensureDir(this.newDataPath);
    await fs.outputFile(this.getMigrationMarkerPath(), new Date().toISOString());
  }

  async markLegacyInstallMigrationDone() {
    await fs.ensureDir(this.newDataPath);
    await fs.outputFile(this.getLegacyInstallMigrationMarkerPath(), new Date().toISOString());
  }

  async markConfigRegenerationPending() {
    await fs.ensureDir(this.newDataPath);
    await fs.outputFile(this.getRegenerationPendingPath(), new Date().toISOString());
  }

  async needsConfigRegeneration() {
    const hasPortableMigration = await fs.pathExists(this.getMigrationMarkerPath());
    const hasLegacyInstallMigration = await fs.pathExists(this.getLegacyInstallMigrationMarkerPath());

    if (!hasPortableMigration && !hasLegacyInstallMigration) {
      return false;
    }

    if (await fs.pathExists(this.getConfigRegeneratedMarkerPath())) {
      return false;
    }

    return fs.pathExists(this.getRegenerationPendingPath());
  }

  async markConfigRegenerated() {
    await fs.ensureDir(this.newDataPath);
    await fs.outputFile(this.getConfigRegeneratedMarkerPath(), new Date().toISOString());
    await fs.remove(this.getRegenerationPendingPath());
  }

  async regenerateConfigs(managers) {
    const configStore = managers?.config;
    const projectManager = managers?.project;
    const serviceManager = managers?.service;

    if (!configStore || !projectManager || !serviceManager) {
      throw new Error('Managers not initialized for config regeneration');
    }

    const projects = configStore.get('projects', []);
    const dataPath = configStore.getDataPath();
    const resourcesPath = configStore.getResourcesPath();

    const nginxProjects = projects.filter((project) => (project.webServer || 'nginx') === 'nginx');
    const apacheProjects = projects.filter((project) => project.webServer === 'apache');

    const nginxVersions = [...new Set(nginxProjects.map((project) => project.webServerVersion || '1.28'))];
    for (const version of nginxVersions) {
      const nginxPath = serviceManager.getNginxPath(version);
      if (!await fs.pathExists(nginxPath)) {
        continue;
      }

      const ports = serviceManager.getServicePorts('nginx', version);
      const versionDataPath = path.join(dataPath, 'nginx', version);
      const confPath = path.join(versionDataPath, 'nginx.conf');
      const logsPath = path.join(versionDataPath, 'logs');
      await fs.ensureDir(path.join(versionDataPath, 'sites'));
      await fs.ensureDir(logsPath);
      await fs.emptyDir(path.join(versionDataPath, 'sites'));
      await serviceManager.createNginxConfig(confPath, logsPath, ports?.httpPort || 80, ports?.sslPort || 443, version);
    }

    const apacheVersion = apacheProjects[0]?.webServerVersion || '2.4';
    const apachePath = serviceManager.getApachePath(apacheVersion);
    if (await fs.pathExists(apachePath)) {
      const ports = serviceManager.getServicePorts('apache', apacheVersion);
      const confPath = path.join(dataPath, 'apache', 'httpd.conf');
      const logsPath = path.join(dataPath, 'apache', 'logs');
      const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
      await fs.ensureDir(logsPath);
      await fs.ensureDir(vhostsDir);
      await fs.emptyDir(vhostsDir);
      await serviceManager.createApacheConfig(apachePath, confPath, logsPath, ports?.httpPort || 8081, ports?.sslPort || 8444);
    }

    for (const project of nginxProjects) {
      await projectManager.createNginxVhost(project, null, project.webServerVersion || '1.28');
    }

    for (const project of apacheProjects) {
      await projectManager.createApacheVhost(project, project.webServerVersion || '2.4');
    }

    const phpRoot = path.join(resourcesPath, 'php');
    if (await fs.pathExists(phpRoot) && managers.php?.phpVersions) {
      for (const [version, info] of Object.entries(managers.php.phpVersions)) {
        if (!info?.path || !await fs.pathExists(info.path)) {
          continue;
        }

        try {
          await managers.php.createDefaultIni(info.path, version);
        } catch (error) {
          managers.log?.systemWarn(`Could not regenerate php.ini for PHP ${version}`, { error: error.message });
        }
      }
    }

    await this.markConfigRegenerated();
  }
}

module.exports = { MigrationManager };