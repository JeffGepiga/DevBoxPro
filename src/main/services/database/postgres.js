const fs = require('fs-extra');
const { spawn } = require('child_process');
const zlib = require('zlib');
const { v4: uuidv4 } = require('uuid');

module.exports = {
  _buildPgEnv() {
    const settings = this.configStore.get('settings', {});
    const password = settings.pgPassword !== undefined ? settings.pgPassword
      : (settings.dbPassword !== undefined ? settings.dbPassword : this.dbConfig.password);
    return password ? { ...process.env, PGPASSWORD: String(password) } : { ...process.env };
  },

  _runPostgresQuery(sql, database = 'postgres') {
    const isPlaywright = process.env.PLAYWRIGHT_TEST === 'true';
    if (isPlaywright) {
      if (!this._pgMockedDbs) this._pgMockedDbs = new Set(['postgres']);
      const query = sql.toLowerCase();
      if (query.includes('create database')) {
        const match = sql.match(/CREATE DATABASE "([^"]+)"/i);
        if (match) this._pgMockedDbs.add(match[1]);
        return Promise.resolve([]);
      }
      if (query.includes('drop database')) {
        const match = sql.match(/DROP DATABASE(?:\s+IF\s+EXISTS)?\s+"([^"]+)"/i);
        if (match) this._pgMockedDbs.delete(match[1]);
        return Promise.resolve([]);
      }
      if (query.includes('pg_database')) {
        return Promise.resolve(Array.from(this._pgMockedDbs).map((dbName) => [dbName]));
      }
      if (query.includes('pg_tables')) {
        return Promise.resolve([]);
      }
      if (query.includes('information_schema.columns')) {
        return Promise.resolve([]);
      }
      if (query.includes('pg_database_size')) {
        return Promise.resolve([['0']]);
      }
      if (query.includes('pg_terminate_backend')) {
        return Promise.resolve([]);
      }
      return Promise.resolve([]);
    }

    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = (settings.pgUser !== undefined && settings.pgUser !== '') ? settings.pgUser : 'postgres';

    if (!fs.existsSync(clientPath)) {
      return Promise.reject(new Error(`psql not found at ${clientPath}. Please install the PostgreSQL binary from the Binaries page.`));
    }

    const args = [
      '-h', this.dbConfig.host,
      '-p', String(port),
      '-U', user,
      '-t',
      '-A',
      '-F', '\t',
      '-c', sql,
      database,
    ];

    return new Promise((resolve, reject) => {
      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: this._buildPgEnv(),
      });

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          const rows = stdout
            .replace(/\r\n/g, '\n').replace(/\r/g, '')
            .trim().split('\n')
            .filter((line) => line.length > 0)
            .map((line) => line.split('\t'));
          resolve(rows);
          return;
        }

        if (stderr.includes('authentication failed') || stderr.includes('password')) {
          reject(new Error(`PostgreSQL access denied for user '${user}'. Check credentials in Settings > Network.`));
        } else {
          reject(new Error(`PostgreSQL query failed: ${stderr || `exit code ${code}`}`));
        }
      });
      proc.on('error', reject);
    });
  },

  async _importPostgres(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    const pathValidation = this.validateFilePath(filePath, true);
    if (!pathValidation.valid) {
      throw new Error(pathValidation.error);
    }
    if (!await fs.pathExists(filePath)) {
      throw new Error('Import file not found');
    }

    this.managers.log?.systemInfo('PostgreSQL import started', { database: safeName, operationId, mode });

    const databases = await this.listDatabases();
    const dbExists = databases.some(db => db.name === safeName || db.name === databaseName);
    if (!dbExists) {
      throw new Error(`Database '${databaseName}' does not exist. Please create it first.`);
    }

    progressCallback?.({ operationId, status: 'starting', message: 'Starting PostgreSQL import...', dbName: safeName });

    const isGzipped = filePath.toLowerCase().endsWith('.gz');
    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser !== undefined ? settings.dbUser : this.dbConfig.user;

    if (!await fs.pathExists(clientPath)) {
      throw new Error(`psql not found at ${clientPath}. Please ensure the PostgreSQL binary is installed.`);
    }

    return new Promise(async (resolve, reject) => {
      try {
        if (mode === 'clean') {
          progressCallback?.({ operationId, status: 'cleaning', message: 'Recreating database (clean import)...', dbName: safeName });
          await this.dropAllTables(safeName);
        }

        const fileStats = await fs.stat(filePath);
        const totalSize = fileStats.size;
        let processedBytes = 0;

        progressCallback?.({ operationId, status: 'importing', message: 'Importing to database (streaming)...', progress: 0, dbName: safeName });

        const args = [
          '-h', this.dbConfig.host,
          '-p', String(port),
          '-U', user,
          '-q',
          safeName,
        ];

        const proc = spawn(clientPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
          env: this._buildPgEnv(),
        });

        this.runningOperations.set(operationId, { proc, type: 'import', dbName: safeName });

        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        const readStream = fs.createReadStream(filePath, { highWaterMark: 64 * 1024 });
        readStream.on('data', (chunk) => {
          processedBytes += chunk.length;
          const progress = Math.round((processedBytes / totalSize) * 100);
          if (progress % 5 === 0) {
            const sizeMB = (processedBytes / (1024 * 1024)).toFixed(1);
            const totalMB = (totalSize / (1024 * 1024)).toFixed(1);
            progressCallback?.({ operationId, status: 'importing', message: `Importing... ${sizeMB}MB / ${totalMB}MB (${progress}%)`, progress, dbName: safeName });
          }
        });

        if (isGzipped) {
          progressCallback?.({ operationId, status: 'importing', message: 'Decompressing and importing (streaming)...', progress: 0, dbName: safeName });
          const gunzip = zlib.createGunzip();
          gunzip.on('error', (err) => {
            proc.stdin.end();
            this.runningOperations.delete(operationId);
            reject(new Error(`Decompression error: ${err.message}`));
          });
          readStream.pipe(gunzip).pipe(proc.stdin);
        } else {
          readStream.pipe(proc.stdin);
        }

        readStream.on('error', (err) => {
          proc.stdin.end();
          this.runningOperations.delete(operationId);
          reject(new Error(`Read error: ${err.message}`));
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
            reject(new Error(`PostgreSQL import failed: ${errorMsg}`));
          }
        });

        proc.on('error', (error) => {
          this.runningOperations.delete(operationId);
          progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
          reject(error);
        });
      } catch (error) {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'error', message: `Import error: ${error.message}`, dbName: safeName });
        reject(error);
      }
    });
  },

  async _exportPostgres(databaseName, outputPath, progressCallback = null) {
    const safeName = this.sanitizeName(databaseName);
    const operationId = uuidv4();

    progressCallback?.({ operationId, status: 'starting', message: 'Starting PostgreSQL export...', dbName: safeName });

    const dumpPath = this.getDbDumpPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;

    if (!await fs.pathExists(dumpPath)) {
      throw new Error(`pg_dump not found at ${dumpPath}. Please ensure the PostgreSQL binary is installed.`);
    }

    const finalPath = outputPath.toLowerCase().endsWith('.gz') ? outputPath : `${outputPath}.gz`;

    return new Promise((resolve, reject) => {
      const args = [
        '-h', this.dbConfig.host,
        '-p', String(port),
        '-U', user,
        '--no-owner',
        '--no-acl',
        safeName,
      ];

      progressCallback?.({ operationId, status: 'dumping', message: 'Creating PostgreSQL dump...', dbName: safeName });

      const proc = spawn(dumpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        env: this._buildPgEnv(),
      });

      this.runningOperations.set(operationId, { proc, type: 'export', dbName: safeName });

      const gzip = zlib.createGzip({ level: 6 });
      const outputStream = fs.createWriteStream(finalPath);
      proc.stdout.pipe(gzip).pipe(outputStream);

      let stderr = '';
      let dataReceived = false;

      proc.stdout.on('data', () => {
        if (!dataReceived) {
          dataReceived = true;
          progressCallback?.({ operationId, status: 'compressing', message: 'Compressing and writing backup...', dbName: safeName });
        }
      });

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        if (!msg.includes('password') && !msg.includes('Warning:')) {
          stderr += msg;
        }
      });

      outputStream.on('finish', () => {
        this.runningOperations.delete(operationId);
        progressCallback?.({ operationId, status: 'complete', message: 'Export completed successfully!', path: finalPath, dbName: safeName });
        resolve({ success: true, path: finalPath, operationId });
      });

      proc.on('close', (code) => {
        this.runningOperations.delete(operationId);
        if (code === null) {
          progressCallback?.({ operationId, status: 'cancelled', message: 'Export cancelled', dbName: safeName });
          resolve({ success: false, cancelled: true, operationId });
        } else if (code !== 0 && stderr) {
          progressCallback?.({ operationId, status: 'error', message: `Export failed: ${stderr}`, dbName: safeName });
          reject(new Error(`pg_dump failed: ${stderr}`));
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