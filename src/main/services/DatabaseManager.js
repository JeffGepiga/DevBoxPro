const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const net = require('net');
const { app } = require('electron');

class DatabaseManager {
  constructor(resourcePath, configStore) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.dbConfig = {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
    };
  }

  async initialize() {
    console.log('Initializing DatabaseManager...');

    const dataPath = path.join(app.getPath('userData'), 'data');
    await fs.ensureDir(path.join(dataPath, 'mysql', 'data'));
    await fs.ensureDir(path.join(dataPath, 'mysql', 'backups'));
    await fs.ensureDir(path.join(dataPath, 'mariadb', 'data'));
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
      port: settings.mysqlPort || 3306,
      user: settings.dbUser || 'root',
      password: settings.dbPassword || '',
    };
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

  async importDatabase(databaseName, filePath) {
    const safeName = this.sanitizeName(databaseName);

    if (!(await fs.pathExists(filePath))) {
      throw new Error('Import file not found');
    }

    console.log(`Importing database ${safeName} from ${filePath}`);

    const clientPath = this.getDbClientPath();

    return new Promise((resolve, reject) => {
      const proc = spawn(
        clientPath,
        [
          `-h${this.dbConfig.host}`,
          `-P${this.dbConfig.port}`,
          `-u${this.dbConfig.user}`,
          safeName,
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        }
      );

      const fileStream = fs.createReadStream(filePath);
      fileStream.pipe(proc.stdin);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`Database ${safeName} imported successfully`);
          resolve({ success: true });
        } else {
          reject(new Error(`Import failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
        reject(error);
      });
    });
  }

  async exportDatabase(databaseName, outputPath) {
    const safeName = this.sanitizeName(databaseName);

    console.log(`Exporting database ${safeName} to ${outputPath}`);

    const dumpPath = this.getDbDumpPath();

    return new Promise((resolve, reject) => {
      const proc = spawn(
        dumpPath,
        [
          `-h${this.dbConfig.host}`,
          `-P${this.dbConfig.port}`,
          `-u${this.dbConfig.user}`,
          '--single-transaction',
          '--routines',
          '--triggers',
          safeName,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        }
      );

      const outputStream = fs.createWriteStream(outputPath);
      proc.stdout.pipe(outputStream);

      let stderr = '';
      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          console.log(`Database ${safeName} exported to ${outputPath}`);
          resolve({ success: true, path: outputPath });
        } else {
          reject(new Error(`Export failed: ${stderr}`));
        }
      });

      proc.on('error', (error) => {
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

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.dbConfig.host}`,
        `-P${this.dbConfig.port}`,
        `-u${this.dbConfig.user}`,
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

  // Get the client path based on active database type
  getDbClientPath() {
    const dbType = this.getActiveDatabaseType();
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';
    return path.join(this.resourcePath, dbType, platform, 'bin', binName);
  }

  // Get the dump path based on active database type
  getDbDumpPath() {
    const dbType = this.getActiveDatabaseType();
    const platform = process.platform === 'win32' ? 'win' : 'mac';
    const binName = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump';
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
