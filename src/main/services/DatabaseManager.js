const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const net = require('net');
const { app } = require('electron');
const zlib = require('zlib');
const { pipeline } = require('stream/promises');

class DatabaseManager {
  constructor(resourcePath, configStore, managers = {}) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
    this.dbConfig = {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
    };
  }

  async initialize() {
    console.log('Initializing DatabaseManager...');

    // Note: Actual per-version data directories (e.g., data/mysql/8.4/data) 
    // are created by ServiceManager when starting each version.
    // We just ensure the base backup directories exist here.
    const dataPath = path.join(app.getPath('userData'), 'data');
    await fs.ensureDir(path.join(dataPath, 'mysql', 'backups'));
    await fs.ensureDir(path.join(dataPath, 'mariadb', 'backups'));

    console.log('DatabaseManager initialized');
  }

  // Get the currently active database type (mysql or mariadb)
  getActiveDatabaseType() {
    return this.configStore.getSetting('activeDatabaseType', 'mysql');
  }

  // Set the active database type
  async setActiveDatabaseType(dbType) {
    if (!['mysql', 'mariadb'].includes(dbType)) {
      throw new Error('Invalid database type. Must be "mysql" or "mariadb"');
    }
    this.configStore.setSetting('activeDatabaseType', dbType);
    console.log(`Active database type set to: ${dbType}`);
    return { success: true, type: dbType };
  }

  // Get database info including type and credentials
  getDatabaseInfo() {
    const dbType = this.getActiveDatabaseType();
    const settings = this.configStore.get('settings', {});
    return {
      type: dbType,
      host: this.dbConfig.host,
      port: this.getActualPort(),
      user: settings.dbUser || 'root',
      password: settings.dbPassword || '',
    };
  }

  // Get the actual running port for the active database type
  getActualPort() {
    const dbType = this.getActiveDatabaseType();
    const settings = this.configStore.get('settings', {});
    
    // Try to get the actual port from ServiceManager
    if (this.managers.service) {
      const serviceConfig = this.managers.service.serviceConfigs[dbType];
      if (serviceConfig?.actualPort) {
        console.log(`${dbType} using actual port: ${serviceConfig.actualPort}`);
        return serviceConfig.actualPort;
      }
      
      // Check service status - if not running, we can't connect anyway
      const serviceStatus = this.managers.service.serviceStatus.get(dbType);
      if (serviceStatus?.status !== 'running') {
        console.log(`${dbType} service is not running`);
        // Return a port that will likely fail - better than connecting to wrong service
        return dbType === 'mariadb' ? 3307 : 3306;
      }
      
      // Service is running but no actualPort stored - use status port
      if (serviceStatus?.port) {
        console.log(`${dbType} using status port: ${serviceStatus.port}`);
        return serviceStatus.port;
      }
    }
    
    // Fallback to default port for the specific database type
    // MariaDB defaults to 3306 but if MySQL is also on 3306, MariaDB would be on 3307
    const defaultPort = dbType === 'mariadb' ? 3306 : (settings.mysqlPort || 3306);
    console.log(`${dbType} using fallback port: ${defaultPort}`);
    return defaultPort;
  }

  // Check if a specific database service is running
  isServiceRunning(dbType = null) {
    const type = dbType || this.getActiveDatabaseType();
    if (this.managers.service) {
      const serviceStatus = this.managers.service.serviceStatus.get(type);
      return serviceStatus?.status === 'running';
    }
    return false;
  }

  // Reset database credentials
  async resetCredentials(newUser = 'root', newPassword = '') {
    const dbType = this.getActiveDatabaseType();
    console.log(`Resetting ${dbType} credentials: user=${newUser}`);

    try {
      // Update the root password using ALTER USER
      if (newPassword) {
        await this.runDbQuery(`ALTER USER '${newUser}'@'localhost' IDENTIFIED BY '${newPassword}'`);
        await this.runDbQuery(`ALTER USER '${newUser}'@'127.0.0.1' IDENTIFIED BY '${newPassword}'`);
      } else {
        // Set empty password
        await this.runDbQuery(`ALTER USER '${newUser}'@'localhost' IDENTIFIED BY ''`);
        await this.runDbQuery(`ALTER USER '${newUser}'@'127.0.0.1' IDENTIFIED BY ''`);
      }
      await this.runDbQuery('FLUSH PRIVILEGES');

      // Save the new credentials in settings
      this.configStore.setSetting('dbUser', newUser);
      this.configStore.setSetting('dbPassword', newPassword);

      // Update local config
      this.dbConfig.user = newUser;
      this.dbConfig.password = newPassword;

      console.log('Database credentials reset successfully');
      return { success: true };
    } catch (error) {
      console.error('Error resetting credentials:', error);
      throw new Error(`Failed to reset credentials: ${error.message}`);
    }
  }

  getConnections() {
    const dbType = this.getActiveDatabaseType();
    return {
      [dbType]: {
        type: dbType,
        host: this.dbConfig.host,
        port: this.dbConfig.port,
        user: this.dbConfig.user,
        status: 'connected', // Would need actual check
      },
    };
  }

  async listDatabases() {
    const dbType = this.getActiveDatabaseType();
    
    // Check if service is running first - just return empty array if not
    if (!this.isServiceRunning()) {
      console.log(`${dbType} service is not running, returning empty database list`);
      return [];
    }
    
    const result = await this.runDbQuery('SHOW DATABASES');
    return result.map((row) => ({
      name: row.Database,
      isSystem: ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(row.Database),
    }));
  }

  async createDatabase(name) {
    const safeName = this.sanitizeName(name);
    await this.runDbQuery(`CREATE DATABASE IF NOT EXISTS \`${safeName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`Database created: ${safeName}`);
    return { success: true, name: safeName };
  }

  async deleteDatabase(name) {
    const safeName = this.sanitizeName(name);

    // Prevent deleting system databases
    if (['information_schema', 'mysql', 'performance_schema', 'sys'].includes(safeName)) {
      throw new Error('Cannot delete system database');
    }

    await this.runDbQuery(`DROP DATABASE IF EXISTS \`${safeName}\``);
    console.log(`Database deleted: ${safeName}`);
    return { success: true, name: safeName };
  }

  async importDatabase(databaseName, filePath, progressCallback = null) {
    const safeName = this.sanitizeName(databaseName);

    if (!(await fs.pathExists(filePath))) {
      throw new Error('Import file not found');
    }

    console.log(`Importing database ${safeName} from ${filePath}`);
    progressCallback?.({ status: 'starting', message: 'Starting import...' });

    const isGzipped = filePath.toLowerCase().endsWith('.gz');
    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    // Check if client exists
    if (!await fs.pathExists(clientPath)) {
      throw new Error(`MySQL client not found at ${clientPath}. Please ensure the database binary is installed.`);
    }

    return new Promise(async (resolve, reject) => {
      try {
        let sqlContent;
        
        // Read and decompress if needed
        if (isGzipped) {
          progressCallback?.({ status: 'decompressing', message: 'Decompressing backup file...' });
          const gzContent = await fs.readFile(filePath);
          sqlContent = await new Promise((res, rej) => {
            zlib.gunzip(gzContent, (err, result) => {
              if (err) rej(err);
              else res(result.toString('utf8'));
            });
          });
        } else {
          sqlContent = await fs.readFile(filePath, 'utf8');
        }

        // Process SQL to remove virtual column definitions that may cause issues
        progressCallback?.({ status: 'processing', message: 'Processing SQL content...' });
        const processedSql = this.processImportSql(sqlContent);

        // Create temporary processed SQL file
        const tempDir = app.getPath('temp');
        const tempFile = path.join(tempDir, `import_${Date.now()}.sql`);
        await fs.writeFile(tempFile, processedSql);

        progressCallback?.({ status: 'importing', message: 'Importing to database...' });

        const args = [
          `-h${this.dbConfig.host}`,
          `-P${port}`,
          `-u${user}`,
        ];
        
        if (password) {
          args.push(`-p${password}`);
        }
        
        args.push(safeName);

        const proc = spawn(clientPath, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        });

        const fileStream = fs.createReadStream(tempFile);
        fileStream.pipe(proc.stdin);

        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', async (code) => {
          // Clean up temp file
          await fs.remove(tempFile).catch(() => {});
          
          if (code === 0) {
            console.log(`Database ${safeName} imported successfully`);
            progressCallback?.({ status: 'complete', message: 'Import completed successfully!' });
            resolve({ success: true });
          } else {
            const errorMsg = stderr || `Process exited with code ${code}`;
            progressCallback?.({ status: 'error', message: `Import failed: ${errorMsg}` });
            reject(new Error(`Import failed: ${errorMsg}`));
          }
        });

        proc.on('error', async (error) => {
          await fs.remove(tempFile).catch(() => {});
          progressCallback?.({ status: 'error', message: `Import error: ${error.message}` });
          reject(error);
        });
      } catch (error) {
        progressCallback?.({ status: 'error', message: `Import error: ${error.message}` });
        reject(error);
      }
    });
  }

  /**
   * Process SQL content to remove virtual column definitions that may cause import issues
   */
  processImportSql(sql) {
    // Remove GENERATED/VIRTUAL column definitions from CREATE TABLE statements
    // These need to be added back separately via ALTER TABLE after data import
    const virtualColumnPattern = /`\w+`\s+\w+(?:\([^)]*\))?\s+(?:GENERATED ALWAYS )?AS\s*\([^)]+\)\s*(?:VIRTUAL|STORED)?(?:\s+(?:NOT NULL|NULL))?(?:\s+COMMENT\s+'[^']*')?,?\s*\n?/gi;
    
    let processedSql = sql;
    
    // Remove virtual columns from CREATE TABLE statements
    processedSql = processedSql.replace(virtualColumnPattern, '');
    
    // Clean up any trailing commas before closing parenthesis in CREATE TABLE
    processedSql = processedSql.replace(/,(\s*\n?\s*\))/g, '$1');
    
    // Remove any double newlines
    processedSql = processedSql.replace(/\n\n+/g, '\n');
    
    return processedSql;
  }

  async exportDatabase(databaseName, outputPath, progressCallback = null) {
    const safeName = this.sanitizeName(databaseName);

    console.log(`Exporting database ${safeName} to ${outputPath}`);
    progressCallback?.({ status: 'starting', message: 'Starting export...' });

    const dumpPath = this.getDbDumpPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;
    const password = settings.dbPassword || '';

    // Check if mysqldump exists
    if (!await fs.pathExists(dumpPath)) {
      throw new Error(`mysqldump not found at ${dumpPath}. Please ensure the database binary is installed.`);
    }

    // Ensure output has .gz extension
    const finalPath = outputPath.toLowerCase().endsWith('.gz') ? outputPath : `${outputPath}.gz`;

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.dbConfig.host}`,
        `-P${port}`,
        `-u${user}`,
        '--single-transaction',
        '--routines',
        '--triggers',
        '--quick',
        '--lock-tables=false',
      ];
      
      if (password) {
        args.push(`-p${password}`);
      }
      
      args.push(safeName);

      progressCallback?.({ status: 'dumping', message: 'Creating database dump...' });

      const proc = spawn(dumpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });

      // Create gzip stream and pipe to file
      const gzip = zlib.createGzip({ level: 6 });
      const outputStream = fs.createWriteStream(finalPath);

      proc.stdout.pipe(gzip).pipe(outputStream);

      let stderr = '';
      let dataReceived = false;
      
      proc.stdout.on('data', () => {
        if (!dataReceived) {
          dataReceived = true;
          progressCallback?.({ status: 'compressing', message: 'Compressing and writing backup...' });
        }
      });

      proc.stderr.on('data', (data) => {
        const msg = data.toString();
        // Filter out common warnings that aren't errors
        if (!msg.includes('Using a password on the command line') && 
            !msg.includes('Warning:')) {
          stderr += msg;
        }
      });

      outputStream.on('finish', () => {
        console.log(`Database ${safeName} exported to ${finalPath}`);
        progressCallback?.({ status: 'complete', message: 'Export completed successfully!', path: finalPath });
        resolve({ success: true, path: finalPath });
      });

      proc.on('close', (code) => {
        if (code !== 0 && stderr) {
          progressCallback?.({ status: 'error', message: `Export failed: ${stderr}` });
          reject(new Error(`Export failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        progressCallback?.({ status: 'error', message: `Export error: ${error.message}` });
        reject(error);
      });
    });
  }

  async runQuery(databaseName, query) {
    const safeName = this.sanitizeName(databaseName);
    return this.runDbQuery(query, safeName);
  }

  async runDbQuery(query, database = null) {
    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser || this.dbConfig.user;

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.dbConfig.host}`,
        `-P${port}`,
        `-u${user}`,
        '-N', // Skip column names
        '-B', // Batch mode
        '-e',
        query,
      ];

      if (database) {
        args.push(database);
      }

      const proc = spawn(clientPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          // Parse results
          const rows = stdout
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => {
              const columns = line.split('\t');
              // For SHOW DATABASES, first column is Database
              if (query.toLowerCase().includes('show databases')) {
                return { Database: columns[0] };
              }
              return columns;
            });

          resolve(rows);
        } else {
          reject(new Error(`Query failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  getPhpMyAdminUrl() {
    const settings = this.configStore.get('settings', {});
    const port = settings.phpMyAdminPort || 8080;
    return `http://127.0.0.1:${port}`;
  }

  async getTables(databaseName) {
    const safeName = this.sanitizeName(databaseName);
    const result = await this.runDbQuery('SHOW TABLES', safeName);
    return result.map((row) => row[0]);
  }

  async getTableStructure(databaseName, tableName) {
    const safeName = this.sanitizeName(databaseName);
    const safeTable = this.sanitizeName(tableName);
    const result = await this.runDbQuery(`DESCRIBE \`${safeTable}\``, safeName);
    return result;
  }

  async getDatabaseSize(databaseName) {
    const safeName = this.sanitizeName(databaseName);
    const query = `
      SELECT 
        SUM(data_length + index_length) as size
      FROM information_schema.tables 
      WHERE table_schema = '${safeName}'
    `;
    const result = await this.runDbQuery(query);
    return parseInt(result[0]?.[0] || 0, 10);
  }

  // Helper methods
  sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 64);
  }

  // Get the client path based on active database type and running version
  getDbClientPath() {
    const dbType = this.getActiveDatabaseType();
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';
    
    // Get the running version from ServiceManager
    let version = null;
    if (this.managers.service) {
      const serviceStatus = this.managers.service.serviceStatus.get(dbType);
      if (serviceStatus?.status === 'running') {
        version = serviceStatus.version;
      }
    }
    
    // Use version in path if available
    if (version) {
      return path.join(this.resourcePath, dbType, version, platform, 'bin', binName);
    }
    
    // Fallback to old path structure
    return path.join(this.resourcePath, dbType, platform, 'bin', binName);
  }

  // Get the dump path based on active database type and running version
  getDbDumpPath() {
    const dbType = this.getActiveDatabaseType();
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const binName = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump';
    
    // Get the running version from ServiceManager
    let version = null;
    if (this.managers.service) {
      const serviceStatus = this.managers.service.serviceStatus.get(dbType);
      if (serviceStatus?.status === 'running') {
        version = serviceStatus.version;
      }
    }
    
    // Use version in path if available
    if (version) {
      return path.join(this.resourcePath, dbType, version, platform, 'bin', binName);
    }
    
    // Fallback to old path structure
    return path.join(this.resourcePath, dbType, platform, 'bin', binName);
  }

  // Legacy method names for backwards compatibility
  getMysqlPath() {
    return this.getDbClientPath();
  }

  getMysqldumpPath() {
    return this.getDbDumpPath();
  }

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
  }
}

module.exports = { DatabaseManager };
