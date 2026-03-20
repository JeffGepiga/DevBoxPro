module.exports = {
  async addProcess(projectId, config) {
    const processConfig = {
      name: config.name,
      command: config.command,
      autostart: config.autostart !== false,
      autorestart: config.autorestart !== false,
      numprocs: config.numprocs || 1,
      directory: config.directory,
      environment: config.environment || {},
      stdout_logfile: config.stdout_logfile,
      stderr_logfile: config.stderr_logfile,
      status: 'stopped',
      pid: null,
      startedAt: null,
    };

    const projects = this.configStore.get('projects', []);
    const projectIndex = projects.findIndex((project) => project.id === projectId);

    if (projectIndex === -1) {
      throw new Error('Project not found');
    }

    const existingIndex = projects[projectIndex].supervisor.processes.findIndex(
      (process) => process.name === config.name
    );

    if (existingIndex >= 0) {
      projects[projectIndex].supervisor.processes[existingIndex] = processConfig;
    } else {
      projects[projectIndex].supervisor.processes.push(processConfig);
    }

    this.configStore.set('projects', projects);
    return processConfig;
  },

  async removeProcess(projectId, processName) {
    await this.stopProcess(projectId, processName);

    const projects = this.configStore.get('projects', []);
    const projectIndex = projects.findIndex((project) => project.id === projectId);

    if (projectIndex === -1) {
      throw new Error('Project not found');
    }

    projects[projectIndex].supervisor.processes = projects[projectIndex].supervisor.processes.filter(
      (process) => process.name !== processName
    );

    this.configStore.set('projects', projects);
    return { success: true };
  },

  getProject(projectId) {
    const projects = this.configStore.get('projects', []);
    return projects.find((project) => project.id === projectId);
  },

  updateProcessStatus(projectId, processName, status, pid) {
    const projects = this.configStore.get('projects', []);
    const projectIndex = projects.findIndex((project) => project.id === projectId);

    if (projectIndex === -1) {
      return;
    }

    const processIndex = projects[projectIndex].supervisor.processes.findIndex(
      (process) => process.name === processName
    );

    if (processIndex === -1) {
      return;
    }

    projects[projectIndex].supervisor.processes[processIndex].status = status;
    projects[projectIndex].supervisor.processes[processIndex].pid = pid;
    projects[projectIndex].supervisor.processes[processIndex].startedAt =
      status === 'running' ? new Date().toISOString() : null;

    this.configStore.set('projects', projects);

    if (this.mainWindow) {
      this.mainWindow.webContents.send('supervisor:statusChanged', {
        projectId,
        processName,
        status,
        pid,
        startedAt: projects[projectIndex].supervisor.processes[processIndex].startedAt,
      });
    }
  },

  getProcesses(projectId) {
    const project = this.getProject(projectId);
    if (!project) {
      return [];
    }

    const projectProcesses = this.processes.get(projectId) || new Map();

    return project.supervisor.processes.map((config) => {
      const runningInfo = projectProcesses.get(config.name);
      return {
        ...config,
        isRunning: !!runningInfo,
        instances: runningInfo?.instances.length || 0,
        uptime: runningInfo ? Date.now() - runningInfo.startedAt.getTime() : null,
      };
    });
  },

  getProcessStatus(projectId, processName) {
    const projectProcesses = this.processes.get(projectId);
    if (!projectProcesses) {
      return { status: 'stopped', isRunning: false };
    }

    const processInfo = projectProcesses.get(processName);
    if (!processInfo) {
      return { status: 'stopped', isRunning: false };
    }

    return {
      status: 'running',
      isRunning: true,
      instances: processInfo.instances.length,
      uptime: Date.now() - processInfo.startedAt.getTime(),
      pids: processInfo.instances.map((instance) => instance.pid),
    };
  },
};