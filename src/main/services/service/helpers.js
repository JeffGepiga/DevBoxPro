const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');

module.exports = {
  getDataPath() {
    if (typeof this.configStore.getDataPath === 'function') {
      return this.configStore.getDataPath();
    }

    if (typeof this.configStore.get === 'function') {
      const configuredDataPath = this.configStore.get('dataPath');
      if (configuredDataPath) {
        return configuredDataPath;
      }
    }

    return path.join(app.getPath('userData'), 'data');
  },

  getLegacyUserDataPath() {
    return path.join(app.getPath('userData'), 'data');
  },

  getLegacyMySQLDataDir(version = '8.4') {
    return path.join(this.getLegacyUserDataPath(), 'mysql', version, 'data');
  },

  getBundledVCRedistDirs() {
    const appPath = typeof app.getAppPath === 'function' ? app.getAppPath() : process.cwd();
    return [
      process.resourcesPath ? path.join(process.resourcesPath, 'vcredist') : null,
      path.join(appPath, 'vcredist'),
      path.resolve(__dirname, '../../../../vcredist'),
    ].filter(Boolean);
  },

  quoteConfigPath(value) {
    return `"${String(value).replace(/\\/g, '/')}"`;
  },

  async maybeAdoptLegacyMySQLData(version, dataDir) {
    const legacyDataDir = this.getLegacyMySQLDataDir(version);

    if (path.resolve(legacyDataDir) === path.resolve(dataDir)) {
      return false;
    }

    const currentInitialized = await fs.pathExists(path.join(dataDir, 'mysql'));
    if (currentInitialized) {
      return false;
    }

    const legacyInitialized = await fs.pathExists(path.join(legacyDataDir, 'mysql'));
    if (!legacyInitialized) {
      return false;
    }

    let targetEntries = [];
    try {
      targetEntries = await fs.readdir(dataDir);
    } catch (_error) {
      targetEntries = [];
    }

    if (targetEntries.length > 0) {
      this.managers.log?.systemWarn(`Skipped adopting legacy MySQL ${version} data because the target directory is not empty`, {
        dataDir,
        legacyDataDir,
        entries: targetEntries,
      });
      return false;
    }

    await fs.copy(legacyDataDir, dataDir, { overwrite: false, errorOnExist: false });
    this.managers.log?.systemInfo(`Adopted legacy MySQL ${version} data directory`, {
      from: legacyDataDir,
      to: dataDir,
    });
    return true;
  },

  async ensureWindowsRuntimeDlls(targetDir, label = 'runtime') {
    if (process.platform !== 'win32') {
      return;
    }

    const requiredDlls = ['vcruntime140.dll', 'msvcp140.dll', 'vcruntime140_1.dll'];
    const missingDlls = [];

    for (const dll of requiredDlls) {
      if (!await fs.pathExists(path.join(targetDir, dll))) {
        missingDlls.push(dll);
      }
    }

    if (missingDlls.length === 0) {
      return;
    }

    const sourceDirs = [
      path.join(process.env.SystemRoot || 'C:\\Windows', 'System32'),
      ...this.getBundledVCRedistDirs(),
    ];

    for (const dll of missingDlls) {
      const destPath = path.join(targetDir, dll);
      let copied = false;

      for (const sourceDir of sourceDirs) {
        const sourcePath = path.join(sourceDir, dll);
        try {
          if (!await fs.pathExists(sourcePath)) {
            continue;
          }

          await fs.copy(sourcePath, destPath, { overwrite: true });
          this.managers.log?.systemInfo(`Provisioned ${dll} for ${label}`, { sourcePath, destPath });
          copied = true;
          break;
        } catch (error) {
          this.managers.log?.systemWarn(`Failed to provision ${dll} for ${label}`, {
            sourcePath,
            destPath,
            error: error.message,
          });
        }
      }

      if (!copied) {
        this.managers.log?.systemWarn(`Could not find ${dll} for ${label}`, { targetDir });
      }
    }
  },

  async ensureLinuxServiceRuntimeDependencies(serviceName, version = null, binaryPaths = []) {
    if (process.platform !== 'linux') {
      return { success: true, skipped: true };
    }

    const binaryManager = this.managers?.binaryDownload;
    if (!binaryManager?.ensureLinuxBinarySystemDependencies) {
      return { success: true, skipped: true };
    }

    return binaryManager.ensureLinuxBinarySystemDependencies(serviceName, version, binaryPaths);
  },

  appendProcessOutputSnippet(existingOutput, chunk, maxLength = 4000) {
    const normalizedChunk = String(chunk || '').trim();
    if (!normalizedChunk) {
      return existingOutput || '';
    }

    const combined = existingOutput ? `${existingOutput}\n${normalizedChunk}` : normalizedChunk;
    return combined.length > maxLength ? combined.slice(-maxLength) : combined;
  },

  logServiceStartupFailure(serviceLabel, version, details = {}) {
    this.managers.log?.systemError(`${serviceLabel} ${version} startup failure`, details);
  },

  async readMySQLErrorLog(dataDir) {
    const errorLogPath = path.join(dataDir, 'error.log');

    try {
      if (!await fs.pathExists(errorLogPath)) {
        return '';
      }

      return await fs.readFile(errorLogPath, 'utf8');
    } catch (_error) {
      return '';
    }
  },

  async getMySQLErrorLogTail(dataDir, maxLines = 25) {
    const logContent = await this.readMySQLErrorLog(dataDir);
    if (!logContent) {
      return '';
    }

    const lines = logContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    return lines.slice(-maxLines).join('\n');
  },

  async hasRecoverableMySQLRedoCorruption(dataDir) {
    const errorLogTail = await this.getMySQLErrorLogTail(dataDir, 40);
    return /Missing redo log file .*#ib_redo\d+/i.test(errorLogTail);
  },

  async recoverCorruptMySQLRedoLogs(version, dataDir) {
    const redoDir = path.join(dataDir, '#innodb_redo');
    if (!await fs.pathExists(redoDir)) {
      return false;
    }

    const backupDir = path.join(dataDir, `#innodb_redo.corrupt-${Date.now()}`);
    await fs.move(redoDir, backupDir, { overwrite: false });

    this.managers.log?.systemWarn(`Recovered corrupt MySQL ${version} redo logs`, {
      redoDir,
      backupDir,
    });

    return true;
  },

  // Get process key for Map storage
  getProcessKey(serviceName, version) {
    if (version) {
      return `${serviceName}-${version}`;
    }
    return serviceName;
  },

  // Path helpers for versioned services
  getNginxPath(version) {
    const v = version || '1.28';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'nginx', v, platform);
  },

  getApachePath(version) {
    const v = version || '2.4';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'apache', v, platform);
  },

  getMySQLPath(version) {
    const v = version || '8.4';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'mysql', v, platform);
  },

  getMariaDBPath(version) {
    const v = version || '11.4';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'mariadb', v, platform);
  },

  getRedisPath(version) {
    const v = version || '7.4';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'redis', v, platform);
  },

  getMailpitPath() {
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'mailpit', platform);
  },

  getPostgresqlPath(version) {
    const v = version || '17';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'postgresql', v, platform);
  },

  getMongodbPath(version) {
    const v = version || '8.0';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'mongodb', v, platform);
  },

  getMemcachedPath(version) {
    const v = version || '1.6';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'memcached', v, platform);
  },

  getMinioPath() {
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    return path.join(this.resourcePath, 'minio', platform);
  },
};
