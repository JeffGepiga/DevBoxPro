const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  async resetCredentials(newUser = 'root', newPassword = '') {
    try {
      this.configStore.setSetting('dbUser', newUser);
      this.configStore.setSetting('dbPassword', newPassword);

      this.dbConfig.user = newUser;
      this.dbConfig.password = newPassword;

      return { success: true };
    } catch (error) {
      this.managers.log?.systemError('Error saving database credentials', { error: error.message });
      throw new Error(`Failed to save credentials: ${error.message}`);
    }
  },

  async createCredentialResetInitFile(newUser, newPassword) {
    const dbType = this.getActiveDatabaseType();
    const dataPath = this.configStore.getDataPath();
    const initFilePath = path.join(dataPath, dbType, 'credential_reset.sql');

    const escapedPassword = newPassword.replace(/\\/g, '\\\\').replace(/'/g, "''");
    const safeUser = newUser.replace(/[^a-zA-Z0-9_]/g, '_').substring(0, 32);

    const sqlCommands = [
      'FLUSH PRIVILEGES;',
      `CREATE USER IF NOT EXISTS '${safeUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${safeUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `CREATE USER IF NOT EXISTS '${safeUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${safeUser}'@'localhost' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${safeUser}'@'127.0.0.1' IDENTIFIED BY '${escapedPassword}';`,
      `ALTER USER '${safeUser}'@'%' IDENTIFIED BY '${escapedPassword}';`,
      `GRANT ALL PRIVILEGES ON *.* TO '${safeUser}'@'localhost' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${safeUser}'@'127.0.0.1' WITH GRANT OPTION;`,
      `GRANT ALL PRIVILEGES ON *.* TO '${safeUser}'@'%' WITH GRANT OPTION;`,
      'FLUSH PRIVILEGES;',
    ];

    await fs.ensureDir(path.dirname(initFilePath));
    await fs.writeFile(initFilePath, sqlCommands.join('\n'), 'utf8');

    if (process.platform !== 'win32') {
      try {
        await fs.chmod(initFilePath, 0o600);
      } catch (error) {
        this.managers.log?.systemWarn('Could not set restrictive permissions on init file', { error: error.message });
      }
    }

    setTimeout(async () => {
      try {
        if (await fs.pathExists(initFilePath)) {
          await fs.remove(initFilePath);
          this.managers.log?.systemInfo('Cleaned up credential init file');
        }
      } catch (error) {
      }
    }, 60000);

    return initFilePath;
  },

  async runDbQueryNoAuth(query, database = null) {
    const clientPath = this.getDbClientPath();
    const dbType = this.getActiveDatabaseType();

    let port = 3306;
    if (this.managers.service) {
      const serviceConfig = this.managers.service.serviceConfigs[dbType];
      if (serviceConfig?.actualPort) {
        port = serviceConfig.actualPort;
      }
    }

    if (!fs.existsSync(clientPath)) {
      throw new Error(`MySQL client not found at ${clientPath}. Please install the database binary.`);
    }

    await this.ensureDbBinaryRuntime(clientPath);

    return new Promise((resolve, reject) => {
      const args = [
        '-h127.0.0.1',
        `-P${port}`,
        '-uroot',
        '--skip-password',
        '-N',
        '-B',
        '-e',
        query,
      ];

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
        if (code !== 0) {
          const details = stderr.trim() || stdout.trim() || `exit code ${code}`;
          this.managers.log?.systemWarn('[runDbQueryNoAuth] Query warning', {
            dbType,
            clientPath,
            port,
            query,
            details,
          });
          if (stderr.includes('ERROR')) {
            reject(new Error(`Query failed: ${stderr}`));
          } else {
            resolve([]);
          }
          return;
        }

        const rows = stdout
          .replace(/\r\n/g, '\n')
          .replace(/\r/g, '')
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((row) => {
            const cols = row.split('\t').map((column) => column.trim());
            return cols.length === 1 ? { value: cols[0] } : cols;
          });
        resolve(rows);
      });

      proc.on('error', reject);
    });
  },
};