const SERVICE_STOP_GRACE_PERIOD_MS = 15000;

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

  async stopPendingCompetingWebServer(projectId, targetWebServer) {
    if (targetWebServer !== 'nginx' && targetWebServer !== 'apache') {
      return false;
    }

    const competingWebServer = targetWebServer === 'nginx' ? 'apache' : 'nginx';
    const pendingStops = Array.from(this.pendingServiceStops.values())
      .filter((pendingStop) => pendingStop?.service?.name === competingWebServer);

    if (pendingStops.length === 0) {
      return false;
    }

    let stopped = false;
    for (const pendingStop of pendingStops) {
      const service = pendingStop.service;
      if (!service || this.isServiceNeededByRunningProjects(service)) {
        continue;
      }

      clearTimeout(pendingStop.timer);
      this.pendingServiceStops.delete(this.getServiceDependencyKey(service));

      this.managers.log?.project(
        projectId,
        `Stopping ${service.name}${service.version ? ':' + service.version : ''} immediately so ${targetWebServer} can reclaim the front-door ports`
      );
      await this.managers.service?.stopService(service.name, service.version);
      stopped = true;
    }

    return stopped;
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
