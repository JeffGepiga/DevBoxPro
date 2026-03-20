const path = require('path');
const fs = require('fs-extra');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');

function spawnHidden(command, args, options = {}) {
  const { spawn } = require('child_process');
  if (process.platform === 'win32') {
    return spawn(command, args, { ...options, windowsHide: true });
  } else {
    return spawn(command, args, { ...options, detached: true });
  }
}

module.exports = {
  // PostgreSQL
  async startPostgreSQL(version = '17') {
    const pgBasePath = this.getPostgresqlPath(version);
    const pgBin = path.join(pgBasePath, 'bin');
    const postgresExe = path.join(pgBin, process.platform === 'win32' ? 'postgres.exe' : 'postgres');
    const initdbExe = path.join(pgBin, process.platform === 'win32' ? 'initdb.exe' : 'initdb');

    if (!await fs.pathExists(postgresExe)) {
      this.managers.log?.systemError(`PostgreSQL ${version} binary not found. Please download from Binary Manager.`);
      const status = this.serviceStatus.get('postgresql');
      status.status = 'not_installed';
      status.error = `PostgreSQL ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'postgresql', version, 'data');
    await fs.ensureDir(dataDir);

    const shareDir = path.join(pgBasePath, 'share');
    const shareBki = path.join(shareDir, 'postgres.bki');
    if (!await fs.pathExists(shareBki)) {
      const errMsg = `PostgreSQL ${version} installation is incomplete (missing share/postgres.bki). Please re-download from Binary Manager.`;
      this.managers.log?.systemError(errMsg);
      const status = this.serviceStatus.get('postgresql');
      status.status = 'error';
      status.error = errMsg;
      throw new Error(errMsg);
    }

    const pgVersionFile = path.join(dataDir, 'PG_VERSION');
    if (!await fs.pathExists(pgVersionFile)) {
      const contents = await fs.readdir(dataDir).catch(() => []);
      if (contents.length > 0) {
        this.managers.log?.systemInfo(`Cleaning up incomplete PostgreSQL ${version} data directory...`);
        await fs.emptyDir(dataDir);
      }

      this.managers.log?.systemInfo(`Initializing PostgreSQL ${version} data directory...`);
      await new Promise((resolve, reject) => {
        const proc = spawnHidden(initdbExe, [
          '--pgdata', dataDir,
          '--username', 'postgres',
          '--auth', 'trust',
          '--encoding', 'UTF8',
          '--locale', 'C',
          '-L', shareDir,
        ], { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stdout?.on('data', (d) => this.managers.log?.service('postgresql', d.toString()));
        proc.stderr?.on('data', (d) => {
          const msg = d.toString();
          stderr += msg;
          this.managers.log?.service('postgresql', msg, 'error');
        });
        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`initdb failed (code ${code})${stderr ? ': ' + stderr.trim() : ''}`));
          }
        });
        proc.on('error', reject);
      });
    }

    const defaultPort = this.getVersionPort('postgresql', version, this.serviceConfigs.postgresql.defaultPort);
    let port = defaultPort;
    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) throw new Error(`No port available for PostgreSQL starting from ${defaultPort}`);
    }

    this.serviceConfigs.postgresql.actualPort = port;

    const logFile = path.join(dataPath, 'logs', `postgresql-${version}.log`);
    await fs.ensureDir(path.dirname(logFile));

    const proc = spawnHidden(postgresExe, [
      '-D', dataDir,
      '-p', String(port),
      '-k', dataDir,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d) => this.managers.log?.service('postgresql', d.toString()));
    proc.stderr?.on('data', (d) => this.managers.log?.service('postgresql', d.toString(), 'error'));

    this.processes.set(this.getProcessKey('postgresql', version), proc);
    const status = this.serviceStatus.get('postgresql');
    status.port = port;
    status.version = version;
    this.runningVersions.get('postgresql').set(version, { port, startedAt: new Date() });

    try {
      await this.waitForService('postgresql', 30000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`PostgreSQL ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = error.message;
      this.runningVersions.get('postgresql').delete(version);
      throw error;
    }
  },

  // MongoDB
  async startMongoDB(version = '8.0') {
    const mongoBasePath = this.getMongodbPath(version);
    const mongodExe = path.join(mongoBasePath, 'bin', process.platform === 'win32' ? 'mongod.exe' : 'mongod');

    if (!await fs.pathExists(mongodExe)) {
      this.managers.log?.systemError(`MongoDB ${version} binary not found. Please download from Binary Manager.`);
      const status = this.serviceStatus.get('mongodb');
      status.status = 'not_installed';
      status.error = `MongoDB ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'mongodb', version, 'data');
    const logFile = path.join(dataPath, 'logs', `mongodb-${version}.log`);
    await fs.ensureDir(dataDir);
    await fs.ensureDir(path.dirname(logFile));

    const defaultPort = this.getVersionPort('mongodb', version, this.serviceConfigs.mongodb.defaultPort);
    let port = defaultPort;
    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) throw new Error(`No port available for MongoDB starting from ${defaultPort}`);
    }

    this.serviceConfigs.mongodb.actualPort = port;

    const proc = spawnHidden(mongodExe, [
      '--dbpath', dataDir,
      '--port', String(port),
      '--logpath', logFile,
      '--bind_ip', '127.0.0.1',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d) => this.managers.log?.service('mongodb', d.toString()));
    proc.stderr?.on('data', (d) => this.managers.log?.service('mongodb', d.toString(), 'error'));

    this.processes.set(this.getProcessKey('mongodb', version), proc);
    const status = this.serviceStatus.get('mongodb');
    status.port = port;
    status.version = version;
    this.runningVersions.get('mongodb').set(version, { port, startedAt: new Date() });

    try {
      await this.waitForService('mongodb', 30000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`MongoDB ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = error.message;
      this.runningVersions.get('mongodb').delete(version);
      throw error;
    }
  },

  // Memcached
  async startMemcached(version = '1.6') {
    const memcachedDir = this.getMemcachedPath(version);
    const memcachedExe = path.join(memcachedDir, process.platform === 'win32' ? 'memcached.exe' : 'memcached');

    if (!await fs.pathExists(memcachedExe)) {
      this.managers.log?.systemError(`Memcached ${version} binary not found. Please download from Binary Manager.`);
      const status = this.serviceStatus.get('memcached');
      status.status = 'not_installed';
      status.error = `Memcached ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const defaultPort = this.getVersionPort('memcached', version, this.serviceConfigs.memcached.defaultPort);
    let port = defaultPort;
    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) throw new Error(`No port available for Memcached starting from ${defaultPort}`);
    }

    this.serviceConfigs.memcached.actualPort = port;

    const proc = spawnHidden(memcachedExe, [
      '-p', String(port),
      '-l', '127.0.0.1',
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (d) => this.managers.log?.service('memcached', d.toString()));
    proc.stderr?.on('data', (d) => this.managers.log?.service('memcached', d.toString(), 'error'));

    this.processes.set(this.getProcessKey('memcached', version), proc);
    const status = this.serviceStatus.get('memcached');
    status.port = port;
    status.version = version;
    this.runningVersions.get('memcached').set(version, { port, startedAt: new Date() });

    try {
      await this.waitForService('memcached', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`Memcached ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = error.message;
      this.runningVersions.get('memcached').delete(version);
      throw error;
    }
  },

  // MinIO
  async startMinIO() {
    const minioDir = this.getMinioPath();
    const minioExe = path.join(minioDir, process.platform === 'win32' ? 'minio.exe' : 'minio');

    if (!await fs.pathExists(minioExe)) {
      this.managers.log?.systemError('MinIO binary not found. Please download from Binary Manager.');
      const status = this.serviceStatus.get('minio');
      status.status = 'not_installed';
      status.error = 'MinIO binary not found. Please download from Binary Manager.';
      return;
    }

    const dataPath = this.getDataPath();
    const minioDataDir = path.join(dataPath, 'minio', 'data');
    await fs.ensureDir(minioDataDir);

    const defaultPort = this.serviceConfigs.minio.defaultPort;
    const defaultConsolePort = this.serviceConfigs.minio.consolePort;
    let port = defaultPort;
    let consolePort = defaultConsolePort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) throw new Error(`No port available for MinIO starting from ${defaultPort}`);
    }
    if (!await isPortAvailable(consolePort)) {
      consolePort = await findAvailablePort(defaultConsolePort, 100);
      if (!consolePort) throw new Error(`No port available for MinIO console starting from ${defaultConsolePort}`);
    }

    this.serviceConfigs.minio.actualPort = port;
    this.serviceConfigs.minio.actualConsolePort = consolePort;

    const proc = spawnHidden(minioExe, [
      'server', minioDataDir,
      '--address', `127.0.0.1:${port}`,
      '--console-address', `127.0.0.1:${consolePort}`,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      },
    });

    proc.stdout?.on('data', (d) => this.managers.log?.service('minio', d.toString()));
    proc.stderr?.on('data', (d) => this.managers.log?.service('minio', d.toString(), 'error'));

    this.processes.set('minio', proc);
    const status = this.serviceStatus.get('minio');
    status.port = port;
    status.consolePort = consolePort;

    try {
      await this.waitForService('minio', 15000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError('MinIO failed to become ready', { error: error.message });
      status.status = 'error';
      status.error = error.message;
      throw error;
    }
  },
};
