const treeKill = require('tree-kill');
const { spawn } = require('child_process');

module.exports = {
  async startProcess(projectId, processConfig) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const config = typeof processConfig === 'string'
      ? project.supervisor.processes.find((process) => process.name === processConfig)
      : processConfig;

    if (!config) {
      throw new Error('Process configuration not found');
    }

    const workingDir = config.directory || project.path;
    const { command, args, env } = await this.resolveProcessCommand(project, config);
    const instances = [];
    const numProcs = config.numprocs || 1;

    for (let index = 0; index < numProcs; index++) {
      let proc;
      const instanceName = numProcs > 1 ? `${config.name}_${index}` : config.name;

      if (process.platform === 'win32') {
        proc = this.spawnHidden(command, args, {
          cwd: workingDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        proc.stdout?.on('data', (data) => {
          this.logOutput(projectId, config.name, data.toString(), 'stdout');
        });

        proc.stderr?.on('data', (data) => {
          this.logOutput(projectId, config.name, data.toString(), 'stderr');
        });

        proc.on('error', (error) => {
          this.managers.log?.systemError(`Supervisor process ${instanceName} error`, { error: error.message });
          this.logOutput(projectId, config.name, `[ERROR] ${error.message}\n`, 'stderr');
          this.updateProcessStatus(projectId, config.name, 'error', null);
        });

        proc.on('exit', (code, signal) => {
          this.logOutput(projectId, config.name, `[PROCESS EXITED] Code: ${code}, Signal: ${signal}\n`, 'stdout');
          if (config.autorestart && code !== 0) {
            this.logOutput(projectId, config.name, '[AUTO-RESTARTING]...\n', 'stdout');
            setTimeout(() => {
              this.startProcess(projectId, config).catch(() => {
              });
            }, 1000);
          } else {
            this.updateProcessStatus(projectId, config.name, 'stopped', null);
          }
        });
      } else {
        proc = spawn(command, args, {
          cwd: workingDir,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
        });

        proc.stdout.on('data', (data) => {
          this.logOutput(projectId, config.name, data.toString(), 'stdout');
        });

        proc.stderr.on('data', (data) => {
          this.logOutput(projectId, config.name, data.toString(), 'stderr');
        });

        proc.on('error', (error) => {
          this.managers.log?.systemError(`Supervisor process ${instanceName} error`, { error: error.message });
          this.updateProcessStatus(projectId, config.name, 'error', null);
        });

        proc.on('exit', (code) => {
          if (config.autorestart && code !== 0) {
            setTimeout(() => {
              this.startProcess(projectId, config).catch(() => {
              });
            }, 1000);
          } else {
            this.updateProcessStatus(projectId, config.name, 'stopped', null);
          }
        });
      }

      instances.push({
        name: instanceName,
        process: proc,
        pid: proc.pid,
      });
    }

    if (!this.processes.has(projectId)) {
      this.processes.set(projectId, new Map());
    }

    this.processes.get(projectId).set(config.name, {
      config,
      instances,
      startedAt: new Date(),
    });

    this.updateProcessStatus(projectId, config.name, 'running', instances[0]?.pid);
    return { success: true, instances: instances.length };
  },

  async stopProcess(projectId, processName) {
    const projectProcesses = this.processes.get(projectId);
    if (!projectProcesses) {
      return { success: true, wasRunning: false };
    }

    const processInfo = projectProcesses.get(processName);
    if (!processInfo) {
      return { success: true, wasRunning: false };
    }

    for (const instance of processInfo.instances) {
      if (instance.process && instance.pid) {
        await new Promise((resolve) => {
          treeKill(instance.pid, 'SIGTERM', (err) => {
            if (err) {
              this.managers.log?.systemError(`Error killing process ${instance.name}`, { error: err.message });
            }
            resolve();
          });
        });
      }
    }

    projectProcesses.delete(processName);
    this.updateProcessStatus(projectId, processName, 'stopped', null);

    return { success: true, wasRunning: true };
  },

  async restartProcess(projectId, processName) {
    await this.stopProcess(projectId, processName);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const project = this.getProject(projectId);
    const config = project?.supervisor.processes.find((process) => process.name === processName);

    if (config) {
      return this.startProcess(projectId, config);
    }

    throw new Error('Process configuration not found');
  },

  async stopAllProcesses(projectId) {
    const projectProcesses = this.processes.get(projectId);
    if (!projectProcesses) {
      return { success: true };
    }

    const processNames = Array.from(projectProcesses.keys());
    for (const processName of processNames) {
      await this.stopProcess(projectId, processName);
    }

    return { success: true, stopped: processNames.length };
  },
};