const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async createVirtualHost(project, phpFpmPort = null, targetVersion = null) {
    const webServer = project.webServer || this.configStore.get('settings.webServer', 'nginx');

    if (webServer === 'nginx') {
      await this.createNginxVhost(project, phpFpmPort, targetVersion);
      const proxied = await this.syncProjectLocalProxy(project);

      try {
        await this.managers.service?.reloadNginx(targetVersion);
        if (proxied) {
          const frontDoorOwner = this.getFrontDoorOwner();
          if (frontDoorOwner && (frontDoorOwner.webServer !== 'nginx' || frontDoorOwner.version !== targetVersion)) {
            if (frontDoorOwner.webServer === 'apache') {
              await this.managers.service?.reloadApache(frontDoorOwner.version);
            } else {
              await this.managers.service?.reloadNginx(frontDoorOwner.version);
            }
          }
        }
        if (process.platform === 'win32') {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        this.managers.log?.systemWarn('Could not reload/restart nginx', { error: error.message });
      }
      return;
    }

    const result = await this.createApacheVhost(project, targetVersion);
    const proxied = await this.syncProjectLocalProxy(project);
    await this.ensureApacheListenConfig(project, result, targetVersion);

    try {
      await this.managers.service?.reloadApache();
      if (proxied) {
        const frontDoorOwner = this.getFrontDoorOwner();
        if (frontDoorOwner && (frontDoorOwner.webServer !== 'apache' || frontDoorOwner.version !== targetVersion)) {
          if (frontDoorOwner.webServer === 'nginx') {
            await this.managers.service?.reloadNginx(frontDoorOwner.version);
          } else {
            await this.managers.service?.reloadApache(frontDoorOwner.version);
          }
        }
      }
    } catch (error) {
      this.managers.log?.systemWarn('Could not reload Apache', { error: error.message });
    }
  },

  async regenerateAllApacheVhosts(excludeProjectId = null, targetApacheVersion = null) {
    const allProjects = this.configStore.get('projects', []);
    const dataPath = this.getDataPath();
    const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
    const apacheOwnsFrontDoor = this.managers.service?.standardPortOwner === 'apache';
    const frontDoorOwner = this.getFrontDoorOwner();
    const apacheFrontDoorVersion = apacheOwnsFrontDoor ? frontDoorOwner?.version : null;

    for (const proj of allProjects) {
      if (proj.id === excludeProjectId) continue;
      const webServer = this.getEffectiveWebServer(proj);
      if (webServer !== 'apache' && !apacheOwnsFrontDoor) continue;

      const confFile = path.join(vhostsDir, `${proj.id}.conf`);
      const projectRunning = this.runningProjects.has(proj.id);
      const shouldProxyThroughApache = apacheOwnsFrontDoor
        && apacheFrontDoorVersion === targetApacheVersion
        && projectRunning
        && this.projectNeedsFrontDoorProxy(proj);
      const confExists = await fs.pathExists(confFile);
      const shouldCreateDirectApache = webServer === 'apache' && projectRunning;

      if (!confExists && !shouldProxyThroughApache && !shouldCreateDirectApache) continue;

      try {
        if (shouldCreateDirectApache) {
          await this.createApacheVhost(proj, targetApacheVersion);
        } else if (shouldProxyThroughApache) {
          await this.createProxyApacheVhost(proj, this.getProjectProxyBackendHttpPort(proj), targetApacheVersion);
        }
      } catch (error) {
        this.managers.log?.systemWarn(`Could not regenerate Apache vhost for ${proj.name}`, { error: error.message });
      }
    }
  },

  async regenerateAllNginxVhosts(excludeProjectId = null, targetNginxVersion = null) {
    const allProjects = this.configStore.get('projects', []);
    const dataPath = this.getDataPath();
    const effectiveVersion = targetNginxVersion || this.getDefaultWebServerVersion('nginx');
    const sitesDir = path.join(dataPath, 'nginx', effectiveVersion, 'sites');
    const nginxOwnsFrontDoor = this.managers.service?.standardPortOwner === 'nginx';
    const frontDoorOwner = this.getFrontDoorOwner();
    const nginxFrontDoorVersion = nginxOwnsFrontDoor ? frontDoorOwner?.version : null;

    for (const proj of allProjects) {
      if (proj.id === excludeProjectId) continue;
      const webServer = this.getEffectiveWebServer(proj);
      if (webServer !== 'nginx' && !nginxOwnsFrontDoor) continue;

      const projVersion = this.getEffectiveWebServerVersion(proj, 'nginx');
      if (webServer === 'nginx' && projVersion !== effectiveVersion) continue;

      const confFile = path.join(sitesDir, `${proj.id}.conf`);
      const projectRunning = this.runningProjects.has(proj.id);
      const shouldProxyThroughNginx = nginxOwnsFrontDoor
        && nginxFrontDoorVersion === effectiveVersion
        && projectRunning
        && this.projectNeedsFrontDoorProxy(proj);
      const confExists = await fs.pathExists(confFile);
      const shouldCreateDirectNginx = webServer === 'nginx' && projectRunning;

      if (!confExists && !shouldProxyThroughNginx && !shouldCreateDirectNginx) continue;

      try {
        if (shouldCreateDirectNginx) {
          const running = this.runningProjects.get(proj.id);
          const phpFpmPort = running?.phpFpmPort || null;
          await this.createNginxVhost(proj, phpFpmPort, targetNginxVersion);
        } else if (shouldProxyThroughNginx) {
          await this.createProxyNginxVhost(proj, this.getProjectProxyBackendHttpPort(proj), targetNginxVersion);
        }
      } catch (error) {
        this.managers.log?.systemWarn(`Could not regenerate vhost for ${proj.name}`, { error: error.message });
      }
    }
  },

  async removeVirtualHost(project, options = {}) {
    const dataPath = this.getDataPath();
    const { reloadIfRunning = false } = options;
    const removedNginxVersions = new Set();

    const nginxConfigPaths = [path.join(dataPath, 'nginx', 'sites', `${project.id}.conf`)];
    const nginxDataDir = path.join(dataPath, 'nginx');

    try {
      if (await fs.pathExists(nginxDataDir)) {
        const entries = await fs.readdir(nginxDataDir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          nginxConfigPaths.push(path.join(nginxDataDir, entry.name, 'sites', `${project.id}.conf`));
        }
      }
    } catch {
      // Ignore errors while scanning nginx config directories.
    }

    for (const nginxConfigPath of [...new Set(nginxConfigPaths)]) {
      if (!await fs.pathExists(nginxConfigPath)) {
        continue;
      }

      await fs.remove(nginxConfigPath);

      const relativePath = path.relative(path.join(dataPath, 'nginx'), nginxConfigPath);
      const relativeSegments = relativePath.split(path.sep);
      if (relativeSegments[1] === 'sites') {
        removedNginxVersions.add(relativeSegments[0]);
      }
    }

    const apacheConfig = path.join(dataPath, 'apache', 'vhosts', `${project.id}.conf`);
    let apacheRemoved = false;
    if (await fs.pathExists(apacheConfig)) {
      await fs.remove(apacheConfig);
      apacheRemoved = true;
    }

    await this.removeFromHostsFile(project.domain);

    if (reloadIfRunning) {
      for (const version of removedNginxVersions) {
        await this.reloadWebServerConfigIfRunning('nginx', version);
      }

      if (apacheRemoved) {
        await this.reloadWebServerConfigIfRunning('apache', this.getEffectiveWebServerVersion(project, 'apache'));
      }
    }
  },

  async switchWebServer(projectId, newWebServer, newWebServerVersion = null) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const oldWebServer = project.webServer || 'nginx';
    const oldWebServerVersion = this.getEffectiveWebServerVersion(project, oldWebServer);
    const targetWebServerVersion = newWebServerVersion || this.getDefaultWebServerVersion(newWebServer);
    const oldProjectSnapshot = {
      ...project,
      webServer: oldWebServer,
      webServerVersion: oldWebServerVersion,
    };

    if (oldWebServer === newWebServer) {
      return { success: true, webServer: newWebServer, message: 'Already using this web server' };
    }

    const wasRunning = this.runningProjects.has(projectId);

    if (wasRunning) {
      await this.stopProject(projectId);
    }

    await this.removeVirtualHost(oldProjectSnapshot, { reloadIfRunning: true });

    const allProjects = this.configStore.get('projects', []);
    const otherProjectsOnOldServer = allProjects.filter((entry) =>
      entry.id !== projectId
      && (entry.webServer || 'nginx') === oldWebServer
      && this.runningProjects.has(entry.id)
    );

    if (otherProjectsOnOldServer.length === 0) {
      try {
        await this.managers.service?.stopService(oldWebServer);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        this.managers.log?.systemWarn(`Could not stop ${oldWebServer}`, { error: error.message });
      }
    }

    const projects = this.configStore.get('projects', []);
    const index = projects.findIndex((entry) => entry.id === projectId);
    if (index !== -1) {
      projects[index] = {
        ...projects[index],
        webServer: newWebServer,
        webServerVersion: targetWebServerVersion,
        updatedAt: new Date().toISOString(),
      };
      this.configStore.set('projects', projects);
    }
    project.webServer = newWebServer;
    project.webServerVersion = targetWebServerVersion;

    await this.createVirtualHost(project, null, targetWebServerVersion);

    if (wasRunning) {
      await this.startProject(projectId);
    }

    return { success: true, webServer: newWebServer, webServerVersion: targetWebServerVersion };
  },
};
