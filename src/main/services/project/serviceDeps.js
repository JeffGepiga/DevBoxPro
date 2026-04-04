const SERVICE_STOP_GRACE_PERIOD_MS = 15000;
const WARM_RESTART_SERVICE_NAMES = new Set(['nginx', 'apache', 'mysql', 'mariadb']);

module.exports = {
  getServiceDependencyKey(service) {
    return `${service.name}:${service.version || 'default'}`;
  },

  isServiceNeededByRunningProjects(service) {
    const activeProjectIds = new Set([
      ...this.runningProjects.keys(),
      ...(this.startingProjects || []),
    ]);

    return Array.from(activeProjectIds)
      .map((id) => this.getProject(id))
      .filter(Boolean)
      .some((runningProject) => {
        const otherServices = this.getProjectServiceDependencies(runningProject);
        return otherServices.some((candidate) =>
          candidate.name === service.name
          && (candidate.version === service.version || candidate.version === null || service.version === null)
        );
      });
  },

  shouldKeepServiceWarm(service) {
    return WARM_RESTART_SERVICE_NAMES.has(service?.name);
  },

  cancelPendingServiceStop(service) {
    const serviceKey = this.getServiceDependencyKey(service);
    const pendingStop = this.pendingServiceStops.get(serviceKey);

    if (!pendingStop) {
      return false;
    }

    clearTimeout(pendingStop.timer);
    this.pendingServiceStops.delete(serviceKey);
    return true;
  },

  clearPendingServiceStops() {
    const pendingStops = Array.from(this.pendingServiceStops.values());
    for (const pendingStop of pendingStops) {
      clearTimeout(pendingStop.timer);
    }

    const clearedCount = pendingStops.length;
    this.pendingServiceStops.clear();
    return clearedCount;
  },

  scheduleServiceStop(projectId, service) {
    const serviceKey = this.getServiceDependencyKey(service);
    this.cancelPendingServiceStop(service);

    const timer = setTimeout(async () => {
      const pendingStop = this.pendingServiceStops.get(serviceKey);
      if (!pendingStop || pendingStop.timer !== timer) {
        return;
      }

      this.pendingServiceStops.delete(serviceKey);

      if (this.isServiceNeededByRunningProjects(service)) {
        this.managers.log?.project(projectId, `Skipped stopping ${service.name}${service.version ? ':' + service.version : ''} because another project started using it during the grace period`);
        return;
      }

      try {
        this.managers.log?.project(projectId, `Stopping ${service.name}${service.version ? ':' + service.version : ''} after idle grace period`);
        await this.managers.service?.stopService(service.name, service.version);
      } catch (error) {
        this.managers.log?.project(projectId, `Failed to stop ${service.name}: ${error.message}`, 'error');
      }
    }, SERVICE_STOP_GRACE_PERIOD_MS);

    this.pendingServiceStops.set(serviceKey, { timer, service });
  },

  async releaseUnusedFrontDoorOwner(requestedService) {
    if (!requestedService || (requestedService.name !== 'nginx' && requestedService.name !== 'apache')) {
      return false;
    }

    const currentOwner = this.managers.service?.standardPortOwner;
    if (!currentOwner || currentOwner === requestedService.name) {
      return false;
    }

    const ownerVersion = this.managers.service?.standardPortOwnerVersion || this.getDefaultWebServerVersion(currentOwner);
    const frontDoorService = { name: currentOwner, version: ownerVersion };
    if (this.isServiceNeededByRunningProjects(frontDoorService)) {
      return false;
    }

    this.cancelPendingServiceStop(frontDoorService);
    this.managers.log?.project(
      requestedService.projectId || 'system',
      `Stopping idle ${currentOwner}:${ownerVersion} so ${requestedService.name}:${requestedService.version || this.getDefaultWebServerVersion(requestedService.name)} can reclaim the standard ports`
    );
    await this.managers.service?.stopService(frontDoorService.name, frontDoorService.version);
    return true;
  },

  getProjectServiceDependencies(project) {
    const services = [];

    const webServer = project.webServer || 'nginx';
    const webServerVersion = this.getEffectiveWebServerVersion(project, webServer);
    services.push({ name: webServer, version: webServerVersion });

    if (project.services?.mysql) {
      services.push({ name: 'mysql', version: project.services.mysqlVersion || '8.4' });
    }
    if (project.services?.mariadb) {
      services.push({ name: 'mariadb', version: project.services.mariadbVersion || '11.4' });
    }
    if (project.services?.redis) {
      services.push({ name: 'redis', version: project.services.redisVersion || '7.4' });
    }
    if (project.services?.mailpit) {
      services.push({ name: 'mailpit', version: null });
    }
    if (project.services?.phpmyadmin) {
      services.push({ name: 'phpmyadmin', version: null });
    }

    return services;
  },
};
