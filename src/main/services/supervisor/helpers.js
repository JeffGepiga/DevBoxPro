const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  async initialize() {
    const dataPath = this.configStore.getDataPath();
    const supervisorPath = path.join(dataPath, 'supervisor');
    this.logsPath = path.join(supervisorPath, 'logs');
    await fs.ensureDir(supervisorPath);
    await fs.ensureDir(this.logsPath);
  },

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  },

  getPlatform() {
    return process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
  },

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
  },

  prependPath(env, entries) {
    const values = entries.filter(Boolean);
    if (values.length === 0) {
      return env;
    }

    return {
      ...env,
      PATH: `${values.join(path.delimiter)}${path.delimiter}${env.PATH || process.env.PATH || ''}`,
    };
  },

  normalizeExecutableToken(token = '') {
    const base = path.basename(token).toLowerCase();
    return base.replace(/\.(cmd|exe|bat|ps1)$/i, '');
  },

  spawnHidden(command, args, options = {}) {
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

      return spawn(command, args, {
        ...options,
        shell: false,
        windowsHide: true,
      });
    }

    return spawn(command, args, {
      ...options,
      detached: true,
    });
  },

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
    const npmCli = process.platform === 'win32'
      ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npm-cli.js')
      : path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js');
    const npxCli = process.platform === 'win32'
      ? path.join(nodeDir, 'node_modules', 'npm', 'bin', 'npx-cli.js')
      : path.join(nodeDir, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js');
    const pythonVersion = project.services?.pythonVersion || '3.13';
    const pythonDir = path.join(this.resourcePath, 'python', pythonVersion, platform);
    const pythonPath = path.join(
      pythonDir,
      process.platform === 'win32' ? 'python.exe' : 'bin',
      process.platform === 'win32' ? '' : 'python3'
    ).replace(/[\\/]$/, '');
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
  },
};