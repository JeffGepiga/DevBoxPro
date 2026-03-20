const fs = require('fs-extra');
const { spawn } = require('child_process');

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
};