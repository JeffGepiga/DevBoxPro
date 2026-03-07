const path = require('path');
const fs = require('fs-extra');
const treeKill = require('tree-kill');
const { spawn } = require('child_process');

// Helper function to spawn a process hidden on Windows
// On Windows, uses regular spawn with windowsHide
function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    const executable = String(command || '');
    const isBatchScript = /\.(cmd|bat)$/i.test(executable);

    if (isBatchScript) {
      const comspec = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
      return spawn(comspec, ['/d', '/c', executable, ...(args || [])], {
        ...options,
        shell: false,
        windowsHide: true,
      });
    }

    const proc = spawn(command, args, {
      ...options,
      shell: false,
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

  getPlatform() {
    return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  }

  tokenizeCommand(commandString = '') {
    const tokens = [];
    let current = '';
    let quote = null;

    for (const char of commandString.trim()) {
      if (quote) {
        if (char === quote) {
          quote = null;
        } else {
          current += char;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = '';
        }
        continue;
      }

      current += char;
    }

    if (current) {
      tokens.push(current);
    }

    return tokens;
  }

  prependPath(env, entries) {
    const values = entries.filter(Boolean);
    if (values.length === 0) {
      return env;
    }

    return {
      ...env,
      PATH: `${values.join(path.delimiter)}${path.delimiter}${env.PATH || process.env.PATH || ''}`,
    };
  }

  normalizeExecutableToken(token = '') {
    const base = path.basename(token).toLowerCase();
    return base.replace(/\.(cmd|exe|bat|ps1)$/i, '');
  }

  async resolveProcessCommand(project, config) {
    const tokens = this.tokenizeCommand(config.command || '');
    if (tokens.length === 0) {
      throw new Error('Process command is required');
    }

    const platform = this.getPlatform();
    const phpDir = path.join(this.resourcePath, 'php', project.phpVersion, platform);
    const phpPath = path.join(phpDir, process.platform === 'win32' ? 'php.exe' : 'php');
    const nodeVersion = project.services?.nodejsVersion || '20';
    const nodeDir = path.join(this.resourcePath, 'nodejs', nodeVersion, platform);
    const binDir = path.join(this.resourcePath, 'bin');
    const nodePath = process.platform === 'win32'
      ? path.join(nodeDir, 'node.exe')
      : path.join(nodeDir, 'bin', 'node');
    const npmPath = process.platform === 'win32'
      ? path.join(nodeDir, 'npm.cmd')
      : path.join(nodeDir, 'bin', 'npm');
    const npxPath = process.platform === 'win32'
      ? path.join(nodeDir, 'npx.cmd')
      : path.join(nodeDir, 'bin', 'npx');
    const npmWrapperPath = process.platform === 'win32'
      ? path.join(binDir, `npm${nodeVersion}.cmd`)
      : null;
    const npxWrapperPath = process.platform === 'win32'
      ? path.join(binDir, `npx${nodeVersion}.cmd`)
      : null;
    const npmCli = process.platform === 'win32'
      ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npxCli = process.platform === 'win32'
      ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
      : path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const pythonVersion = project.services?.pythonVersion || '3.13';
    const pythonDir = path.join(this.resourcePath, 'python', pythonVersion, platform);
    const pythonPath = path.join(pythonDir, process.platform === 'win32' ? 'python.exe' : 'bin', process.platform === 'win32' ? '' : 'python3').replace(/[\\/]$/, '');
    const pythonScriptsDir = process.platform === 'win32' ? path.join(pythonDir, 'Scripts') : path.join(pythonDir, 'bin');
    const composerPhar = path.join(this.resourcePath, 'composer', 'composer.phar');

    const envBase = {
      ...process.env,
      ...project.environment,
      ...config.environment,
      PYTHONUNBUFFERED: '1',
      NODE_NO_READLINE: '1',
    };

    const firstToken = this.normalizeExecutableToken(tokens[0]);
    let command = tokens[0];
    let args = tokens.slice(1);
    let env = envBase;

    if (firstToken === 'php') {
      if (!await fs.pathExists(phpPath)) {
        throw new Error(`PHP ${project.phpVersion} is not installed for this project`);
      }
      command = phpPath;
      args = ['-d', 'output_buffering=0', ...tokens.slice(1)];
      env = this.prependPath(envBase, [phpDir]);
    } else if (firstToken === 'composer') {
      if (!await fs.pathExists(phpPath)) {
        throw new Error(`PHP ${project.phpVersion} is not installed for this project`);
      }
      if (!await fs.pathExists(composerPhar)) {
        throw new Error('Composer is not installed. Download it from the Binary Manager first.');
      }
      command = phpPath;
      args = [composerPhar, ...tokens.slice(1)];
      env = this.prependPath({ ...envBase, COMPOSER_HOME: path.join(this.resourcePath, 'composer') }, [phpDir]);
    } else if (firstToken === 'node') {
      if (!await fs.pathExists(nodePath)) {
        throw new Error(`Node.js ${nodeVersion} is not installed for this project`);
      }
      command = nodePath;
      args = tokens.slice(1);
      env = this.prependPath(envBase, [platform === 'win' ? nodeDir : path.join(nodeDir, 'bin')]);
    } else if (firstToken === 'npm') {
      const hasNpmExecutable = await fs.pathExists(npmPath);
      const hasNpmCli = await fs.pathExists(npmCli);
      if (!await fs.pathExists(nodePath) || (!hasNpmExecutable && !hasNpmCli)) {
        throw new Error(`Node.js ${nodeVersion} with npm is not installed for this project`);
      }
      if (hasNpmExecutable) {
        command = npmPath;
        args = tokens.slice(1);
      } else {
        command = nodePath;
        args = [npmCli, ...tokens.slice(1)];
      }
      env = this.prependPath(envBase, [platform === 'win' ? nodeDir : path.join(nodeDir, 'bin')]);
    } else if (firstToken === 'npx') {
      const hasNpxExecutable = await fs.pathExists(npxPath);
      const hasNpxCli = await fs.pathExists(npxCli);
      if (!await fs.pathExists(nodePath) || (!hasNpxExecutable && !hasNpxCli)) {
        throw new Error(`Node.js ${nodeVersion} with npx is not installed for this project`);
      }
      if (hasNpxExecutable) {
        command = npxPath;
        args = tokens.slice(1);
      } else {
        command = nodePath;
        args = [npxCli, ...tokens.slice(1)];
      }
      env = this.prependPath(envBase, [platform === 'win' ? nodeDir : path.join(nodeDir, 'bin')]);
    } else if (firstToken === 'python' || firstToken === 'python3') {
      if (!await fs.pathExists(pythonPath)) {
        throw new Error(`Python ${pythonVersion} is not installed for this project`);
      }
      command = pythonPath;
      args = tokens.slice(1);
      env = this.prependPath(envBase, [pythonDir, pythonScriptsDir]);
    } else if (firstToken === 'pip' || firstToken === 'pip3') {
      if (!await fs.pathExists(pythonPath)) {
        throw new Error(`Python ${pythonVersion} is not installed for this project`);
      }
      command = pythonPath;
      args = ['-m', 'pip', ...tokens.slice(1)];
      env = this.prependPath(envBase, [pythonDir, pythonScriptsDir]);
    }

    return { command, args, env };
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

    const workingDir = config.directory || project.path;
    const { command, args, env } = await this.resolveProcessCommand(project, config);

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
          env,
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

    // Kill all instances
    for (const instance of processInfo.instances) {
      if (instance.process && instance.pid) {
        await new Promise((resolve) => {
          treeKill(instance.pid, 'SIGTERM', (err) => {
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
