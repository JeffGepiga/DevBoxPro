const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { isPortAvailable, findAvailablePort, getProcessOnPort } = require('../../utils/PortUtils');

function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    return spawn(command, args, { ...options, windowsHide: true });
  }

  return spawn(command, args, { ...options, detached: true });
}

async function waitForMariaDbPortState(context, port, mariadbPath, timeoutMs = 8000) {
  const expectedExecutablePath = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');
  const expectedConfigPath = path.join(context.getDataPath(), 'mariadb', context.serviceStatus.get('mariadb')?.version || '11.4', 'my.cnf');

  const getManagedOwner = async () => {
    const owner = await getProcessOnPort(port);
    if (!owner?.pid) {
      return null;
    }

    if (process.platform !== 'win32') {
      return owner;
    }

    const { getProcessDetailsByPid } = require('../../utils/SpawnUtils');
    const details = await getProcessDetailsByPid(owner.pid);
    if (!details) {
      return null;
    }

    const normalizedExecutablePath = path.normalize(details.executablePath || '').toLowerCase();
    const normalizedExpectedExecutablePath = path.normalize(expectedExecutablePath).toLowerCase();
    const normalizedCommandLine = String(details.commandLine || '').toLowerCase();
    const normalizedExpectedConfigPath = path.normalize(expectedConfigPath).toLowerCase();

    if (normalizedExecutablePath === normalizedExpectedExecutablePath
      && normalizedCommandLine.includes(`--defaults-file=${normalizedExpectedConfigPath}`)) {
      return { pid: owner.pid, details };
    }

    return null;
  };

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await isPortAvailable(port)) {
      return { state: 'available', ownerPid: null };
    }

    const managedOwner = await getManagedOwner();
    if (managedOwner && await context.checkPortOpen(port)) {
      return { state: 'managed-running', ownerPid: managedOwner.pid };
    }

    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  if (await isPortAvailable(port)) {
    return { state: 'available', ownerPid: null };
  }

  const managedOwner = await getManagedOwner();
  if (managedOwner && await context.checkPortOpen(port)) {
    return { state: 'managed-running', ownerPid: managedOwner.pid };
  }

  return { state: 'busy', ownerPid: managedOwner?.pid || null };
}

module.exports = {
  // MariaDB
  async startMariaDB(version = '11.4') {
    const mariadbPath = this.getMariaDBPath(version);
    const mariadbd = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');

    await this.ensureWindowsRuntimeDlls(mariadbPath, `MariaDB ${version}`);

    if (!await fs.pathExists(mariadbd)) {
      this.managers.log?.systemError(`MariaDB ${version} binary not found. Please download MariaDB from the Binary Manager.`);
      const status = this.serviceStatus.get('mariadb');
      status.status = 'not_installed';
      status.error = `MariaDB ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    await this.ensureLinuxServiceRuntimeDependencies('mariadb', version, [
      mariadbd,
      path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadb-install-db.exe' : 'mariadb-install-db'),
    ]);

    const processKey = this.getProcessKey('mariadb', version);
    if (this.processes.has(processKey)) {
      return;
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'mariadb', version, 'data');
    const status = this.serviceStatus.get('mariadb');

    const defaultPort = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      let portState = await waitForMariaDbPortState(this, defaultPort, mariadbPath);

      if (portState.state === 'managed-running') {
        this.serviceConfigs.mariadb.actualPort = defaultPort;
        this.runningVersions.get('mariadb').set(version, { port: defaultPort, startedAt: new Date() });
        status.port = defaultPort;
        status.version = version;
        status.status = 'running';
        status.startedAt = Date.now();
        return;
      }

      if (portState.state === 'busy' && process.platform === 'win32' && portState.ownerPid) {
        const { killProcessByPid } = require('../../utils/SpawnUtils');

        await killProcessByPid(portState.ownerPid, true);

        portState = await waitForMariaDbPortState(this, defaultPort, mariadbPath, 5000);
        if (portState.state === 'managed-running') {
          this.serviceConfigs.mariadb.actualPort = defaultPort;
          this.runningVersions.get('mariadb').set(version, { port: defaultPort, startedAt: new Date() });
          status.port = defaultPort;
          status.version = version;
          status.status = 'running';
          status.startedAt = Date.now();
          return;
        }
      }

      if (portState.state === 'available') {
        port = defaultPort;
      } else {
        throw new Error(`MariaDB ${version} cannot start because port ${defaultPort} is already in use.`);
      }
    }

    this.serviceConfigs.mariadb.actualPort = port;

    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    if (!isInitialized) {
      await this.initializeMariaDBData(mariadbPath, dataDir);
    }

    const configPath = path.join(dataPath, 'mariadb', version, 'my.cnf');
    const initFile = await this.createCredentialsInitFile('mariadb', version);

    await this.createMariaDBConfig(configPath, dataDir, port, version, initFile);

    const proc = spawnHidden(mariadbd, [`--defaults-file=${configPath}`], {
      cwd: mariadbPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let startupStdout = '';
    let startupStderr = '';

    proc.stdout.on('data', (data) => {
      startupStdout = this.appendProcessOutputSnippet(startupStdout, data);
      this.managers.log?.service('mariadb', data.toString());
    });

    proc.stderr.on('data', (data) => {
      startupStderr = this.appendProcessOutputSnippet(startupStderr, data);
      this.managers.log?.service('mariadb', data.toString(), 'error');
    });

    proc.on('error', (error) => {
      this.processes.delete(processKey);
      this.runningVersions.get('mariadb')?.delete(version);
      this.managers.log?.systemError('MariaDB process error', { error: error.message });
      this.logServiceStartupFailure('MariaDB', version, {
        error: error.message, configPath, mariadbPath, dataDir,
        stdout: startupStdout, stderr: startupStderr,
      });
      const status = this.serviceStatus.get('mariadb');
      status.status = 'error';
      status.error = error.message;
    });

    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('mariadb');
      this.processes.delete(processKey);
      if (code !== 0 || (status.status !== 'running' && (startupStdout || startupStderr))) {
        this.logServiceStartupFailure('MariaDB', version, {
          code, configPath, mariadbPath, dataDir,
          stdout: startupStdout, stderr: startupStderr,
        });
      }
      this.runningVersions.get('mariadb')?.delete(version);
      if (status.status === 'running') {
        status.status = 'stopped';
      }
    });

    this.processes.set(processKey, proc);
    status.pid = proc.pid;
    status.port = port;
    status.version = version;

    this.runningVersions.get('mariadb').set(version, { port, startedAt: new Date() });

    const startupFailurePromise = new Promise((_, reject) => {
      proc.once('error', (error) => {
        const currentStatus = this.serviceStatus.get('mariadb');
        if (currentStatus?.status === 'running') {
          return;
        }

        reject(error);
      });

      proc.once('exit', (code, signal) => {
        const currentStatus = this.serviceStatus.get('mariadb');
        if (currentStatus?.status === 'running') {
          return;
        }

        const detail = [
          startupStderr || startupStdout || null,
          code !== null && code !== undefined ? `exit code ${code}` : null,
          signal ? `signal ${signal}` : null,
        ].filter(Boolean).join(' | ');

        reject(new Error(detail ? `MariaDB exited before becoming ready: ${detail}` : 'MariaDB exited before becoming ready'));
      });
    });

    try {
      await Promise.race([
        this.waitForService('mariadb', 30000),
        startupFailurePromise,
      ]);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`MariaDB ${version} failed to start`, { error: error.message });
      status.status = 'error';
      status.error = error.message;
      this.runningVersions.get('mariadb').delete(version);
      this.processes.delete(processKey);
    }
  },

  async startMariaDBDirect(version = '11.4') {
    const mariadbPath = this.getMariaDBPath(version);
    const mariadbd = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');

    if (!await fs.pathExists(mariadbd)) {
      throw new Error(`MariaDB ${version} binary not found`);
    }

    await this.ensureLinuxServiceRuntimeDependencies('mariadb', version, [
      mariadbd,
      path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadb-install-db.exe' : 'mariadb-install-db'),
    ]);

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'mariadb', version, 'data');
    const configPath = path.join(dataPath, 'mariadb', version, 'my.cnf');

    const defaultPort = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MariaDB`);
      }
    }

    this.serviceConfigs.mariadb.actualPort = port;

    const initFile = await this.createCredentialsInitFile('mariadb', version);
    await this.createMariaDBConfig(configPath, dataDir, port, version, initFile);

    const proc = spawn(mariadbd, [`--defaults-file=${configPath}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('mariadb', data.toString());
    });
    proc.stderr.on('data', (data) => {
      this.managers.log?.service('mariadb', data.toString(), 'error');
    });
    proc.on('error', (error) => {
      this.managers.log?.systemError('MariaDB process error', { error: error.message });
    });
    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('mariadb');
      if (status.status === 'running') {
        status.status = 'stopped';
        this.runningVersions.get('mariadb')?.delete(version);
      }
    });

    this.processes.set(this.getProcessKey('mariadb', version), proc);
    const status = this.serviceStatus.get('mariadb');
    status.pid = proc.pid;
    status.port = port;
    status.version = version;

    this.runningVersions.get('mariadb').set(version, { port, startedAt: new Date() });

    await this.waitForService('mariadb', 30000);
    status.status = 'running';
    status.startedAt = Date.now();
  },

  async startMariaDBWithSkipGrant(version = '11.4', initFile = null) {
    const mariadbPath = this.getMariaDBPath(version);
    const mariadbd = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadbd.exe' : 'mariadbd');

    await this.ensureWindowsRuntimeDlls(mariadbPath, `MariaDB ${version}`);

    if (!await fs.pathExists(mariadbd)) {
      throw new Error(`MariaDB ${version} binary not found`);
    }

    await this.ensureLinuxServiceRuntimeDependencies('mariadb', version, [
      mariadbd,
      path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadb-install-db.exe' : 'mariadb-install-db'),
    ]);

    const processKey = this.getProcessKey('mariadb', version);
    const existingProc = this.processes.get(processKey);
    if (existingProc) {
      await this.killProcess(existingProc);
      this.processes.delete(processKey);
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'mariadb', version, 'data');

    const defaultPort = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
    }

    this.serviceConfigs.mariadb.actualPort = port;

    const configPath = path.join(dataPath, 'mariadb', version, 'my_skipgrant.cnf');
    await this.createMariaDBConfigWithSkipGrant(configPath, dataDir, port, version, mariadbPath, initFile);

    const proc = spawn(mariadbd, [`--defaults-file=${configPath}`], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', () => {});

    this.processes.set(this.getProcessKey('mariadb', version), proc);
    const status = this.serviceStatus.get('mariadb');
    status.port = port;
    status.version = version;

    this.runningVersions.get('mariadb').set(version, { port, startedAt: new Date() });

    await this.waitForNamedPipeReady(`MARIADB_${version.replace(/\./g, '')}_SKIP`, 30000);
    status.status = 'running';
  },

  async initializeMariaDBData(mariadbPath, dataDir) {
    const installDb = path.join(mariadbPath, 'bin', process.platform === 'win32' ? 'mariadb-install-db.exe' : 'mariadb-install-db');

    await this.ensureLinuxServiceRuntimeDependencies('mariadb', null, [installDb]);

    await fs.ensureDir(dataDir);

    return new Promise((resolve, reject) => {
      const proc = spawn(installDb, [`--datadir=${dataDir}`], {
        cwd: mariadbPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => (stderr += data.toString()));

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`MariaDB initialization failed: ${stderr}`));
        }
      });
    });
  },

  async createMariaDBConfig(configPath, dataDir, port, version = '11.4', initFile = null) {
    await fs.ensureDir(path.dirname(configPath));
    const isWindows = process.platform === 'win32';
    const mariadbPath = this.getMariaDBPath(version);

    const initFileLine = initFile ? `init-file=${this.quoteConfigPath(initFile)}\n` : '';

    const settings = this.configStore?.get('settings', {}) || {};
    const timezone = settings.serverTimezone || 'UTC';
    const timezoneOffset = this.getTimezoneOffset(timezone);

    let config;
    if (isWindows) {
      config = `[mysqld]
    basedir=${this.quoteConfigPath(mariadbPath)}
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=127.0.0.1
enable_named_pipe=ON
socket=MARIADB_${version.replace(/\./g, '')}
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mariadb.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error.log'))}
default-time-zone='${timezoneOffset}'
${initFileLine}innodb_buffer_pool_size=128M
max_connections=100

[client]
port=${port}
socket=MARIADB_${version.replace(/\./g, '')}
`;
    } else {
      config = `[mysqld]
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=127.0.0.1
    socket=${this.quoteConfigPath(path.join(dataDir, 'mariadb.sock'))}
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mariadb.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error.log'))}
default-time-zone='${timezoneOffset}'
${initFileLine}
[client]
port=${port}
    socket=${this.quoteConfigPath(path.join(dataDir, 'mariadb.sock'))}
`;
    }

    await fs.writeFile(configPath, config);
  },

  async createMariaDBConfigWithSkipGrant(configPath, dataDir, port, version, mariadbPath, initFile = null) {
    const isWindows = process.platform === 'win32';

    const initFileLine = initFile ? `init-file=${this.quoteConfigPath(initFile)}\n` : '';

    let config;
    if (isWindows) {
      config = `[mysqld]
    basedir=${this.quoteConfigPath(mariadbPath)}
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=0.0.0.0
enable-named-pipe=ON
socket=MARIADB_${version.replace(/\./g, '')}_SKIP
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mariadb_skip.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error_skip.log'))}
skip-grant-tables
${initFileLine}innodb_buffer_pool_size=128M
max_connections=100

[client]
port=${port}
`;
    } else {
      config = `[mysqld]
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=127.0.0.1
    socket=${this.quoteConfigPath(path.join(dataDir, 'mariadb_skip.sock'))}
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mariadb_skip.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error_skip.log'))}
skip-grant-tables
${initFileLine}
[client]
port=${port}
    socket=${this.quoteConfigPath(path.join(dataDir, 'mariadb_skip.sock'))}
`;
    }

    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, config);
  },
};
