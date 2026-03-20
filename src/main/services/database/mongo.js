const fs = require('fs-extra');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  async _ensureMongoClientPath() {
    const clientPath = this.getDbClientPath();
    if (fs.existsSync(clientPath)) {
      return clientPath;
    }

    const activeType = this.getActiveDatabaseType?.();
    const activeVersion = activeType === 'mongodb' ? this.getActiveDatabaseVersion?.() : null;
    const binaryDownload = this.managers?.binaryDownload;

    if (activeVersion && typeof binaryDownload?.downloadMongosh === 'function') {
      const repairResult = await binaryDownload.downloadMongosh(activeVersion);
      const repairedPath = this.getDbClientPath();

      if (repairResult?.success && fs.existsSync(repairedPath)) {
        return repairedPath;
      }

      this.managers?.log?.systemWarn?.('MongoDB shell repair did not produce a client binary', {
        version: activeVersion,
        path: repairedPath,
        error: repairResult?.error,
      });
    }

    return clientPath;
  },

  async _runMongoQuery(evalExpr, database = 'admin') {
    const isPlaywright = process.env.PLAYWRIGHT_TEST === 'true';
    if (isPlaywright) {
      if (!this._mongoMockedDbs) this._mongoMockedDbs = new Set(['admin']);
      if (evalExpr.includes('listDatabases') || evalExpr.includes('forEach(d=>print')) {
        return Promise.resolve(Array.from(this._mongoMockedDbs));
      }
      if (evalExpr.includes('createCollection') || evalExpr.includes('updateOne')) {
        const match = evalExpr.match(/getSiblingDB\("([^"]+)"\)/);
        if (match) this._mongoMockedDbs.add(match[1]);
        return Promise.resolve([]);
      }
      if (evalExpr.includes('dropDatabase')) {
        if (database !== 'admin') {
          this._mongoMockedDbs.delete(database);
        } else {
          const match = evalExpr.match(/getSiblingDB\("([^"]+)"\)/);
          if (match) this._mongoMockedDbs.delete(match[1]);
        }
        return Promise.resolve([]);
      }
      if (evalExpr.includes('getCollectionNames')) {
        return Promise.resolve([]);
      }
      if (evalExpr.includes('stats')) {
        return Promise.resolve(['0']);
      }
      return Promise.resolve([]);
    }

    const clientPath = await this._ensureMongoClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const mongoUser = settings.mongoUser ?? null;
    const mongoPassword = settings.mongoPassword ?? null;

    if (!fs.existsSync(clientPath)) {
      return Promise.reject(new Error(`MongoDB shell not found at ${clientPath}. Please install or reinstall the MongoDB binary from the Binaries page.`));
    }

    const args = [
      '--host', this.dbConfig.host,
      '--port', String(port),
      '--quiet',
      '--eval', evalExpr,
    ];

    if (mongoUser) {
      args.push('--username', mongoUser, '--authenticationDatabase', 'admin');
    }
    if (mongoPassword) {
      args.push('--password', String(mongoPassword));
    }

    args.push(database);

    return new Promise((resolve, reject) => {
      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      const timeout = setTimeout(() => {
        try { proc.kill(); } catch (_) {}
        reject(new Error('MongoDB query timed out after 30 s. Is mongoh running?'));
      }, 30000);

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to launch mongosh: ${error.message}`));
      });

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (code === 0) {
          const lines = stdout
            .replace(/\r\n/g, '\n').replace(/\r/g, '')
            .trim().split('\n')
            .filter((line) => line.length > 0);
          resolve(lines);
          return;
        }

        if (stderr.includes('Authentication failed') || stderr.includes('Unauthorized')) {
          reject(new Error(`MongoDB access denied for user '${mongoUser || 'unknown'}'. Check credentials in Settings > Network.`));
        } else {
          reject(new Error(`MongoDB query failed: ${stderr || `exit code ${code}`}`));
        }
      });
      proc.on('error', reject);
    });
  },

  async _importMongo(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    const pathValidation = this.validateFilePath(filePath, true);
    if (!pathValidation.valid) {
      throw new Error(pathValidation.error);
    }
    if (!await fs.pathExists(filePath)) {
      throw new Error('Import file not found');
    }

    this.managers.log?.systemInfo('MongoDB import started', { database: safeName, operationId, mode });
    progressCallback?.({ operationId, status: 'starting', message: 'Starting MongoDB import...', dbName: safeName });

    const restorePath = this.getDbRestorePath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser !== undefined ? settings.dbUser : this.dbConfig.user;
    const password = settings.dbPassword !== undefined ? settings.dbPassword : this.dbConfig.password;

    if (!await fs.pathExists(restorePath)) {
      throw new Error(`mongorestore not found at ${restorePath}. Please ensure the MongoDB binary is installed.`);
    }

    return new Promise((resolve, reject) => {
      const isGzipped = filePath.toLowerCase().endsWith('.gz');
      const args = [
        '--host', this.dbConfig.host,
        '--port', String(port),
        '--db', safeName,
        '--archive=' + filePath,
      ];

      if (isGzipped) {
        args.push('--gzip');
      }
      if (mode === 'clean') {
        args.push('--drop');
      }

      if (user) {
        args.push('--username', user, '--authenticationDatabase', 'admin');
      }
      if (password) {
        args.push('--password', String(password));
      }

      progressCallback?.({ operationId, status: 'importing', message: 'Restoring MongoDB archive...', progress: 0, dbName: safeName });

      const proc = spawn(restorePath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.runningOperations.set(operationId, { proc, type: 'import', dbName: safeName });

      let stderr = '';
      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('password') && !msg.toLowerCase().includes('restoring ')) {
          stderr += msg;
        }
      });

      proc.on('close', (code) => {
        this.runningOperations.delete(operationId);
        if (code === 0) {
          progressCallback?.({ operationId, status: 'complete', message: 'Import completed successfully!', dbName: safeName });
          resolve({ success: true, operationId });
        } else if (code === null) {
          progressCallback?.({ operationId, status: 'cancelled', message: 'Import cancelled', dbName: safeName });
          resolve({ success: false, cancelled: true, operationId });
        } else {
          const errorMsg = stderr || `Process exited with code ${code}`;
          progressCallback?.({ operationId, status: 'error', message: `Import failed: ${errorMsg}`, dbName: safeName });
          reject(new Error(`mongorestore failed: ${errorMsg}`));
        }
      });

      proc.on('error', (error) => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
        reject(error);
      });
    });
  },

  async _exportMongo(databaseName, outputPath, progressCallback = null) {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    progressCallback?.({ operationId, status: 'starting', message: 'Starting MongoDB export...', dbName: safeName });

    const dumpPath = this.getDbDumpPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    if (!await fs.pathExists(dumpPath)) {
      throw new Error(`mongodump not found at ${dumpPath}. Please ensure the MongoDB binary is installed.`);
    }

    const finalPath = outputPath.toLowerCase().endsWith('.gz') ? outputPath : `${outputPath}.gz`;

    return new Promise((resolve, reject) => {
      const args = [
        '--host', this.dbConfig.host,
        '--port', String(port),
        '--db', safeName,
        '--archive=' + finalPath,
        '--gzip',
      ];

      if (user) {
        args.push('--username', user, '--authenticationDatabase', 'admin');
      }
      if (password) {
        args.push('--password', password);
      }

      progressCallback?.({ operationId, status: 'dumping', message: 'Creating MongoDB dump...', dbName: safeName });

      const proc = spawn(dumpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      this.runningOperations.set(operationId, { proc, type: 'export', dbName: safeName });

      let stderr = '';

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('password') && !msg.includes('warning:') && !msg.toLowerCase().includes('writing ')) {
          stderr += msg;
        }
      });

      proc.on('close', (code) => {
        this.runningOperations.delete(operationId);
        if (code === 0) {
          progressCallback?.({ operationId, status: 'complete', message: 'Export completed successfully!', path: finalPath, dbName: safeName });
          resolve({ success: true, path: finalPath, operationId });
        } else if (code === null) {
          progressCallback?.({ operationId, status: 'cancelled', message: 'Export cancelled', dbName: safeName });
          resolve({ success: false, cancelled: true, operationId });
        } else {
          progressCallback?.({ operationId, status: 'error', message: `Export failed: ${stderr}`, dbName: safeName });
          reject(new Error(`mongodump failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Export error: ${error.message}`, dbName: safeName });
        reject(error);
      });
    });
  },
};