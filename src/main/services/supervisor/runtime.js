const treeKill = require('tree-kill');
const { spawn } = require('child_process');

module.exports = {
  spawnInstance(projectId, config, index, numProcs, workingDir, command, args, env) {
    const instanceName = numProcs > 1 ? `${config.name}_${index}` : config.name;
    const processKey = `${projectId}:${config.name}`;
    let proc;

    if (process.platform === 'win32') {
      proc = this.spawnHidden(command, args, {
        cwd: workingDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      proc = spawn(command, args, {
        cwd: workingDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }

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
      this.logOutput(projectId, config.name, `[PROCESS EXITED] Instance: ${instanceName}, Code: ${code}, Signal: ${signal}\n`, 'stdout');

      const isStopping = this.stoppingProcesses?.has(processKey);
      if (config.autorestart && !isStopping) {
        // Crash-loop tracking & backoff
        const now = Date.now();
        if (!this.crashCounts) this.crashCounts = new Map();
        const crashInfo = this.crashCounts.get(processKey) || { count: 0, lastCrashAt: 0 };

        if (now - crashInfo.lastCrashAt > 30000) {
          crashInfo.count = 0;
        }
        crashInfo.count += 1;
        crashInfo.lastCrashAt = now;
        this.crashCounts.set(processKey, crashInfo);

        if (crashInfo.count > 5) {
          this.logOutput(projectId, config.name, `[CRASH LOOP PAUSED] Process crashed ${crashInfo.count} times in rapid succession. Auto-restart paused.\n`, 'stderr');
          this.updateProcessStatus(projectId, config.name, 'error', null);
        } else {
          const delay = Math.min(1000 * Math.pow(2, crashInfo.count - 1), 15000);
          this.logOutput(projectId, config.name, `[AUTO-RESTARTING] Instance ${instanceName} in ${Math.round(delay / 1000)}s...\n`, 'stdout');
          setTimeout(() => {
            if (!this.stoppingProcesses?.has(processKey)) {
              this.restartSingleInstance(projectId, config, index).catch(() => {});
            }
          }, delay);
        }
      } else {
        const projMap = this.processes.get(projectId);
        const pInfo = projMap?.get(config.name);
        const anyRunning = pInfo?.instances?.some((inst) => inst.process && !inst.process.killed);
        if (!anyRunning) {
          this.updateProcessStatus(projectId, config.name, 'stopped', null);
        }
      }
    });

    return {
      name: instanceName,
      process: proc,
      pid: proc.pid,
      index,
    };
  },

  async restartSingleInstance(projectId, config, index) {
    const project = this.getProject(projectId);
    if (!project) return;
    const workingDir = config.directory || project.path;
    const { command, args, env } = await this.resolveProcessCommand(project, config);
    const numProcs = config.numprocs || 1;

    const newInst = this.spawnInstance(projectId, config, index, numProcs, workingDir, command, args, env);
    const projectProcesses = this.processes.get(projectId);
    const pInfo = projectProcesses?.get(config.name);
    if (pInfo && pInfo.instances) {
      pInfo.instances[index] = newInst;
      this.updateProcessStatus(projectId, config.name, 'running', newInst.pid);
    }
  },

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
      const instance = this.spawnInstance(projectId, config, index, numProcs, workingDir, command, args, env);
      instances.push(instance);
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
    const processKey = `${projectId}:${processName}`;
    if (!this.stoppingProcesses) {
      this.stoppingProcesses = new Set();
    }
    this.stoppingProcesses.add(processKey);

    const projectProcesses = this.processes.get(projectId);
    if (!projectProcesses) {
      this.stoppingProcesses.delete(processKey);
      return { success: true, wasRunning: false };
    }

    const processInfo = projectProcesses.get(processName);
    if (!processInfo) {
      this.stoppingProcesses.delete(processKey);
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
    this.stoppingProcesses.delete(processKey);
    this.crashCounts?.delete(processKey);
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