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

  // Reset database credentials by restarting with skip-grant-tables
  async resetCredentials(newUser = 'root', newPassword = '') {
    const dbType = this.getActiveDatabaseType();
    console.log(`Resetting ${dbType} credentials: user=${newUser}`);

    try {
      // Check if service manager is available
      if (!this.managers.service) {
        throw new Error('Service manager not available');
      }

      // Force stop the database service and kill any orphan processes
      console.log(`Stopping ${dbType} for credential reset...`);
      try {
        await this.managers.service.stopService(dbType);
      } catch (e) {
        console.log(`Stop service warning: ${e.message}`);
      }
      
      // Kill any remaining processes
      if (dbType === 'mysql') {
        await this.managers.service.killOrphanMySQLProcesses?.();
      } else {
        await this.managers.service.killOrphanMariaDBProcesses?.();
      }
      
      // Wait for service to fully stop
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Start with skip-grant-tables
      console.log(`Starting ${dbType} with skip-grant-tables...`);
      await this.managers.service.startServiceWithOptions(dbType, { skipGrantTables: true });
      
      // Wait a bit more for service to be fully ready
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Now run the credential reset queries (no auth needed with skip-grant-tables)
      const passwordClause = newPassword ? `'${newPassword}'` : "''";
      
      let querySuccess = false;
      try {
        // For MySQL 8.0+ we need to flush privileges first when using skip-grant-tables
        console.log('Flushing privileges...');
        await this.runDbQueryNoAuth(`FLUSH PRIVILEGES`);
        
        // Create/update users - wrap each in try/catch to continue on partial failure
        console.log('Creating/updating users...');
        try {
          await this.runDbQueryNoAuth(`CREATE USER IF NOT EXISTS '${newUser}'@'localhost' IDENTIFIED BY ${passwordClause}`);
        } catch (e) { console.log(`Create user localhost: ${e.message}`); }
        
        try {
          await this.runDbQueryNoAuth(`CREATE USER IF NOT EXISTS '${newUser}'@'127.0.0.1' IDENTIFIED BY ${passwordClause}`);
        } catch (e) { console.log(`Create user 127.0.0.1: ${e.message}`); }
        
        try {
          await this.runDbQueryNoAuth(`CREATE USER IF NOT EXISTS '${newUser}'@'%' IDENTIFIED BY ${passwordClause}`);
        } catch (e) { console.log(`Create user %: ${e.message}`); }
        
        // Alter passwords
        console.log('Setting passwords...');
        if (newPassword) {
          try {
            await this.runDbQueryNoAuth(`ALTER USER '${newUser}'@'localhost' IDENTIFIED BY '${newPassword}'`);
          } catch (e) { console.log(`Alter user localhost: ${e.message}`); }
          try {
            await this.runDbQueryNoAuth(`ALTER USER '${newUser}'@'127.0.0.1' IDENTIFIED BY '${newPassword}'`);
          } catch (e) { console.log(`Alter user 127.0.0.1: ${e.message}`); }
          try {
            await this.runDbQueryNoAuth(`ALTER USER '${newUser}'@'%' IDENTIFIED BY '${newPassword}'`);
          } catch (e) { console.log(`Alter user %: ${e.message}`); }
        } else {
          try {
            await this.runDbQueryNoAuth(`ALTER USER '${newUser}'@'localhost' IDENTIFIED BY ''`);
          } catch (e) { console.log(`Alter user localhost: ${e.message}`); }
          try {
            await this.runDbQueryNoAuth(`ALTER USER '${newUser}'@'127.0.0.1' IDENTIFIED BY ''`);
          } catch (e) { console.log(`Alter user 127.0.0.1: ${e.message}`); }
          try {
            await this.runDbQueryNoAuth(`ALTER USER '${newUser}'@'%' IDENTIFIED BY ''`);
          } catch (e) { console.log(`Alter user %: ${e.message}`); }
        }
        
        // Grant privileges
        console.log('Granting privileges...');
        try {
          await this.runDbQueryNoAuth(`GRANT ALL PRIVILEGES ON *.* TO '${newUser}'@'localhost' WITH GRANT OPTION`);
        } catch (e) { console.log(`Grant localhost: ${e.message}`); }
        try {
          await this.runDbQueryNoAuth(`GRANT ALL PRIVILEGES ON *.* TO '${newUser}'@'127.0.0.1' WITH GRANT OPTION`);
        } catch (e) { console.log(`Grant 127.0.0.1: ${e.message}`); }
        try {
          await this.runDbQueryNoAuth(`GRANT ALL PRIVILEGES ON *.* TO '${newUser}'@'%' WITH GRANT OPTION`);
        } catch (e) { console.log(`Grant %: ${e.message}`); }
        
        await this.runDbQueryNoAuth('FLUSH PRIVILEGES');
        querySuccess = true;
        console.log('Credential queries completed successfully');
      } catch (queryError) {
        console.error('Error running credential queries:', queryError);
      }

      // Stop the service again
      console.log(`Stopping ${dbType} skip-grant-tables mode...`);
      try {
        await this.managers.service.stopService(dbType);
      } catch (e) {
        console.log(`Stop service warning: ${e.message}`);
      }
      
      // Kill any remaining processes
      if (dbType === 'mysql') {
        await this.managers.service.killOrphanMySQLProcesses?.();
      } else {
        await this.managers.service.killOrphanMariaDBProcesses?.();
      }
      
      // Wait for service to fully stop
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Restart normally
      console.log(`Restarting ${dbType} normally...`);
      await this.managers.service.startService(dbType);
      
      // Wait for service to start
      await new Promise(resolve => setTimeout(resolve, 2000));

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
      // Try to restart the service normally if something went wrong
      try {
        await this.managers.service?.startService(dbType);
      } catch (e) {
        console.error('Error restarting service:', e);
      }
      throw new Error(`Failed to reset credentials: ${error.message}`);
    }
  }

  // Run a query without authentication (for skip-grant-tables mode)
  // Uses named pipe on Windows since MySQL 8.0+ skip-grant-tables disables networking
  async runDbQueryNoAuth(query, database = null) {
    const clientPath = this.getDbClientPath();
    const dbType = this.getActiveDatabaseType();
    const settings = this.configStore.get('settings', {});
    const defaults = { mysql: '8.4', mariadb: '11.4' };
    const version = settings[`${dbType}Version`] || defaults[dbType];

    return new Promise((resolve, reject) => {
      let args;
      
      if (process.platform === 'win32') {
        // On Windows, use named pipe since skip-grant-tables disables TCP
        const pipeName = dbType === 'mysql' 
          ? `MYSQL_${version.replace(/\./g, '')}_SKIP`
          : `MARIADB_${version.replace(/\./g, '')}_SKIP`;
        args = [
          `--pipe`,
          `--socket=${pipeName}`,
          '-uroot',
          '-N',
          '-B',
          '-e',
          query,
        ];
      } else {
        // On Unix, use socket file
        const { app } = require('electron');
        const dataPath = path.join(app.getPath('userData'), 'data');
        const socketPath = dbType === 'mysql'
          ? path.join(dataPath, 'mysql', version, 'data', 'mysql_skip.sock')
          : path.join(dataPath, 'mariadb', version, 'data', 'mariadb_skip.sock');
        args = [
          `--socket=${socketPath}`,
          '-uroot',
          '-N',
          '-B',
          '-e',
          query,
        ];
      }

      if (database) {
        args.push(database);
      }

      console.log(`Running query with args:`, args.join(' '));

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
        if (code !== 0) {
          console.warn(`Query warning: ${stderr}`);
          // Don't reject for warnings, only for errors
          if (stderr.includes('ERROR')) {
            reject(new Error(`Query failed: ${stderr}`));
          } else {
            resolve([]);
          }
        } else {
          const rows = stdout.trim().split('\n').filter(Boolean).map(row => {
            const cols = row.split('\t');
            return cols.length === 1 ? { value: cols[0] } : cols;
          });
          resolve(rows);
        }
      });

      proc.on('error', reject);
    });
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

  /**
   * Import a database from SQL file
   * @param {string} databaseName - Name of the database to import into
   * @param {string} filePath - Path to the SQL file (.sql or .sql.gz)
   * @param {Function} progressCallback - Callback for progress updates
   * @param {string} mode - Import mode: 'clean' (drop all tables first) or 'merge' (keep existing)
   */
  async importDatabase(databaseName, filePath, progressCallback = null, mode = 'merge') {
    const safeName = this.sanitizeName(databaseName);

    if (!(await fs.pathExists(filePath))) {
      throw new Error('Import file not found');
    }

    console.log(`Importing database: original="${databaseName}", sanitized="${safeName}", mode=${mode}`);
    
    // Verify database exists before importing
    const databases = await this.listDatabases();
    const dbExists = databases.some(db => db.name === safeName || db.name === databaseName);
    if (!dbExists) {
      throw new Error(`Database '${databaseName}' does not exist. Please create it first.`);
    }
    
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
        // If clean mode, drop all existing tables first
        if (mode === 'clean') {
          progressCallback?.({ status: 'cleaning', message: 'Dropping existing tables...' });
          await this.dropAllTables(databaseName);
        }

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
        
        // Use original database name - MySQL accepts most names when properly used
        args.push(databaseName);

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
            console.log(`Database ${databaseName} imported successfully`);
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

  /**
   * Drop all tables in a database (for clean import)
   */
  async dropAllTables(databaseName) {
    try {
      // Get list of all tables
      const tables = await this.getTables(databaseName);
      
      if (tables.length === 0) {
        console.log(`No tables to drop in ${databaseName}`);
        return;
      }
      
      console.log(`Dropping ${tables.length} tables in ${databaseName}...`);
      
      // Disable foreign key checks to avoid constraint issues
      await this.runDbQuery('SET FOREIGN_KEY_CHECKS = 0', databaseName);
      
      // Drop each table
      for (const table of tables) {
        try {
          await this.runDbQuery(`DROP TABLE IF EXISTS \`${table}\``, databaseName);
          console.log(`Dropped table: ${table}`);
        } catch (error) {
          console.warn(`Warning: Could not drop table ${table}: ${error.message}`);
        }
      }
      
      // Re-enable foreign key checks
      await this.runDbQuery('SET FOREIGN_KEY_CHECKS = 1', databaseName);
      
      console.log(`All tables dropped from ${databaseName}`);
    } catch (error) {
      console.error(`Error dropping tables in ${databaseName}:`, error);
      throw error;
    }
  }

  async getTables(databaseName) {
    const result = await this.runDbQuery('SHOW TABLES', databaseName);
    return result.map((row) => row[0]);
  }

  async getTableStructure(databaseName, tableName) {
    const result = await this.runDbQuery(`DESCRIBE \`${tableName}\``, databaseName);
    return result;
  }

  async getDatabaseSize(databaseName) {
    // Use escaped name in the query string for safety
    const escapedName = databaseName.replace(/'/g, "''");
    const query = `
      SELECT 
        SUM(data_length + index_length) as size
      FROM information_schema.tables 
      WHERE table_schema = '${escapedName}'
    `;
    const result = await this.runDbQuery(query);
    return parseInt(result[0]?.[0] || 0, 10);
  }

  // Helper methods
  sanitizeName(name) {
    // Trim whitespace and sanitize
    const trimmed = String(name || '').trim();
    const sanitized = trimmed.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 64);
    // Remove trailing underscores that might result from sanitization
    return sanitized.replace(/_+$/, '') || 'unnamed';
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
