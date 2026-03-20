const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  _runMongoQuery(evalExpr, database = 'admin') {
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

    const clientPath = this.getDbClientPath();
    const port = this.getActualPort();
    const settings = this.configStore.get('settings', {});
    const mongoUser = settings.mongoUser ?? null;
    const mongoPassword = settings.mongoPassword ?? null;

    if (!fs.existsSync(clientPath)) {
      return Promise.reject(new Error(`mongosh not found at ${clientPath}. Please install the MongoDB binary from the Binaries page.`));
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
};