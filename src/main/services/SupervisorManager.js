const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

// Helper function to spawn a process hidden on Windows
// On Windows, uses regular spawn with windowsHide
function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    const proc = spawn(command, args, {
      ...options,
      windowsHide: true,
    });

    return proc;
  } else {
    return spawn(command, args, {
      ...options,
      detached: true,
    });
  }
}

class SupervisorManager {
  constructor(resourcePath, configStore, managers = {}) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.processes = new Map(); // projectId -> { processName -> processInfo }
    this.mainWindow = null; // Will be set by main.js
    this.logsPath = null; // Will be set in initialize()
  }

  async initialize() {
    const { app } = require('electron');
    const dataPath = path.join(app.getPath('userData'), 'data');
    const supervisorPath = path.join(dataPath, 'supervisor');
    this.logsPath = path.join(supervisorPath, 'logs');
    await fs.ensureDir(supervisorPath);
    await fs.ensureDir(this.logsPath);
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

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

    // Store in config
    const projects = this.configStore.get('projects', []);
    const projectIndex = projects.findIndex((p) => p.id === projectId);

    if (projectIndex === -1) {
      throw new Error('Project not found');
    }

    const existingIndex = projects[projectIndex].supervisor.processes.findIndex(
      (p) => p.name === config.name
    );

    if (existingIndex >= 0) {
      projects[projectIndex].supervisor.processes[existingIndex] = processConfig;
    } else {
      projects[projectIndex].supervisor.processes.push(processConfig);
    }

    this.configStore.set('projects', projects);

    return processConfig;
  }

  async removeProcess(projectId, processName) {
    // Stop the process first
    await this.stopProcess(projectId, processName);

    // Remove from config
    const projects = this.configStore.get('projects', []);
    const projectIndex = projects.findIndex((p) => p.id === projectId);

    if (projectIndex === -1) {
      throw new Error('Project not found');
    }

    projects[projectIndex].supervisor.processes = projects[projectIndex].supervisor.processes.filter(
      (p) => p.name !== processName
    );

    this.configStore.set('projects', projects);

    return { success: true };
  }

  async startProcess(projectId, processConfig) {
    const project = this.getProject(projectId);
    if (!project) {
      throw new Error('Project not found');
    }

    const config = typeof processConfig === 'string'
      ? project.supervisor.processes.find((p) => p.name === processConfig)
      : processConfig;

    if (!config) {
      throw new Error('Process configuration not found');
    }

    // Get PHP path for the project
    const phpManager = require('./PhpManager');
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpPath = path.join(this.resourcePath, 'php', project.phpVersion, platform,
      process.platform === 'win32' ? 'php.exe' : 'php');

    const workingDir = config.directory || project.path;

    // Parse the command
    let command = config.command;
    let args = [];

    // Handle PHP-based commands
    if (command.startsWith('php ')) {
      command = phpPath;
      const commandArgs = config.command.substring(4).split(' ');
      // Add -d output_buffering=0 to disable output buffering for real-time logs
      args = ['-d', 'output_buffering=0', ...commandArgs];
    } else {
      const parts = config.command.split(' ');
      command = parts[0];
      args = parts.slice(1);
    }

    // Start multiple instances if numprocs > 1
    const instances = [];
    const numProcs = config.numprocs || 1;

    for (let i = 0; i < numProcs; i++) {
      let proc;
      const instanceName = numProcs > 1 ? `${config.name}_${i}` : config.name;

      if (process.platform === 'win32') {
        // On Windows, use spawnHidden to run without a console window
        // but still capture stdout/stderr
        proc = spawnHidden(command, args, {
          cwd: workingDir,
          env: {
            ...process.env,
            ...project.environment,
            ...config.environment,
            // Force unbuffered output for real-time logs
            PYTHONUNBUFFERED: '1',
            NODE_NO_READLINE: '1',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        // Capture output on Windows too - use config.name so all instances log to same file
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
          // Auto-restart if enabled
          if (config.autorestart && code !== 0) {
            this.logOutput(projectId, config.name, '[AUTO-RESTARTING]...\n', 'stdout');
            setTimeout(() => {
              this.startProcess(projectId, config).catch(() => {
                // Failed to restart - will be retried
              });
            }, 1000);
          } else {
            this.updateProcessStatus(projectId, config.name, 'stopped', null);
          }
        });
      } else {
        proc = spawn(command, args, {
          cwd: workingDir,
          env: {
            ...process.env,
            ...project.environment,
            ...config.environment,
            // Force unbuffered output for real-time logs
            PYTHONUNBUFFERED: '1',
            NODE_NO_READLINE: '1',
          },
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

        proc.on('exit', (code, signal) => {
          // Auto-restart if enabled
          if (config.autorestart && code !== 0) {
            setTimeout(() => {
              this.startProcess(projectId, config).catch(() => {
                // Failed to restart - will be retried
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

    // Store process references
    if (!this.processes.has(projectId)) {
      this.processes.set(projectId, new Map());
    }
    this.processes.get(projectId).set(config.name, {
      config,
      instances,
      startedAt: new Date(),
    });

    // Update status in config
    this.updateProcessStatus(projectId, config.name, 'running', instances[0]?.pid);

    return { success: true, instances: instances.length };
  }

  async stopProcess(projectId, processName) {
    const projectProcesses = this.processes.get(projectId);
    if (!projectProcesses) {
      return { success: true, wasRunning: false };
    }

    const processInfo = projectProcesses.get(processName);
    if (!processInfo) {
      return { success: true, wasRunning: false };
    }

    const kill = require('tree-kill');

    // Kill all instances
    for (const instance of processInfo.instances) {
      if (instance.process && instance.pid) {
        await new Promise((resolve) => {
          kill(instance.pid, 'SIGTERM', (err) => {
            if (err) this.managers.log?.systemError(`Error killing process ${instance.name}`, { error: err.message });
            resolve();
          });
        });
      }
    }

    projectProcesses.delete(processName);
    this.updateProcessStatus(projectId, processName, 'stopped', null);

    return { success: true, wasRunning: true };
  }

  async restartProcess(projectId, processName) {
    await this.stopProcess(projectId, processName);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const project = this.getProject(projectId);
    const config = project?.supervisor.processes.find((p) => p.name === processName);

    if (config) {
      return this.startProcess(projectId, config);
    }

    throw new Error('Process configuration not found');
  }

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
  }

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
  }

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
      pids: processInfo.instances.map((i) => i.pid),
    };
  }

  // Helper methods
  getProject(projectId) {
    const projects = this.configStore.get('projects', []);
    return projects.find((p) => p.id === projectId);
  }

  updateProcessStatus(projectId, processName, status, pid) {
    const projects = this.configStore.get('projects', []);
    const projectIndex = projects.findIndex((p) => p.id === projectId);

    if (projectIndex === -1) return;

    const processIndex = projects[projectIndex].supervisor.processes.findIndex(
      (p) => p.name === processName
    );

    if (processIndex === -1) return;

    projects[projectIndex].supervisor.processes[processIndex].status = status;
    projects[projectIndex].supervisor.processes[processIndex].pid = pid;
    projects[projectIndex].supervisor.processes[processIndex].startedAt =
      status === 'running' ? new Date().toISOString() : null;

    this.configStore.set('projects', projects);
  }

  logOutput(projectId, processName, output, type) {
    // Write to log file
    if (this.logsPath) {
      const logFile = path.join(this.logsPath, `${projectId}-${processName}.log`);
      const timestamp = new Date().toISOString();
      const prefix = type === 'stderr' ? '[ERR]' : '[OUT]';
      const formattedOutput = output.split('\n')
        .filter(line => line.trim())
        .map(line => `[${timestamp}] ${prefix} ${line}`)
        .join('\n');

      if (formattedOutput) {
        fs.appendFileSync(logFile, formattedOutput + '\n');
      }
    }

    // Send to renderer for real-time display
    if (this.mainWindow) {
      this.mainWindow.webContents.send('supervisor:output', {
        projectId,
        processName,
        output,
        type,
        timestamp: new Date().toISOString(),
      });
    }
  }

  async getWorkerLogs(projectId, processName, lines = 200) {
    if (!this.logsPath) {
      return [];
    }

    const logFile = path.join(this.logsPath, `${projectId}-${processName}.log`);

    if (!await fs.pathExists(logFile)) {
      return [];
    }

    try {
      const content = await fs.readFile(logFile, 'utf8');
      const allLines = content.split('\n').filter(line => line.trim());
      // Return last N lines
      return allLines.slice(-lines);
    } catch (error) {
      this.managers.log?.systemError('Error reading worker logs', { error: error.message });
      return [];
    }
  }

  async clearWorkerLogs(projectId, processName) {
    if (!this.logsPath) {
      return { success: false, error: 'Logs path not initialized' };
    }

    const logFile = path.join(this.logsPath, `${projectId}-${processName}.log`);

    try {
      if (await fs.pathExists(logFile)) {
        await fs.remove(logFile);
      }
      return { success: true };
    } catch (error) {
      this.managers.log?.systemError('Error clearing worker logs', { error: error.message });
      return { success: false, error: error.message };
    }
  }

  async getAllWorkerLogsForProject(projectId, lines = 100) {
    const project = this.getProject(projectId);
    if (!project || !project.supervisor?.processes) {
      return {};
    }

    const logs = {};
    for (const process of project.supervisor.processes) {
      logs[process.name] = await this.getWorkerLogs(projectId, process.name, lines);
    }
    return logs;
  }

  // Queue worker helpers for Laravel
  async createQueueWorker(projectId, options = {}) {
    const config = {
      name: options.name || 'queue-worker',
      command: `php artisan queue:work ${options.connection || ''} --sleep=${options.sleep || 3} --tries=${options.tries || 3} --max-jobs=${options.maxJobs || 1000} --max-time=${options.maxTime || 3600}`,
      autostart: options.autostart !== false,
      autorestart: true,
      numprocs: options.workers || 1,
    };

    return this.addProcess(projectId, config);
  }

  async createScheduleWorker(projectId) {
    const config = {
      name: 'schedule-runner',
      command: 'php artisan schedule:work',
      autostart: true,
      autorestart: true,
      numprocs: 1,
    };

    return this.addProcess(projectId, config);
  }

  async createHorizonWorker(projectId) {
    const config = {
      name: 'horizon',
      command: 'php artisan horizon',
      autostart: true,
      autorestart: true,
      numprocs: 1,
    };

    return this.addProcess(projectId, config);
  }
}

module.exports = { SupervisorManager };
