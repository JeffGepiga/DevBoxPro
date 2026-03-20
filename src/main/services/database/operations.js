const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  async listDatabases() {
    const dbType = this.getActiveDatabaseType();

    if (!await this.ensureServiceRunning()) {
      return [];
    }

    try {
      if (dbType === 'postgresql') {
        const rows = await this._runPostgresQuery(
          'SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname'
        );
        const systemDbs = new Set(['postgres']);
        return rows.map((row) => ({
          name: (row[0] || '').trim(),
          isSystem: systemDbs.has((row[0] || '').trim()),
        }));
      }

      if (dbType === 'mongodb') {
        const lines = await this._runMongoQuery(
          'db.adminCommand({listDatabases:1}).databases.forEach(d=>print(d.name))',
          'admin'
        );
        const systemDbs = new Set(['admin', 'local', 'config']);
        return lines.map((name) => ({
          name: name.trim(),
          isSystem: systemDbs.has(name.trim()),
        }));
      }

      const result = await this.runDbQuery('SHOW DATABASES');
      return result.map((row) => ({
        name: (row.Database || '').trim(),
        isSystem: ['information_schema', 'mysql', 'performance_schema', 'sys'].includes((row.Database || '').trim()),
      }));
    } catch (error) {
      const message = error.message || '';
      const isConnectionError = message.includes('2003') || message.includes("Can't connect") ||
        message.includes('ECONNREFUSED') || message.includes('Connection refused');
      if (isConnectionError) {
        return [];
      }
      throw error;
    }
  },

  async createDatabase(name, version = null) {
    const safeName = this.sanitizeName(name);
    const dbType = this.getActiveDatabaseType();
    const dbVersion = version || this.getActiveDatabaseVersion();

    if (!await this.ensureServiceRunning(dbType, dbVersion)) {
      if (this.managers.service) {
        try {
          await this.managers.service.startService(dbType, dbVersion);
          await new Promise((resolve) => setTimeout(resolve, 3000));
          if (!await this.ensureServiceRunning(dbType, dbVersion)) {
            throw new Error(`${dbType} ${dbVersion} failed to start`);
          }
        } catch (startError) {
          this.managers.log?.systemError(`Failed to start ${dbType} ${dbVersion}`, { error: startError.message });
          throw new Error(`Cannot create database: ${dbType} ${dbVersion} is not running and failed to start. Please start it manually first.`);
        }
      } else {
        throw new Error(`Cannot create database: ${dbType} ${dbVersion} is not running. Please start it first.`);
      }
    }

    if (dbType === 'postgresql') {
      const existing = await this._runPostgresQuery(
        `SELECT 1 FROM pg_database WHERE datname = '${safeName.replace(/'/g, "''")}'`
      );
      if (existing.length === 0) {
        await this._runPostgresQuery(`CREATE DATABASE "${safeName}"`);
      }
      return { success: true, name: safeName };
    }

    if (dbType === 'mongodb') {
      await this._runMongoQuery(
        `db.getSiblingDB("${safeName}").getCollection("_devbox_meta").updateOne({_id:"init"},{$set:{createdAt:new Date()}},{upsert:true})`,
        'admin'
      );
      return { success: true, name: safeName };
    }

    await this.runDbQuery(`CREATE DATABASE IF NOT EXISTS \`${safeName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    return { success: true, name: safeName };
  },

  async deleteDatabase(name) {
    const safeName = this.sanitizeName(name);
    const dbType = this.getActiveDatabaseType();

    const mysqlSystem = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);
    const postgresSystem = new Set(['postgres', 'template0', 'template1']);
    const mongoSystem = new Set(['admin', 'local', 'config']);

    if (dbType === 'postgresql' && postgresSystem.has(safeName)) {
      throw new Error('Cannot delete system database');
    }
    if (dbType === 'mongodb' && mongoSystem.has(safeName)) {
      throw new Error('Cannot delete system database');
    }
    if ((dbType === 'mysql' || dbType === 'mariadb') && mysqlSystem.has(safeName)) {
      throw new Error('Cannot delete system database');
    }

    if (dbType === 'postgresql') {
      await this._runPostgresQuery(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${safeName.replace(/'/g, "''")}' AND pid <> pg_backend_pid()`
      );
      await this._runPostgresQuery(`DROP DATABASE IF EXISTS "${safeName}"`);
      return { success: true, name: safeName };
    }

    if (dbType === 'mongodb') {
      await this._runMongoQuery('db.dropDatabase()', safeName);
      return { success: true, name: safeName };
    }

    await this.runDbQuery(`DROP DATABASE IF EXISTS \`${safeName}\``);
    return { success: true, name: safeName };
  },

  async runQuery(databaseName, query) {
    const safeName = this.sanitizeName(databaseName);

    this.managers.log?.systemInfo('Executing database query', {
      database: safeName,
      queryLength: query?.length || 0,
      queryPreview: query?.substring(0, 50) + (query?.length > 50 ? '...' : ''),
    });

    return this.runDbQuery(query, safeName);
  },

  async runDbQuery(query, database = null) {
    const dbType = this.getActiveDatabaseType();

    if (dbType === 'postgresql') {
      return this._runPostgresQuery(query, database || 'postgres');
    }

    if (dbType === 'mongodb') {
      return this._runMongoQuery(query, database || 'admin');
    }

    const isPlaywright = process.env.PLAYWRIGHT_TEST === 'true';
    if (isPlaywright) {
      if (!this._mockedDbs) this._mockedDbs = new Set(['information_schema', 'mysql', 'performance_schema', 'sys']);

      const normalizedQuery = query.toLowerCase();
      if (normalizedQuery.includes('create database')) {
        const match = query.match(/CREATE DATABASE (?:IF NOT EXISTS )?`([^`]+)`/i);
        if (match) this._mockedDbs.add(match[1]);
        return [];
      }
      if (normalizedQuery.includes('drop database')) {
        const match = query.match(/DROP DATABASE (?:IF EXISTS )?`([^`]+)`/i);
        if (match) this._mockedDbs.delete(match[1]);
        return [];
      }
      if (normalizedQuery.includes('show databases')) {
        return Array.from(this._mockedDbs).map((dbName) => ({ Database: dbName }));
      }
      return [];
    }

    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const user = settings.dbUser !== undefined ? settings.dbUser : this.dbConfig.user;
    const password = settings.dbPassword !== undefined ? settings.dbPassword : this.dbConfig.password;

    if (!fs.existsSync(clientPath)) {
      throw new Error(`Database client not found at ${clientPath}. Please install the database binary from the Binaries page.`);
    }

    await this.ensureDbBinaryRuntime(clientPath);

    return new Promise((resolve, reject) => {
      const args = [
        `-h${this.dbConfig.host}`,
        `-P${port}`,
        `-u${user}`,
      ];

      if (password) {
        args.push(`-p${password}`);
      }

      args.push('-N', '-B', '-e', query);

      if (database) {
        args.push(database);
      }

      const proc = spawn(clientPath, args, this.buildBinarySpawnOptions(clientPath, {
        stdio: ['pipe', 'pipe', 'pipe'],
      }));

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
          const rows = stdout
            .replace(/\r\n/g, '\n')
            .replace(/\r/g, '')
            .trim()
            .split('\n')
            .filter((line) => line.length > 0)
            .map((line) => {
              const columns = line.split('\t').map((column) => column.trim());
              if (query.toLowerCase().includes('show databases')) {
                return { Database: columns[0] };
              }
              return columns;
            });

          resolve(rows);
          return;
        }

        const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
        this.managers.log?.systemError('Database query failed', {
          dbType,
          user,
          port,
          clientPath,
          database,
          query,
          details,
        });
        if (stderr.includes('Access denied') || stderr.includes('1045')) {
          const hint = password
            ? 'The stored credentials may be incorrect.'
            : 'The database may have a password set but none is configured in settings.';
          reject(new Error(`Database access denied for user '${user}'. ${hint} You may need to restart the database or check Settings > Network.`));
        } else {
          reject(new Error(`Query failed: ${details}`));
        }
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('Database client process error', {
          dbType,
          user,
          port,
          clientPath,
          database,
          query,
          error: error.message,
        });
        reject(error);
      });
    });
  },

  async dropAllTables(databaseName) {
    const safeName = this.sanitizeName(databaseName);
    const dbType = this.getActiveDatabaseType();

    try {
      this.managers.log?.systemInfo(`Dropping and recreating database '${safeName}' for clean import`);

      if (dbType === 'postgresql') {
        await this._runPostgresQuery(
          `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${safeName.replace(/'/g, "''")}' AND pid <> pg_backend_pid()`
        );
        await this._runPostgresQuery(`DROP DATABASE IF EXISTS "${safeName}"`);
        await this._runPostgresQuery(`CREATE DATABASE "${safeName}"`);
      } else if (dbType === 'mongodb') {
        await this._runMongoQuery('db.dropDatabase()', safeName);
      } else {
        await this.runDbQuery(`DROP DATABASE IF EXISTS \`${safeName}\``);
        await this.runDbQuery(`CREATE DATABASE \`${safeName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      }

      this.managers.log?.systemInfo(`Database '${safeName}' recreated successfully`);
    } catch (error) {
      this.managers.log?.systemError(`Error recreating database ${safeName}`, { error: error.message });
      throw error;
    }
  },

  async getTables(databaseName) {
    const safeName = this.sanitizeName(databaseName);
    const dbType = this.getActiveDatabaseType();

    if (dbType === 'postgresql') {
      const rows = await this._runPostgresQuery(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
        safeName
      );
      return rows.map((row) => (row[0] || '').replace(/[\r\n]/g, '').trim()).filter((name) => name.length > 0);
    }

    if (dbType === 'mongodb') {
      const lines = await this._runMongoQuery(
        'db.getCollectionNames().forEach(n=>print(n))',
        safeName
      );
      return lines.map((name) => name.trim()).filter((name) => name.length > 0);
    }

    const result = await this.runDbQuery('SHOW TABLES', databaseName);
    return result.map((row) => (row[0] || '').replace(/[\r\n]/g, '').trim()).filter((name) => name.length > 0);
  },

  async getTableStructure(databaseName, tableName) {
    const safeDatabaseName = this.sanitizeName(databaseName);
    const dbType = this.getActiveDatabaseType();

    if (dbType === 'postgresql') {
      const safeTableName = tableName.replace(/'/g, "''");
      return this._runPostgresQuery(
        `SELECT column_name, data_type, is_nullable, column_default ` +
        `FROM information_schema.columns ` +
        `WHERE table_name = '${safeTableName}' AND table_schema = 'public' ` +
        `ORDER BY ordinal_position`,
        safeDatabaseName
      );
    }

    if (dbType === 'mongodb') {
      const lines = await this._runMongoQuery(
        `var doc=db.getCollection("${tableName}").findOne(); print(doc ? JSON.stringify(Object.keys(doc)) : '[]')`,
        safeDatabaseName
      );
      try {
        const keys = JSON.parse(lines.join('') || '[]');
        return keys.map((key) => [key, 'mixed', 'YES', null]);
      } catch {
        return [];
      }
    }

    return this.runDbQuery(`DESCRIBE \`${tableName}\``, databaseName);
  },

  async getDatabaseSize(databaseName) {
    const dbType = this.getActiveDatabaseType();

    if (dbType === 'postgresql') {
      const safeName = databaseName.replace(/'/g, "''");
      const rows = await this._runPostgresQuery(
        `SELECT pg_database_size('${safeName}')`
      );
      return parseInt(rows[0]?.[0] || 0, 10);
    }

    if (dbType === 'mongodb') {
      const safeName = this.sanitizeName(databaseName);
      const lines = await this._runMongoQuery('print(db.stats().dataSize)', safeName);
      return parseInt(lines[0] || 0, 10);
    }

    const escapedName = databaseName.replace(/'/g, "''");
    const query = `
      SELECT 
        SUM(data_length + index_length) as size
      FROM information_schema.tables 
      WHERE table_schema = '${escapedName}'
    `;
    const result = await this.runDbQuery(query);
    return parseInt(result[0]?.[0] || 0, 10);
  },
};