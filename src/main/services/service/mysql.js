const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');

// Helper function to spawn a process hidden on Windows
function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    return spawn(command, args, { ...options, windowsHide: true });
  } else {
    return spawn(command, args, { ...options, detached: true });
  }
}

module.exports = {
  // MySQL
  async startMySQL(version = '8.4', startupOptions = {}) {
    const { attemptedRedoRecovery = false } = startupOptions;
    const mysqlPath = this.getMySQLPath(version);
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    await this.ensureWindowsRuntimeDlls(mysqlPath, `MySQL ${version}`);

    if (!await fs.pathExists(mysqldPath)) {
      this.managers.log?.systemError(`MySQL ${version} binary not found. Please download MySQL from the Binary Manager.`);
      const status = this.serviceStatus.get('mysql');
      status.status = 'not_installed';
      status.error = `MySQL ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const processKey = this.getProcessKey('mysql', version);
    if (this.processes.has(processKey)) {
      return;
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'mysql', version, 'data');
    const configPath = path.join(dataPath, 'mysql', version, 'my.cnf');
    const legacyDataDir = this.getLegacyMySQLDataDir(version);
    const shareMessagesPath = path.join(mysqlPath, 'share', 'messages_to_error_log.txt');

    const defaultPort = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MySQL starting from ${defaultPort}`);
      }
    }

    this.serviceConfigs.mysql.actualPort = port;

    await fs.ensureDir(dataDir);

    const adoptedLegacyData = await this.maybeAdoptLegacyMySQLData(version, dataDir);

    const isInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));

    this.managers.log?.systemInfo(`MySQL ${version} startup context`, {
      mysqlPath,
      mysqldPath,
      dataPath,
      dataDir,
      legacyDataDir,
      configPath,
      shareMessagesPath,
      adoptedLegacyData,
      isInitialized,
    });

    if (!isInitialized) {
      try {
        await this.initializeMySQLData(mysqlPath, dataDir, version);
      } catch (error) {
        this.managers.log?.systemError('MySQL initialization failed', { error: error.message });
        const status = this.serviceStatus.get('mysql');
        status.status = 'error';
        status.error = `Initialization failed: ${error.message}`;
        return;
      }
    }

    const initFile = await this.createCredentialsInitFile('mysql', version);

    await fs.ensureDir(path.dirname(configPath));
    await this.createMySQLConfig(configPath, dataDir, port, version, initFile);

    let proc;
    let startupStdout = '';
    let startupStderr = '';
    if (process.platform === 'win32') {
      proc = spawnHidden(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        startupStdout = this.appendProcessOutputSnippet(startupStdout, data);
        this.managers.log?.service('mysql', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        startupStderr = this.appendProcessOutputSnippet(startupStderr, data);
        this.managers.log?.service('mysql', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('MySQL process error', { error: error.message });
        this.logServiceStartupFailure('MySQL', version, {
          error: error.message, configPath, mysqlPath, dataDir,
          stdout: startupStdout, stderr: startupStderr,
        });
        const status = this.serviceStatus.get('mysql');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', (code) => {
        const status = this.serviceStatus.get('mysql');
        this.processes.delete(processKey);
        if (code !== 0 || (status.status !== 'running' && (startupStdout || startupStderr))) {
          this.logServiceStartupFailure('MySQL', version, {
            code, configPath, mysqlPath, dataDir,
            stdout: startupStdout, stderr: startupStderr,
          });
        }
        if (status.status === 'running') {
          status.status = 'stopped';
          this.runningVersions.get('mysql')?.delete(version);
        }
      });
    } else {
      proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        startupStdout = this.appendProcessOutputSnippet(startupStdout, data);
        this.managers.log?.service('mysql', data.toString());
      });

      proc.stderr.on('data', (data) => {
        startupStderr = this.appendProcessOutputSnippet(startupStderr, data);
        this.managers.log?.service('mysql', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('MySQL process error', { error: error.message });
        this.logServiceStartupFailure('MySQL', version, {
          error: error.message, configPath, mysqlPath, dataDir,
          stdout: startupStdout, stderr: startupStderr,
        });
        const status = this.serviceStatus.get('mysql');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', (code) => {
        const status = this.serviceStatus.get('mysql');
        this.processes.delete(processKey);
        if (code !== 0 || (status.status !== 'running' && (startupStdout || startupStderr))) {
          this.logServiceStartupFailure('MySQL', version, {
            code, configPath, mysqlPath, dataDir,
            stdout: startupStdout, stderr: startupStderr,
          });
        }
        if (status.status === 'running') {
          status.status = 'stopped';
          this.runningVersions.get('mysql')?.delete(version);
        }
      });
    }

    this.processes.set(processKey, proc);
    const status = this.serviceStatus.get('mysql');
    status.port = port;
    status.version = version;

    this.runningVersions.get('mysql').set(version, { port, startedAt: new Date() });

    try {
      await this.waitForService('mysql', 30000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      const errorLogTail = await this.getMySQLErrorLogTail(dataDir);

      if (!attemptedRedoRecovery && await this.hasRecoverableMySQLRedoCorruption(dataDir)) {
        try {
          await this.recoverCorruptMySQLRedoLogs(version, dataDir);
          this.runningVersions.get('mysql').delete(version);
          status.status = 'stopped';
          status.error = null;
          status.startedAt = null;
          status.pid = null;
          return this.startMySQL(version, { attemptedRedoRecovery: true });
        } catch (recoveryError) {
          this.managers.log?.systemError(`MySQL ${version} redo recovery failed`, {
            error: recoveryError.message, dataDir,
          });
        }
      }

      this.managers.log?.systemError(`MySQL ${version} failed to start`, {
        error: error.message,
        errorLogTail: errorLogTail || undefined,
      });
      status.status = 'error';
      status.error = errorLogTail
        ? `Failed to start. ${errorLogTail.split('\n').at(-1)}`
        : 'Failed to start within timeout. Check logs for details.';
      this.runningVersions.get('mysql').delete(version);
    }
  },

  // Start MySQL directly without credential verification
  async startMySQLDirect(version = '8.4') {
    const mysqlPath = this.getMySQLPath(version);
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    await this.ensureWindowsRuntimeDlls(mysqlPath, `MySQL ${version}`);

    if (!await fs.pathExists(mysqldPath)) {
      throw new Error(`MySQL ${version} binary not found`);
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'mysql', version, 'data');
    const configPath = path.join(dataPath, 'mysql', version, 'my.cnf');

    const defaultPort = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for MySQL`);
      }
    }

    this.serviceConfigs.mysql.actualPort = port;

    const initFile = await this.createCredentialsInitFile('mysql', version);
    await this.createMySQLConfig(configPath, dataDir, port, version, initFile);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }

    let startupStdout = '';
    let startupStderr = '';

    proc.stdout?.on('data', (data) => {
      startupStdout = this.appendProcessOutputSnippet(startupStdout, data);
      this.managers.log?.service('mysql', data.toString());
    });
    proc.stderr?.on('data', (data) => {
      startupStderr = this.appendProcessOutputSnippet(startupStderr, data);
      this.managers.log?.service('mysql', data.toString(), 'error');
    });
    proc.on('error', (error) => {
      this.managers.log?.systemError('MySQL process error', { error: error.message });
      this.logServiceStartupFailure('MySQL', version, {
        error: error.message, configPath, mysqlPath, dataDir,
        stdout: startupStdout, stderr: startupStderr,
      });
    });
    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('mysql');
      if (code !== 0 || (status.status !== 'running' && (startupStdout || startupStderr))) {
        this.logServiceStartupFailure('MySQL', version, {
          code, configPath, mysqlPath, dataDir,
          stdout: startupStdout, stderr: startupStderr,
        });
      }
      if (status.status === 'running') {
        status.status = 'stopped';
        this.runningVersions.get('mysql')?.delete(version);
      }
    });

    this.processes.set(this.getProcessKey('mysql', version), proc);
    const status = this.serviceStatus.get('mysql');
    status.port = port;
    status.version = version;

    this.runningVersions.get('mysql').set(version, { port, startedAt: new Date() });

    await this.waitForService('mysql', 30000);
    status.status = 'running';
    status.startedAt = Date.now();
  },

  async startMySQLWithSkipGrant(version = '8.4', initFile = null) {
    const mysqlPath = this.getMySQLPath(version);
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');

    await this.ensureWindowsRuntimeDlls(mysqlPath, `MySQL ${version}`);

    if (!await fs.pathExists(mysqldPath)) {
      throw new Error(`MySQL ${version} binary not found`);
    }

    const processKey = this.getProcessKey('mysql', version);
    const existingProc = this.processes.get(processKey);
    if (existingProc) {
      await this.killProcess(existingProc);
      this.processes.delete(processKey);
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'mysql', version, 'data');

    const defaultPort = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
    }

    this.serviceConfigs.mysql.actualPort = port;

    const configPath = path.join(dataPath, 'mysql', version, 'my_skipgrant.cnf');
    await this.createMySQLConfigWithSkipGrant(configPath, dataDir, port, version, initFile);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } else {
      proc = spawn(mysqldPath, [`--defaults-file=${configPath}`], {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
    }

    proc.stdout?.on('data', () => {});
    proc.stderr?.on('data', () => {});

    this.processes.set(this.getProcessKey('mysql', version), proc);
    const status = this.serviceStatus.get('mysql');
    status.port = port;
    status.version = version;

    this.runningVersions.get('mysql').set(version, { port, startedAt: new Date() });

    await this.waitForNamedPipeReady(`MYSQL_${version.replace(/\./g, '')}_SKIP`, 30000);
    status.status = 'running';
  },

  async initializeMySQLData(mysqlPath, dataDir, version = '8.4') {
    const mysqldPath = path.join(mysqlPath, 'bin', process.platform === 'win32' ? 'mysqld.exe' : 'mysqld');
    const shareDir = path.join(mysqlPath, 'share');
    const shareMessagesFile = path.join(shareDir, 'messages_to_error_log.txt');

    await this.ensureWindowsRuntimeDlls(mysqlPath, `MySQL ${version}`);

    if (!await fs.pathExists(shareMessagesFile)) {
      throw new Error(`MySQL ${version} installation is incomplete (missing share/messages_to_error_log.txt). Please re-download from Binary Manager.`);
    }

    await fs.emptyDir(dataDir);

    return new Promise((resolve, reject) => {
      const args = [
        '--initialize-insecure',
        `--basedir=${mysqlPath}`,
        `--datadir=${dataDir}`,
        '--console'
      ];

      const proc = spawn(mysqldPath, args, {
        cwd: mysqlPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      proc.stdout?.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (error) => {
        if (settled) return;
        settled = true;
        reject(new Error(`MySQL initialization failed to launch: ${error.message}`));
      });

      proc.on('exit', (code) => {
        if (settled) return;
        settled = true;
        if (code === 0) {
          resolve();
        } else {
          const details = [stderr.trim(), stdout.trim()].filter(Boolean).join(' | ');
          const suffix = details ? `: ${details}` : ` (exit code ${code}, no output captured)`;
          reject(new Error(`MySQL initialization failed${suffix}`));
        }
      });
    });
  },

  async createMySQLConfig(configPath, dataDir, port, version = '8.4', initFile = null) {
    const isWindows = process.platform === 'win32';
    const mysqlPath = this.getMySQLPath(version);

    const initFileLine = initFile ? `init-file=${this.quoteConfigPath(initFile)}\n` : '';

    const settings = this.configStore?.get('settings', {}) || {};
    const timezone = settings.serverTimezone || 'UTC';
    const timezoneOffset = this.getTimezoneOffset(timezone);

    let config;
    if (isWindows) {
      config = `[mysqld]
    basedir=${this.quoteConfigPath(mysqlPath)}
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=0.0.0.0
enable-named-pipe=ON
socket=MYSQL_${version.replace(/\./g, '')}
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mysql.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error.log'))}
default-time-zone='${timezoneOffset}'
${initFileLine}innodb_buffer_pool_size=128M
innodb_redo_log_capacity=100M
max_connections=100
loose-mysqlx=0
skip-log-bin

[client]
port=${port}
`;
    } else {
      config = `[mysqld]
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=127.0.0.1
    socket=${this.quoteConfigPath(path.join(dataDir, 'mysql.sock'))}
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mysql.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error.log'))}
default-time-zone='${timezoneOffset}'
${initFileLine}
[client]
port=${port}
    socket=${this.quoteConfigPath(path.join(dataDir, 'mysql.sock'))}
`;
    }

    await fs.writeFile(configPath, config);
  },

  async createMySQLConfigWithSkipGrant(configPath, dataDir, port, version = '8.4', initFile = null) {
    const mysqlPath = this.getMySQLPath(version);
    const isWindows = process.platform === 'win32';

    const initFileLine = initFile ? `init-file=${this.quoteConfigPath(initFile)}\n` : '';

    let config;
    if (isWindows) {
      config = `[mysqld]
    basedir=${this.quoteConfigPath(mysqlPath)}
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=0.0.0.0
enable-named-pipe=ON
socket=MYSQL_${version.replace(/\./g, '')}_SKIP
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mysql_skip.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error_skip.log'))}
skip-grant-tables
skip-networking=0
${initFileLine}innodb_buffer_pool_size=128M
innodb_redo_log_capacity=100M
max_connections=100
loose-mysqlx=0
skip-log-bin

[client]
port=${port}
`;
    } else {
      config = `[mysqld]
    datadir=${this.quoteConfigPath(dataDir)}
port=${port}
bind-address=127.0.0.1
    socket=${this.quoteConfigPath(path.join(dataDir, 'mysql_skip.sock'))}
    pid-file=${this.quoteConfigPath(path.join(dataDir, 'mysql_skip.pid'))}
    log-error=${this.quoteConfigPath(path.join(dataDir, 'error_skip.log'))}
skip-grant-tables
${initFileLine}
[client]
port=${port}
    socket=${this.quoteConfigPath(path.join(dataDir, 'mysql_skip.sock'))}
`;
    }

    await fs.ensureDir(path.dirname(configPath));
    await fs.writeFile(configPath, config);
  },

  async syncCredentialsToAllVersions(newUser, newPassword, oldPassword = '') {
    const results = { mysql: [], mariadb: [] };

    this.managers.log?.systemInfo(`Database credentials changed: user=${newUser}, password=${newPassword ? 'set' : 'empty'}`);

    const runningMySql = this.runningVersions.get('mysql');
    const mysqlVersionsToRestart = runningMySql ? Array.from(runningMySql.keys()) : [];

    for (const version of mysqlVersionsToRestart) {
      try {
        this.managers.log?.systemInfo(`Restarting MySQL ${version} to apply new credentials...`);
        await this.stopService('mysql', version);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.startService('mysql', version);
        await new Promise(resolve => setTimeout(resolve, 2000));
        results.mysql.push({ version, success: true });
      } catch (error) {
        this.managers.log?.systemError(`Failed to restart MySQL ${version}`, { error: error.message });
        results.mysql.push({ version, success: false, error: error.message });
      }
    }

    const runningMariaDB = this.runningVersions.get('mariadb');
    const mariadbVersionsToRestart = runningMariaDB ? Array.from(runningMariaDB.keys()) : [];

    for (const version of mariadbVersionsToRestart) {
      try {
        this.managers.log?.systemInfo(`Restarting MariaDB ${version} to apply new credentials...`);
        await this.stopService('mariadb', version);
        await new Promise(resolve => setTimeout(resolve, 1000));
        await this.startService('mariadb', version);
        await new Promise(resolve => setTimeout(resolve, 2000));
        results.mariadb.push({ version, success: true });
      } catch (error) {
        this.managers.log?.systemError(`Failed to restart MariaDB ${version}`, { error: error.message });
        results.mariadb.push({ version, success: false, error: error.message });
      }
    }

    return results;
  },

  async updateMySQLCredentials(clientPath, port, newUser, newPassword, currentPassword) {
    const escapedPassword = newPassword.replace(/'/g, "''");
    const queries = [
      `ALTER USER '${newUser}'@'localhost' IDENTIFIED BY '${escapedPassword}'`,
      `ALTER USER '${newUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}'`,
      `FLUSH PRIVILEGES`,
    ];

    for (const query of queries) {
      await this.runMySQLQuery(clientPath, port, newUser, currentPassword, query);
    }
  },

  async createMySQLCredentialResetInitFile(user, password) {
    const dataPath = this.getDataPath();
    const initFile = path.join(dataPath, 'mysql_credential_reset.sql');

    const escapedPassword = password.replace(/'/g, "''");
    const sql = `
-- Reset credentials
ALTER USER '${user}'@'localhost' IDENTIFIED BY '${escapedPassword}';
ALTER USER '${user}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';
FLUSH PRIVILEGES;
`;

    await fs.writeFile(initFile, sql);
    return initFile;
  },

  async createCredentialsInitFile(serviceName, version) {
    const dataPath = this.getDataPath();
    const initFile = path.join(dataPath, serviceName, version, 'credentials_init.sql');

    const settings = this.configStore?.get('settings', {}) || {};
    const dbUser = settings.dbUser || 'root';
    const dbPassword = settings.dbPassword || '';

    await fs.ensureDir(path.dirname(initFile));

    const escapedPassword = dbPassword.replace(/'/g, "''");

    const sqlLines = [
      '-- Auto-generated credentials from DevBox Pro ConfigStore',
      '-- This file runs on every startup to ensure credentials match settings',
      '',
      "-- Create users if they don't exist (fresh install case)",
      `CREATE USER IF NOT EXISTS '${dbUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${dbUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      '',
      '-- Update password for existing users (handles password change case)',
      `ALTER USER '${dbUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${dbUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${dbUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      '',
      '-- Grant all privileges',
      `GRANT ALL PRIVILEGES ON *.* TO '${dbUser}'@'localhost' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${dbUser}'@'127.0.0.1' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${dbUser}'@'%' WITH GRANT OPTION;`,
      '',
      'FLUSH PRIVILEGES;',
      ''
    ];
    const sql = sqlLines.join('\n');

    await fs.writeFile(initFile, sql, 'utf8');
    return initFile;
  },

  async runMySQLQuery(clientPath, port, user, password, query) {
    return new Promise((resolve, reject) => {
      const args = [
        `-h127.0.0.1`,
        `-P${port}`,
        `-u${user}`,
        '-N',
        '-B',
        '-e',
        query,
      ];

      if (password) {
        args.splice(3, 0, `-p${password}`);
      }

      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          if (stderr.includes('ERROR')) {
            reject(new Error(stderr));
          } else {
            resolve();
          }
        }
      });

      proc.on('error', reject);
    });
  },

  /**
   * Convert IANA timezone name to UTC offset string for MySQL compatibility.
   */
  getTimezoneOffset(timezone) {
    const knownOffsets = {
      'UTC': '+00:00',
      'Asia/Manila': '+08:00',
      'Asia/Singapore': '+08:00',
      'Asia/Shanghai': '+08:00',
      'Asia/Hong_Kong': '+08:00',
      'Asia/Tokyo': '+09:00',
      'Asia/Seoul': '+09:00',
      'Asia/Dubai': '+04:00',
      'Asia/Kolkata': '+05:30',
      'Asia/Jakarta': '+07:00',
      'America/New_York': '-05:00',
      'America/Chicago': '-06:00',
      'America/Denver': '-07:00',
      'America/Los_Angeles': '-08:00',
      'America/Sao_Paulo': '-03:00',
      'Europe/London': '+00:00',
      'Europe/Paris': '+01:00',
      'Europe/Berlin': '+01:00',
      'Europe/Moscow': '+03:00',
      'Australia/Sydney': '+10:00',
      'Australia/Melbourne': '+10:00',
      'Pacific/Auckland': '+12:00',
    };

    if (knownOffsets[timezone]) {
      return knownOffsets[timezone];
    }

    try {
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset',
      });

      const parts = formatter.formatToParts(now);
      const tzPart = parts.find(p => p.type === 'timeZoneName');

      if (tzPart && tzPart.value) {
        const match = tzPart.value.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
        if (match) {
          const sign = match[1];
          const hours = match[2].padStart(2, '0');
          const minutes = match[3] || '00';
          return `${sign}${hours}:${minutes}`;
        }
      }
    } catch (e) {
      this.managers?.log?.systemWarn(`Invalid timezone: ${timezone}, falling back to UTC`);
    }

    return '+00:00';
  },
};
