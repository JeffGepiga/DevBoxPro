const path = require('path');
const fs = require('fs-extra');
const net = require('net');
const { SERVICE_VERSIONS } = require('../../../shared/serviceConfig');

module.exports = {
  cancelOperation(operationId) {
    const operation = this.runningOperations.get(operationId);
    if (!operation) {
      return { success: false, error: 'Operation not found or already completed' };
    }

    try {
      if (operation.proc && !operation.proc.killed) {
        operation.proc.kill('SIGTERM');
        setTimeout(() => {
          if (operation.proc && !operation.proc.killed) {
            operation.proc.kill('SIGKILL');
          }
        }, 1000);
      }
      this.runningOperations.delete(operationId);
      this.managers.log?.systemInfo('Database operation cancelled', { operationId, type: operation.type, dbName: operation.dbName });
      return { success: true };
    } catch (error) {
      this.managers.log?.systemError('Failed to cancel database operation', { operationId, error: error.message });
      return { success: false, error: error.message };
    }
  },

  getRunningOperations() {
    return Array.from(this.runningOperations.entries()).map(([id, op]) => ({
      operationId: id,
      type: op.type,
      dbName: op.dbName,
      status: op.status || 'running',
      error: op.error,
    }));
  },

  async initialize() {
    const dataPath = this.configStore.getDataPath();
    await fs.ensureDir(path.join(dataPath, 'mysql', 'backups'));
    await fs.ensureDir(path.join(dataPath, 'mariadb', 'backups'));
    await fs.ensureDir(path.join(dataPath, 'postgresql', 'backups'));
    await fs.ensureDir(path.join(dataPath, 'mongodb', 'backups'));
  },

  getActiveDatabaseType() {
    return this.configStore.getSetting('activeDatabaseType', 'mysql');
  },

  getActiveDatabaseVersion() {
    const dbType = this.getActiveDatabaseType();
    const defaultVersions = { mariadb: '11.4', mysql: '8.4', postgresql: '17', mongodb: '8.0' };
    const defaultVersion = defaultVersions[dbType] || '8.4';
    return this.configStore.getSetting('activeDatabaseVersion', defaultVersion);
  },

  async setActiveDatabaseType(dbType, version = null) {
    if (!['mysql', 'mariadb', 'postgresql', 'mongodb'].includes(dbType)) {
      throw new Error('Invalid database type. Must be "mysql", "mariadb", "postgresql", or "mongodb"');
    }
    this.configStore.setSetting('activeDatabaseType', dbType);

    if (version) {
      this.configStore.setSetting('activeDatabaseVersion', version);
    }

    return { success: true, type: dbType, version };
  },

  getDatabaseInfo() {
    const dbType = this.getActiveDatabaseType();
    const version = this.getActiveDatabaseVersion();
    const settings = this.configStore.get('settings', {});
    const isPostgres = dbType === 'postgresql';
    return {
      type: dbType,
      version,
      host: this.dbConfig.host,
      port: this.getActualPort(),
      user: isPostgres
        ? (settings.pgUser || 'postgres')
        : (settings.dbUser || 'root'),
      password: isPostgres
        ? (settings.pgPassword || '')
        : (settings.dbPassword || ''),
    };
  },

  getActualPort() {
    const dbType = this.getActiveDatabaseType();
    const version = this.getActiveDatabaseVersion();
    const settings = this.configStore.get('settings', {});

    if (this.managers.service) {
      const runningVersions = this.managers.service.runningVersions.get(dbType);
      if (runningVersions && runningVersions.has(version)) {
        const versionInfo = runningVersions.get(version);
        if (versionInfo?.port) {
          return versionInfo.port;
        }
      }

      const serviceConfig = this.managers.service.serviceConfigs[dbType];
      const basePort = serviceConfig?.defaultPort || 3306;
      const portOffset = this.managers.service.versionPortOffsets[dbType]?.[version] || 0;
      return basePort + portOffset;
    }

    const defaultPorts = { mariadb: 3306, mysql: 3306, postgresql: 5432, mongodb: 27017 };
    return defaultPorts[dbType] || (settings.mysqlPort || 3306);
  },

  isServiceRunning(dbType = null, version = null) {
    if (process.env.PLAYWRIGHT_TEST === 'true') {
      return true;
    }

    const type = dbType || this.getActiveDatabaseType();
    const ver = version || this.getActiveDatabaseVersion();

    if (this.managers.service) {
      const runningVersions = this.managers.service.runningVersions.get(type);
      if (runningVersions && runningVersions.has(ver)) {
        return true;
      }
    }
    return false;
  },

  async ensureServiceRunning(dbType = null, version = null) {
    const type = dbType || this.getActiveDatabaseType();
    const ver = version || this.getActiveDatabaseVersion();

    if (this.isServiceRunning(type, ver)) {
      return true;
    }

    if (!this.managers.service?.rehydrateManagedServiceState) {
      return false;
    }

    try {
      return await this.managers.service.rehydrateManagedServiceState(type, ver);
    } catch (error) {
      this.managers.log?.systemWarn?.('Failed to recover database service state', {
        service: type,
        version: ver,
        error: error.message,
      });
      return false;
    }
  },

  getPhpMyAdminUrl: async function(dbType = null, version = null) {
    if (!this.managers.service) {
      return null;
    }

    const pmaStatus = this.managers.service.serviceStatus.get('phpmyadmin');
    if (pmaStatus?.status !== 'running') {
      try {
        await this.managers.service.startService('phpmyadmin');
      } catch (err) {
        this.managers.log?.systemError('Failed to start phpMyAdmin', { error: err.message });
        return null;
      }
    }

    const pmaPort = this.managers.service.serviceConfigs.phpmyadmin.actualPort || 8080;
    await (async () => {
      const http = require('http');
      const maxWait = 30000;
      const start = Date.now();
      while (Date.now() - start < maxWait) {
        const ready = await new Promise((resolve) => {
          const req = http.get(`http://127.0.0.1:${pmaPort}/`, (res) => {
            res.resume();
            resolve(true);
          });
          req.setTimeout(1000, () => { req.destroy(); resolve(false); });
          req.on('error', () => resolve(false));
        });
        if (ready) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    })();

    let serverId = 1;

    if (dbType && version) {
      let installedBinaries = { mysql: {}, mariadb: {} };
      if (this.managers.binaryDownload) {
        try {
          installedBinaries = await this.managers.binaryDownload.getInstalledBinaries();
        } catch (err) {
        }
      }

      let currentId = 1;
      let found = false;

      const mysqlVersions = (SERVICE_VERSIONS.mysql || [])
        .filter(v => installedBinaries.mysql?.[v] === true)
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      for (const currentVersion of mysqlVersions) {
        if (dbType === 'mysql' && version === currentVersion) {
          serverId = currentId;
          found = true;
          break;
        }
        currentId++;
      }

      if (!found) {
        const mariadbVersions = (SERVICE_VERSIONS.mariadb || [])
          .filter(v => installedBinaries.mariadb?.[v] === true)
          .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
        for (const currentVersion of mariadbVersions) {
          if (dbType === 'mariadb' && version === currentVersion) {
            serverId = currentId;
            found = true;
            break;
          }
          currentId++;
        }
      }
    } else {
      return this.getPhpMyAdminUrl(this.getActiveDatabaseType(), this.getActiveDatabaseVersion());
    }

    return `http://localhost:${pmaPort}/index.php?server=${serverId}`;
  },

  getConnections() {
    const dbType = this.getActiveDatabaseType();
    return {
      [dbType]: {
        type: dbType,
        host: this.dbConfig.host,
        port: this.getActualPort(),
        user: this.dbConfig.user,
        status: 'connected',
      },
    };
  },

  sanitizeName(name) {
    const trimmed = String(name || '').trim();
    const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 64);
    return sanitized.replace(/_+$/, '') || 'unnamed';
  },

  _getBinaryPath(binBaseName, dbTypeOverride = null) {
    const dbType = dbTypeOverride || this.getActiveDatabaseType();
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const binName = process.platform === 'win32' ? `${binBaseName}.exe` : binBaseName;
    const candidateVersions = [];

    let version = null;
    if (this.managers.service) {
      const serviceStatus = this.managers.service.serviceStatus.get(dbType);
      if (serviceStatus?.status === 'running') {
        version = serviceStatus.version;
      }
    }

    if (version) {
      candidateVersions.push(version);
    }

    const activeType = this.getActiveDatabaseType?.();
    if (activeType === dbType) {
      const activeVersion = this.getActiveDatabaseVersion?.();
      if (activeVersion && !candidateVersions.includes(activeVersion)) {
        candidateVersions.push(activeVersion);
      }
    }

    for (const candidateVersion of candidateVersions) {
      const versionPath = path.join(this.resourcePath, dbType, candidateVersion, platform, 'bin', binName);
      if (fs.existsSync(versionPath)) {
        return versionPath;
      }
    }

    if (version) {
      const versionPath = path.join(this.resourcePath, dbType, version, platform, 'bin', binName);
      if (fs.existsSync(versionPath)) {
        return versionPath;
      }
    }

    const dbTypePath = path.join(this.resourcePath, dbType);
    if (fs.existsSync(dbTypePath)) {
      try {
        const versions = fs.readdirSync(dbTypePath).filter(currentVersion => {
          const binPath = path.join(dbTypePath, currentVersion, platform, 'bin', binName);
          return fs.existsSync(binPath);
        });
        if (versions.length > 0) {
          versions.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
          return path.join(dbTypePath, versions[0], platform, 'bin', binName);
        }
      } catch (error) {
        this.managers.log?.systemError(`Error scanning for ${binName}`, { error: error.message });
      }
    }

    const preferredVersion = candidateVersions[0];
    if (preferredVersion) {
      return path.join(this.resourcePath, dbType, preferredVersion, platform, 'bin', binName);
    }

    return path.join(this.resourcePath, dbType, platform, 'bin', binName);
  },

  getDbClientPath() {
    const dbType = this.getActiveDatabaseType();
    if (dbType === 'postgresql') return this._getBinaryPath('psql');
    if (dbType === 'mongodb') {
      const mongoshPath = this._getBinaryPath('mongosh');
      if (fs.existsSync(mongoshPath)) {
        return mongoshPath;
      }

      const legacyMongoPath = this._getBinaryPath('mongo');
      if (fs.existsSync(legacyMongoPath)) {
        return legacyMongoPath;
      }

      return mongoshPath;
    }
    return this._getBinaryPath('mysql');
  },

  getBinaryRuntimeDir(binaryPath) {
    return path.dirname(path.dirname(binaryPath));
  },

  async ensureDbBinaryRuntime(binaryPath) {
    const dbType = this.getActiveDatabaseType();
    if (process.platform !== 'win32' || (dbType !== 'mysql' && dbType !== 'mariadb')) {
      return;
    }

    await this.managers.service?.ensureWindowsRuntimeDlls?.(
      this.getBinaryRuntimeDir(binaryPath),
      `${dbType} client`
    );
  },

  buildBinarySpawnOptions(binaryPath, extraOptions = {}) {
    const dbType = this.getActiveDatabaseType();
    const runtimeDir = this.getBinaryRuntimeDir(binaryPath);

    return {
      ...extraOptions,
      windowsHide: true,
      cwd: (dbType === 'mysql' || dbType === 'mariadb') ? runtimeDir : extraOptions.cwd,
    };
  },

  getDbDumpPath() {
    const dbType = this.getActiveDatabaseType();
    if (dbType === 'postgresql') return this._getBinaryPath('pg_dump');
    if (dbType === 'mongodb') return this._getBinaryPath('mongodump');
    return this._getBinaryPath('mysqldump');
  },

  getDbRestorePath() {
    const dbType = this.getActiveDatabaseType();
    if (dbType === 'postgresql') return this._getBinaryPath('pg_restore');
    if (dbType === 'mongodb') return this._getBinaryPath('mongorestore');
    return this.getDbClientPath();
  },

  async checkConnection() {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      socket.setTimeout(3000);

      socket.on('connect', () => {
        socket.destroy();
        resolve(true);
      });

      socket.on('timeout', () => {
        socket.destroy();
        resolve(false);
      });

      socket.on('error', () => {
        resolve(false);
      });

      socket.connect(this.dbConfig.port, this.dbConfig.host);
    });
  },
};