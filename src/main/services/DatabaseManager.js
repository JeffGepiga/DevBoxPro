const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const net = require('net');

class DatabaseManager {
  constructor(resourcePath, configStore) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.mysqlConfig = {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
    };
  }

  async initialize() {
    console.log('Initializing DatabaseManager...');

    const dataPath = this.configStore.get('dataPath');
    await fs.ensureDir(path.join(dataPath, 'mysql', 'data'));
    await fs.ensureDir(path.join(dataPath, 'mysql', 'backups'));

    console.log('DatabaseManager initialized');
  }

  getConnections() {
    return {
      mysql: {
        host: this.mysqlConfig.host,
        port: this.mysqlConfig.port,
        user: this.mysqlConfig.user,
        status: 'connected', // Would need actual check
      },
    };
  }

  async listDatabases() {
    const result = await this.runMySqlQuery('SHOW DATABASES');
    return result.map((row) => ({
      name: row.Database,
      isSystem: ['information_schema', 'mysql', 'performance_schema', 'sys'].includes(row.Database),
    }));
  }

  async createDatabase(name) {
    const safeName = this.sanitizeName(name);
    await this.runMySqlQuery(`CREATE DATABASE IF NOT EXISTS \`${safeName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    console.log(`Database created: ${safeName}`);
    return { success: true, name: safeName };
  }

  async deleteDatabase(name) {
    const safeName = this.sanitizeName(name);

    // Prevent deleting system databases
    if (['information_schema', 'mysql', 'performance_schema', 'sys'].includes(safeName)) {
      throw new Error('Cannot delete system database');
    }

    await this.runMySqlQuery(`DROP DATABASE IF EXISTS \`${safeName}\``);
    console.log(`Database deleted: ${safeName}`);
    return { success: true, name: safeName };
  }

  async importDatabase(databaseName, filePath) {
    const safeName = this.sanitizeName(databaseName);

    if (!(await fs.pathExists(filePath))) {
      throw new Error('Import file not found');
    }

    console.log(`Importing database ${safeName} from ${filePath}`);

    const mysqlPath = this.getMysqlPath();

    return new Promise((resolve, reject) => {
      const proc = spawn(
        mysqlPath,
        [
          `-h${this.mysqlConfig.host}`,
          `-P${this.mysqlConfig.port}`,
          `-u${this.mysqlConfig.user}`,
          safeName,
        ],
        {
          stdio: ['pipe', 'pipe', 'pipe'],
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

    const mysqldumpPath = this.getMysqldumpPath();

    return new Promise((resolve, reject) => {
      const proc = spawn(
        mysqldumpPath,
        [
          `-h${this.mysqlConfig.host}`,
          `-P${this.mysqlConfig.port}`,
          `-u${this.mysqlConfig.user}`,
          '--single-transaction',
          '--routines',
          '--triggers',
          safeName,
        ],
        {
          stdio: ['ignore', 'pipe', 'pipe'],
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
    return this.runMySqlQuery(query, safeName);
  }

  async runMySqlQuery(query, database = null) {
    const mysqlPath = this.getMysqlPath();

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.mysqlConfig.host}`,
        `-P${this.mysqlConfig.port}`,
        `-u${this.mysqlConfig.user}`,
        '-N', // Skip column names
        '-B', // Batch mode
        '-e',
        query,
      ];

      if (database) {
        args.push(database);
      }

      const proc = spawn(mysqlPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
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
    const result = await this.runMySqlQuery('SHOW TABLES', safeName);
    return result.map((row) => row[0]);
  }

  async getTableStructure(databaseName, tableName) {
    const safeName = this.sanitizeName(databaseName);
    const safeTable = this.sanitizeName(tableName);
    const result = await this.runMySqlQuery(`DESCRIBE \`${safeTable}\``, safeName);
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
    const result = await this.runMySqlQuery(query);
    return parseInt(result[0]?.[0] || 0, 10);
  }

  // Helper methods
  sanitizeName(name) {
    return name.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 64);
  }

  getMysqlPath() {
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';
    return path.join(this.resourcePath, 'mysql', 'bin', binName);
  }

  getMysqldumpPath() {
    const binName = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump';
    return path.join(this.resourcePath, 'mysql', 'bin', binName);
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

      socket.connect(this.mysqlConfig.port, this.mysqlConfig.host);
    });
  }
}

module.exports = { DatabaseManager };
