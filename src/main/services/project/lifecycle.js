const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');

const SERVICE_STOP_GRACE_PERIOD_MS = 15000;

function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    return spawn(command, args, {
      ...options,
      windowsHide: true,
    });
  }

  return spawn(command, args, {
    ...options,
    detached: true,
  });
}

module.exports = {
  async startProject(id) {
    const pendingStop = this.pendingProjectStops?.get(id);
    if (pendingStop) {
      await pendingStop;
    }

    const project = this.getProject(id);
    if (!project) {
      throw new Error('Project not found');
    }

    const pendingServices = this.getProjectServiceDependencies(project);
    for (const service of pendingServices) {
      this.cancelPendingServiceStop(service);
    }

    if (this.runningProjects.has(id)) {
      this.managers.log?.project(id, `Project ${project.name} is already running`);
      return { success: true, alreadyRunning: true };
    }

    this.startingProjects?.add(id);

    this.managers.log?.project(id, `Starting project: ${project.name}`);
    if (project.type === 'nodejs') {
      const frameworkNames = {
        express: 'Express',
        fastify: 'Fastify',
        nestjs: 'NestJS',
        nextjs: 'Next.js',
        nuxtjs: 'Nuxt.js',
        koa: 'Koa',
        hapi: 'Hapi',
        adonisjs: 'AdonisJS',
        remix: 'Remix',
        sveltekit: 'SvelteKit',
        strapi: 'Strapi',
        elysia: 'Elysia',
      };
      this.managers.log?.project(id, `Type: nodejs, Node.js: v${project.services?.nodejsVersion || '20'}${project.nodeFramework ? `, Framework: ${frameworkNames[project.nodeFramework] || project.nodeFramework}` : ''}, Web Server: ${project.webServer}`);
    } else {
      this.managers.log?.project(id, `Type: ${project.type}, PHP: ${project.phpVersion}, Web Server: ${project.webServer}`);
    }
    this.managers.log?.project(id, `Domain: ${project.domain}, Path: ${project.path}`);

    let registeredRunningProjectEarly = false;
    let deferFrontDoorProxySync = false;
    let frontDoorProxyHandledByVirtualHostReload = false;

    try {
      const webServer = project.webServer || 'nginx';
      const webServerVersion = this.getEffectiveWebServerVersion(project, webServer);
      const webServerPorts = this.managers.service?.getServicePorts(webServer, webServerVersion);
      const httpPort = webServerPorts?.httpPort || 80;
      const httpsPort = webServerPorts?.sslPort || 443;

      const isHttpAvailable = await isPortAvailable(httpPort);
      const isHttpsAvailable = await isPortAvailable(httpsPort);
      const isWebServerRunning = this.managers.service?.serviceStatus?.get(webServer)?.status === 'running';

      if ((!isHttpAvailable || !isHttpsAvailable) && !isWebServerRunning) {
        this.managers.log?.project(id, `Port ${httpPort} or ${httpsPort} is in use by another program. The web server will automatically use an alternate port.`);
      }

      const missingBinaries = await this.validateProjectBinaries(project);
      if (missingBinaries.length > 0) {
        const missingErrorMsg = `Missing required binaries: ${missingBinaries.join(', ')}. Please install them from the Binary Manager.`;
        this.managers.log?.project(id, `ERROR: ${missingErrorMsg}`);
        throw new Error(missingErrorMsg);
      }

      const phpFpmPort = project.type !== 'nodejs' ? this.getPhpFpmPort(project) : 0;
      const targetVersion = webServerVersion;
      const webServerAlreadyRunning = this.managers.service?.isVersionRunning(webServer, webServerVersion);

      if (webServerAlreadyRunning) {
        if (webServer === 'nginx') {
          await this.createNginxVhost(project, phpFpmPort || undefined, targetVersion);
          await this.regenerateAllNginxVhosts(id, webServerVersion);
          try {
            await this.managers.service?.reloadNginx(targetVersion);
          } catch (error) {
            this.managers.log?.systemWarn('Could not reload/restart nginx', { error: error.message });
          }
        } else if (webServer === 'apache') {
          const vhostResult = await this.createApacheVhost(project, targetVersion);
          await this.regenerateAllApacheVhosts(id, webServerVersion);
          await this.ensureApacheListenConfig(project, vhostResult, targetVersion);
          this.runningProjects.set(id, {
            phpCgiProcess: null,
            phpFpmPort,
            startedAt: new Date(),
          });
          registeredRunningProjectEarly = true;
          try {
            await this.managers.service?.reloadApache(targetVersion);
          } catch (error) {
            this.managers.log?.systemWarn('Could not reload Apache', { error: error.message });
          }
        } else {
          await this.createVirtualHost(project, phpFpmPort || undefined, targetVersion);
        }

        deferFrontDoorProxySync = true;
      }

      const serviceResult = await this.startProjectServices(project);
      if (!serviceResult.success) {
        const errorMsg = serviceResult.errors.length > 0
          ? serviceResult.errors.join('; ')
          : `Critical services failed to start: ${serviceResult.criticalFailures.join(', ')}`;
        throw new Error(errorMsg);
      }

      if (!webServerAlreadyRunning) {
        const actualPorts = this.managers.service?.getServicePorts(webServer, webServerVersion);
        this.managers.log?.project(id, `Web server started on ports HTTP=${actualPorts?.httpPort}, HTTPS=${actualPorts?.sslPort}. Creating vhost config.`);

        if (webServer === 'nginx') {
          await this.createNginxVhost(project, phpFpmPort || undefined, targetVersion);
          await this.regenerateAllNginxVhosts(id, webServerVersion);
        } else if (webServer === 'apache') {
          await this.createApacheVhost(project, targetVersion);
          await this.regenerateAllApacheVhosts(id, webServerVersion);
        }

        const proxyCreated = await this.syncProjectLocalProxy(project);

        try {
          if (process.platform === 'win32') {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          this.managers.log?.project(id, `Reloading ${webServer} to apply vhost configuration`);
          if (webServer === 'nginx') {
            await this.managers.service?.reloadNginx(targetVersion);
          } else if (webServer === 'apache') {
            this.runningProjects.set(id, {
              phpCgiProcess: null,
              phpFpmPort,
              startedAt: new Date(),
            });
            registeredRunningProjectEarly = true;
            await this.managers.service?.reloadApache(targetVersion);
          }
          this.managers.log?.project(id, `${webServer} reloaded successfully with vhost for ${project.domain}`);

          if (proxyCreated) {
            const frontDoorOwner = this.getFrontDoorOwner();
            if (frontDoorOwner && (frontDoorOwner.webServer !== webServer || frontDoorOwner.version !== targetVersion)) {
              if (frontDoorOwner.webServer === 'nginx') {
                await this.managers.service?.reloadNginx(frontDoorOwner.version);
              } else if (frontDoorOwner.webServer === 'apache') {
                await this.managers.service?.reloadApache(frontDoorOwner.version);
              }
            }
          }
        } catch (reloadError) {
          this.managers.log?.systemWarn(`${webServer} reload failed after vhost creation`, { error: reloadError.message });
        }
      } else {
        const currentPorts = this.managers.service?.getServicePorts(webServer, webServerVersion);
        const currentHttpPort = currentPorts?.httpPort || 80;
        if (currentHttpPort !== httpPort) {
          this.managers.log?.project(id, `Web server ports changed (was: ${httpPort}, now: ${currentHttpPort}). Regenerating vhost config.`);
          await this.createVirtualHost(project, phpFpmPort || undefined, targetVersion);
          frontDoorProxyHandledByVirtualHostReload = true;
        }
      }

      let phpCgiProcess = null;
      let actualPhpFpmPort = phpFpmPort;

      if (webServer === 'nginx' && project.type !== 'nodejs') {
        const phpCgiResult = await this.startPhpCgi(project, phpFpmPort);
        phpCgiProcess = phpCgiResult.process;
        actualPhpFpmPort = phpCgiResult.port;

        if (actualPhpFpmPort !== phpFpmPort) {
          await this.createVirtualHost(project, actualPhpFpmPort, targetVersion);
          frontDoorProxyHandledByVirtualHostReload = true;
          if (webServerAlreadyRunning) {
            this.managers.log?.project(id, `Reloading ${webServer} after PHP-CGI moved to port ${actualPhpFpmPort}`);
            try {
              await this.managers.service?.reloadNginx(targetVersion);
            } catch (error) {
              this.managers.log?.systemWarn(`Could not reload ${webServer} after PHP-CGI port update`, { error: error.message });
            }
          }
        }
      }

      if (deferFrontDoorProxySync && !frontDoorProxyHandledByVirtualHostReload) {
        const proxyCreated = await this.syncProjectLocalProxy(project);
        if (proxyCreated) {
          const frontDoorOwner = this.getFrontDoorOwner();
          try {
            if (frontDoorOwner?.webServer === 'nginx') {
              await this.managers.service?.reloadNginx(frontDoorOwner.version);
            } else if (frontDoorOwner?.webServer === 'apache') {
              await this.managers.service?.reloadApache(frontDoorOwner.version);
            }
          } catch (error) {
            this.managers.log?.systemWarn(
              `Could not reload ${frontDoorOwner?.webServer} after creating proxy vhost`,
              { error: error.message }
            );
          }
        }
      }

      this.runningProjects.set(id, {
        phpCgiProcess,
        phpFpmPort: actualPhpFpmPort,
        startedAt: new Date(),
      });

      if (project.supervisor.processes.length > 0) {
        await this.startSupervisorProcesses(project);
      }

      await this.updateHostsFile(project);

      const projects = this.configStore.get('projects', []);
      const index = projects.findIndex((entry) => entry.id === id);
      if (index !== -1) {
        projects[index].lastStarted = new Date().toISOString();
        this.configStore.set('projects', projects);
      }

      this.managers.log?.project(id, `Project ${project.name} started successfully`);
      if (project.type === 'nodejs') {
        this.managers.log?.project(id, `Node.js app proxied via port ${project.nodePort || 3000}`);
      } else if (actualPhpFpmPort) {
        this.managers.log?.project(id, `PHP-CGI running on port ${actualPhpFpmPort}`);
      }
      return { success: true, port: project.port, phpFpmPort: actualPhpFpmPort };
    } catch (error) {
      if (registeredRunningProjectEarly) {
        this.runningProjects.delete(id);
      }
      this.managers.log?.systemError(`Failed to start project ${project.name}`, { error: error.message });
      this.managers.log?.project(id, `Failed to start project: ${error.message}`, 'error');
      throw error;
    } finally {
      this.startingProjects?.delete(id);
    }
  },

  async validateProjectBinaries(project) {
    if (process.env.PLAYWRIGHT_TEST === 'true') {
      return [];
    }

    const missing = [];
    const resourcePath = this.getResourcesPath();
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';

    const phpVersion = project.phpVersion || '8.3';
    const phpExe = platform === 'win' ? 'php.exe' : 'php';
    const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';
    const phpPath = path.join(resourcePath, 'php', phpVersion, platform);
    const phpExists = await fs.pathExists(path.join(phpPath, phpExe));
    const phpCgiExists = await fs.pathExists(path.join(phpPath, phpCgiExe));
    if (!phpExists || !phpCgiExists) {
      missing.push(`PHP ${phpVersion}`);
    }

    const webServer = project.webServer || 'nginx';
    const webServerVersion = this.getEffectiveWebServerVersion(project, webServer);
    const webServerPath = path.join(resourcePath, webServer, webServerVersion, platform);

    if (!await fs.pathExists(webServerPath)) {
      const webServerDir = path.join(resourcePath, webServer);
      let availableVersion = null;

      if (await fs.pathExists(webServerDir)) {
        const versions = await fs.readdir(webServerDir);
        for (const version of versions) {
          const versionPath = path.join(webServerDir, version, platform);
          if (await fs.pathExists(versionPath)) {
            availableVersion = version;
            break;
          }
        }
      }

      if (availableVersion) {
        const projects = this.configStore.get('projects', []);
        const index = projects.findIndex((entry) => entry.id === project.id);
        if (index !== -1) {
          projects[index].webServerVersion = availableVersion;
          this.configStore.set('projects', projects);
          project.webServerVersion = availableVersion;
          this.managers.log?.systemInfo(`Auto-updated ${project.name} web server version from ${webServerVersion} to ${availableVersion}`);
        }
      } else {
        missing.push(`${webServer === 'nginx' ? 'Nginx' : 'Apache'} ${webServerVersion}`);
      }
    }

    if (project.services?.mysql) {
      const mysqlVersion = project.services.mysqlVersion || '8.4';
      const mysqlPath = path.join(resourcePath, 'mysql', mysqlVersion, platform);
      if (!await fs.pathExists(mysqlPath)) {
        missing.push(`MySQL ${mysqlVersion}`);
      }
    }

    if (project.services?.mariadb) {
      const mariadbVersion = project.services.mariadbVersion || '11.4';
      const mariadbPath = path.join(resourcePath, 'mariadb', mariadbVersion, platform);
      if (!await fs.pathExists(mariadbPath)) {
        missing.push(`MariaDB ${mariadbVersion}`);
      }
    }

    if (project.services?.redis) {
      const redisVersion = project.services.redisVersion || '7.4';
      const redisPath = path.join(resourcePath, 'redis', redisVersion, platform);
      if (!await fs.pathExists(redisPath)) {
        missing.push(`Redis ${redisVersion}`);
      }
    }

    return missing;
  },

  async startPhpCgi(project, port) {
    if (process.env.PLAYWRIGHT_TEST === 'true') {
      return { process: { pid: 9999 }, port };
    }

    const phpVersion = project.phpVersion || '8.3';
    const resourcePath = this.getResourcesPath();
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpExe = platform === 'win' ? 'php.exe' : 'php';
    const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';
    const phpDir = path.join(resourcePath, 'php', phpVersion, platform);
    const phpPath = path.join(phpDir, phpExe);
    const phpCgiPath = path.join(phpDir, phpCgiExe);

    if (!await fs.pathExists(phpPath)) {
      throw new Error(`PHP ${phpVersion} is not installed at:\n${phpPath}\n\nPlease install PHP ${phpVersion} from the Binary Manager.`);
    }

    if (!await fs.pathExists(phpCgiPath)) {
      throw new Error(`PHP-CGI not found for PHP ${phpVersion} at:\n${phpCgiPath}\n\nThe PHP installation may be incomplete. Please reinstall PHP ${phpVersion} from the Binary Manager.`);
    }

    let actualPort = port;
    if (!await isPortAvailable(port)) {
      actualPort = await findAvailablePort(port, 100);
      if (!actualPort) {
        throw new Error(`Could not find available port for PHP-CGI (starting from ${port})`);
      }
    }

    const phpCgiProcess = spawnHidden(phpCgiPath, ['-b', `127.0.0.1:${actualPort}`], {
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

    phpCgiProcess.on('exit', () => {
      // Process exited.
    });

    const maxWait = 5000;
    const startTime = Date.now();
    let isListening = false;

    while (Date.now() - startTime < maxWait && !isListening) {
      isListening = !await isPortAvailable(actualPort);
      if (!isListening) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    if (!isListening) {
      this.managers.log?.systemWarn(`PHP-CGI may not have started properly on port ${actualPort}`);
    }

    return { process: phpCgiProcess, port: actualPort };
  },

  async waitForChildProcessExit(proc, timeoutMs = 1500) {
    if (!proc || typeof proc.once !== 'function') {
      return;
    }

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        resolve();
      };

      const timeout = setTimeout(finish, timeoutMs);
      proc.once('exit', () => {
        clearTimeout(timeout);
        finish();
      });
    });
  },

  async waitForPortRelease(port, timeoutMs = 1500) {
    if (!port) {
      return;
    }

    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (await isPortAvailable(port)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  },

  async stopProject(id) {
    const existingPendingStop = this.pendingProjectStops?.get(id);
    if (existingPendingStop) {
      await existingPendingStop;
      return { success: true, wasRunning: false };
    }

    const running = this.runningProjects.get(id);
    if (!running) {
      return { success: true, wasRunning: false };
    }

    const project = this.getProject(id);
    this.managers.log?.project(id, `Stopping project: ${project?.name || id}`);

    const stopPromise = (async () => {
      const kill = require('tree-kill');

      if (running.phpCgiProcess && running.phpCgiProcess.pid) {
        await new Promise((resolve) => {
          kill(running.phpCgiProcess.pid, 'SIGTERM', (err) => {
            if (err) {
              this.managers.log?.systemError('Error killing PHP-CGI process', { error: err.message });
            }
            resolve();
          });
        });

        await this.waitForChildProcessExit(running.phpCgiProcess);
        await this.waitForPortRelease(running.phpFpmPort);
      }

      if (project?.supervisor.processes.length > 0) {
        await this.managers.supervisor?.stopAllProcesses(id);
      }

      this.runningProjects.delete(id);

      if (this.networkPort80Owner === id) {
        this.networkPort80Owner = null;
      }

      if (project) {
        const serviceResult = await this.stopProjectServices(project);
        if (serviceResult.scheduled?.length > 0) {
          this.managers.log?.project(
            id,
            `Scheduled shutdown for unused services: ${serviceResult.scheduled.join(', ')} (${Math.round(SERVICE_STOP_GRACE_PERIOD_MS / 1000)}s grace period)`
          );
        }
      }

      this.managers.log?.project(id, `Project ${project?.name || id} stopped successfully`);

      return { success: true, wasRunning: true };
    })();

    this.pendingProjectStops.set(id, stopPromise);

    try {
      return await stopPromise;
    } catch (error) {
      this.managers.log?.systemError('Error stopping project', { project: project?.name, id, error: error.message });
      throw error;
    } finally {
      this.pendingProjectStops.delete(id);
    }
  },

  async stopProjectServices(project) {
    const serviceManager = this.managers.service;
    if (!serviceManager) {
      return { success: true, stopped: [], failed: [] };
    }

    const projectServices = this.getProjectServiceDependencies(project);
    const activeProjectIds = new Set([
      ...this.runningProjects.keys(),
      ...(this.startingProjects || []),
    ]);
    activeProjectIds.delete(project.id);

    const otherRunningProjects = Array.from(activeProjectIds)
      .map((id) => this.getProject(id))
      .filter(Boolean);

    const servicesToStop = [];
    for (const service of projectServices) {
      const isNeededByOther = otherRunningProjects.some((otherProject) => {
        const otherServices = this.getProjectServiceDependencies(otherProject);
        return otherServices.some((candidate) =>
          candidate.name === service.name
          && (candidate.version === service.version || candidate.version === null || service.version === null)
        );
      });

      if (!isNeededByOther) {
        servicesToStop.push(service);
      }
    }

    const results = { success: true, scheduled: [], failed: [] };
    for (const service of servicesToStop) {
      try {
        this.managers.log?.project(project.id, `Scheduling ${service.name}${service.version ? ':' + service.version : ''} to stop if it remains unused...`);
        this.scheduleServiceStop(project.id, service);
        results.scheduled.push(`${service.name}${service.version ? ':' + service.version : ''}`);
      } catch (error) {
        this.managers.log?.project(project.id, `Failed to stop ${service.name}: ${error.message}`, 'error');
        results.failed.push({ service: service.name, error: error.message });
      }
    }

    return results;
  },

  async stopAllProjects() {
    const runningProjectIds = Array.from(this.runningProjects.keys());

    if (runningProjectIds.length === 0) {
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

    if (process.platform === 'win32') {
      await this.forceKillOrphanPhpProcesses();
    }

    const stoppedCount = results.filter((result) => result.success).length;

    return {
      success: results.every((result) => result.success),
      stoppedCount,
      results,
    };
  },

  async forceKillOrphanPhpProcesses() {
    const { execSync } = require('child_process');
    const processes = ['php-cgi.exe', 'php.exe'];
    for (const processName of processes) {
      try {
        execSync(`taskkill /F /IM ${processName} 2>nul`, {
          windowsHide: true,
          timeout: 5000,
          stdio: 'ignore',
        });
      } catch {
        // Ignore when the process is not running.
      }
    }
  },

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
  },

  async startProjectServices(project) {
    const serviceManager = this.managers.service;
    if (!serviceManager) {
      return { success: true, warning: 'ServiceManager not available' };
    }

    const webServer = project.webServer || 'nginx';
    const webServerVersion = this.getEffectiveWebServerVersion(project, webServer);
    const servicesToStart = [];

    if (webServer === 'nginx') {
      servicesToStart.push({ name: 'nginx', version: webServerVersion, critical: true });
    } else if (webServer === 'apache') {
      servicesToStart.push({ name: 'apache', version: webServerVersion, critical: true });
    }

    if (project.services?.mysql) {
      servicesToStart.push({ name: 'mysql', version: project.services.mysqlVersion || '8.4', critical: false });
    }
    if (project.services?.mariadb) {
      servicesToStart.push({ name: 'mariadb', version: project.services.mariadbVersion || '11.4', critical: false });
    }
    if (project.services?.redis) {
      servicesToStart.push({ name: 'redis', version: project.services.redisVersion || '7.4', critical: false });
    }
    if (project.services?.mailpit) {
      servicesToStart.push({ name: 'mailpit', critical: false });
    }
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

    for (const service of servicesToStart) {
      try {
        this.cancelPendingServiceStop(service);
        const status = serviceManager.serviceStatus.get(service.name);
        const isVersioned = serviceManager.serviceConfigs[service.name]?.versioned;
        const requestedVersion = service.version;
        const runningVersion = status?.version;
        const needsStart = !status || status.status !== 'running';
        const needsDifferentVersion = isVersioned && requestedVersion && runningVersion && runningVersion !== requestedVersion;
        const versionRunning = isVersioned && requestedVersion
          ? serviceManager.isVersionRunning(service.name, requestedVersion)
          : false;

        if ((service.name === 'nginx' || service.name === 'apache') && status && status.status === 'running' && !needsDifferentVersion) {
          const ports = serviceManager.getServicePorts(service.name, requestedVersion);
          const isOnAlternatePorts = ports?.httpPort !== 80 && ports?.httpPort !== 443;

          if (isOnAlternatePorts && serviceManager.standardPortOwner === null) {
            const port80Free = await isPortAvailable(80);
            const port443Free = await isPortAvailable(443);

            if (port80Free && port443Free) {
              this.managers.log?.project(project.id, `${service.name} is on alternate ports (${ports?.httpPort}/${ports?.sslPort}) but port 80/443 are now free. Restarting to reclaim standard ports.`);
              try {
                await serviceManager.restartService(service.name, requestedVersion);
                results.started.push(`${service.name}:${requestedVersion}`);
                continue;
              } catch (reclaimError) {
                this.managers.log?.systemWarn(`Failed to reclaim standard ports for ${service.name}`, { error: reclaimError.message });
              }
            } else {
              this.managers.log?.project(project.id, `${service.name} is on alternate ports (${ports?.httpPort}/${ports?.sslPort}), port 80/443 still unavailable`);
            }
          }
        }

        if (isVersioned && requestedVersion) {
          if (versionRunning) {
            results.started.push(`${service.name}:${requestedVersion}`);
            continue;
          }
        }

        if (needsStart || (isVersioned && !serviceManager.isVersionRunning(service.name, requestedVersion))) {
          const result = await serviceManager.startService(service.name, requestedVersion);

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
          } else {
            const serviceLabel = `${service.name}${service.version ? `:${service.version}` : ''}`;
            const serviceError = serviceManager.serviceStatus.get(service.name)?.error || `status=${result.status || 'unknown'}`;
            const errorMsg = `Failed to start ${serviceLabel}: ${serviceError}`;
            results.failed.push(service.name);
            results.errors.push(errorMsg);
            if (service.critical) {
              results.criticalFailures.push(service.name);
              results.success = false;
            }
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

    if (results.success && results.failed.length === 0) {
      this.managers.log?.project(project.id, `Services ready: ${results.started.join(', ')}`);
    } else if (results.success) {
      this.managers.log?.project(project.id, `Services ready with warnings: ${results.started.join(', ')}; failures: ${results.errors.join('; ')}`, 'error');
    } else {
      this.managers.log?.systemError(`Critical services failed for project ${project.name}`, { failures: results.criticalFailures });
      this.managers.log?.project(project.id, `Service failures: ${results.errors.join('; ')}`, 'error');
    }

    return results;
  },
};