const path = require('path');
const fs = require('fs-extra');
const { getPlatformKey, resolvePhpBinaryPath } = require('../../utils/PhpPathResolver');

function getPlatform() {
  return getPlatformKey();
}

module.exports = {
  getFirstInstalledNodeVersion() {
    if (!this.resourcesPath) return '20';

    const platform = getPlatform();
    const nodejsDir = path.join(this.resourcesPath, 'nodejs');

    try {
      if (!fs.existsSync(nodejsDir)) return '20';

      const versions = fs.readdirSync(nodejsDir)
        .filter((version) => version !== 'downloads' && version !== 'win' && version !== 'mac')
        .filter((version) => {
          const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
          return fs.existsSync(path.join(nodejsDir, version, platform, nodeExe));
        })
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

      return versions[0] || '20';
    } catch {
      return '20';
    }
  },

  getActiveMysqlInfo() {
    const dbType = this.configStore.getSetting
      ? this.configStore.getSetting('activeDatabaseType', 'mysql')
      : this.configStore.get('settings.activeDatabaseType', 'mysql');
    const defaultVersion = dbType === 'mariadb' ? '11.4' : '8.4';
    const version = this.configStore.getSetting
      ? this.configStore.getSetting('activeDatabaseVersion', defaultVersion)
      : this.configStore.get('settings.activeDatabaseVersion', defaultVersion);
    return { dbType, version };
  },

  getPhpPath(version) {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    return resolvePhpBinaryPath(this.resourcesPath, version, platform);
  },

  buildProjectEnv(project) {
    const env = { ...process.env };

    const phpVersion = project.phpVersion || '8.3';
    const phpPath = this.getPhpPath(phpVersion);
    if (phpPath) {
      env.PATH = `${path.dirname(phpPath)}${path.delimiter}${env.PATH}`;
    }

    if (project.services?.nodejs) {
      const nodeVersion = project.services.nodejsVersion || this.getFirstInstalledNodeVersion();
      const nodePath = this.getNodePath(nodeVersion);
      if (nodePath) {
        env.PATH = `${path.dirname(nodePath)}${path.delimiter}${env.PATH}`;
      }
    }

    const composerPath = this.getComposerPath();
    if (composerPath) {
      env.PATH = `${path.dirname(composerPath)}${path.delimiter}${env.PATH}`;
    }

    const dbInfo = this.getActiveMysqlInfo();
    const mysqlClient = this.getMysqlClientPath(dbInfo.dbType, dbInfo.version);
    if (mysqlClient) {
      env.PATH = `${path.dirname(mysqlClient)}${path.delimiter}${env.PATH}`;
    }

    if (project.services?.postgresql) {
      const pgVersion = project.services.postgresqlVersion || '17';
      const psqlPath = this.getPsqlPath(pgVersion);
      if (psqlPath) {
        env.PATH = `${path.dirname(psqlPath)}${path.delimiter}${env.PATH}`;
      }
    }

    if (project.services?.python) {
      const pyVersion = project.services.pythonVersion || '3.13';
      const pythonPath = this.getPythonPath(pyVersion);
      if (pythonPath) {
        const pythonDir = path.dirname(pythonPath);
        const scriptsDir = path.join(pythonDir, 'Scripts');
        env.PATH = `${pythonDir}${path.delimiter}${scriptsDir}${path.delimiter}${env.PATH}`;
      }
    }

    if (project.services?.mongodb) {
      const mongoVersion = project.services.mongodbVersion || '8.0';
      const mongoshPath = this.getMongoshPath(mongoVersion);
      if (mongoshPath) {
        env.PATH = `${path.dirname(mongoshPath)}${path.delimiter}${env.PATH}`;
      }
    }

    return env;
  },

  getNodePath(version) {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    const nodeDir = path.join(this.resourcesPath, 'nodejs', version, platform);
    const nodeExe = process.platform === 'win32' ? 'node.exe' : 'node';
    const nodePath = path.join(nodeDir, nodeExe);
    return fs.existsSync(nodePath) ? nodePath : null;
  },

  getComposerPath() {
    if (!this.resourcesPath) return null;
    const composerPath = path.join(this.resourcesPath, 'composer', 'composer.phar');
    return fs.existsSync(composerPath) ? composerPath : null;
  },

  getMysqlClientPath(dbType, version) {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';
    const clientPath = path.join(this.resourcesPath, dbType, version, platform, 'bin', binName);
    return fs.existsSync(clientPath) ? clientPath : null;
  },

  getMysqldumpPath(dbType, version) {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    const binName = process.platform === 'win32' ? 'mysqldump.exe' : 'mysqldump';
    const dumpPath = path.join(this.resourcesPath, dbType, version, platform, 'bin', binName);
    return fs.existsSync(dumpPath) ? dumpPath : null;
  },

  getPsqlPath(version = '17') {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    const binName = process.platform === 'win32' ? 'psql.exe' : 'psql';
    const psqlPath = path.join(this.resourcesPath, 'postgresql', version, platform, 'bin', binName);
    return fs.existsSync(psqlPath) ? psqlPath : null;
  },

  getPythonPath(version = '3.13') {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    const binName = process.platform === 'win32' ? 'python.exe' : 'bin/python3';
    const pyPath = path.join(this.resourcesPath, 'python', version, platform, binName);
    return fs.existsSync(pyPath) ? pyPath : null;
  },

  getMongoshPath(version = '8.0') {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    const binName = process.platform === 'win32' ? 'mongosh.exe' : 'mongosh';
    const mongoshPath = path.join(this.resourcesPath, 'mongodb', version, platform, 'bin', binName);
    return fs.existsSync(mongoshPath) ? mongoshPath : null;
  },

  getSqlitePath(version = '3') {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    if (platform !== 'win') return 'sqlite3';
    const sqlitePath = path.join(this.resourcesPath, 'sqlite', version, platform, 'sqlite3.exe');
    return fs.existsSync(sqlitePath) ? sqlitePath : 'sqlite3';
  },

  getMemcachedPath(version = '1.6') {
    if (!this.resourcesPath) return null;
    const platform = getPlatform();
    const binName = process.platform === 'win32' ? 'memcached.exe' : 'memcached';
    const memcachedPath = path.join(this.resourcesPath, 'memcached', version, platform, binName);
    return fs.existsSync(memcachedPath) ? memcachedPath : null;
  },

  getFirstInstalledMysqlVersion() {
    if (!this.resourcesPath) return { dbType: 'mysql', version: '8.4' };

    const platform = getPlatform();
    const binName = process.platform === 'win32' ? 'mysql.exe' : 'mysql';

    for (const dbType of ['mysql', 'mariadb']) {
      const dbDir = path.join(this.resourcesPath, dbType);
      try {
        if (!fs.existsSync(dbDir)) continue;
        const versions = fs.readdirSync(dbDir)
          .filter((version) => version !== 'downloads' && version !== 'win' && version !== 'mac' && version !== 'backups')
          .filter((version) => fs.existsSync(path.join(dbDir, version, platform, 'bin', binName)))
          .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
        if (versions.length > 0) {
          return { dbType, version: versions[0] };
        }
      } catch {
      }
    }

    return { dbType: 'mysql', version: '8.4' };
  },

  getDefaultPhpVersion() {
    return this.configStore.get('settings.defaultPhpVersion', null);
  },

  setDefaultPhpVersion(version) {
    if (version) {
      this.configStore.set('settings.defaultPhpVersion', version);
      return;
    }

    this.configStore.delete('settings.defaultPhpVersion');
  },

  getDefaultNodeVersion() {
    return this.configStore.get('settings.defaultNodeVersion', null);
  },

  setDefaultNodeVersion(version) {
    if (version) {
      this.configStore.set('settings.defaultNodeVersion', version);
      return;
    }

    this.configStore.delete('settings.defaultNodeVersion');
  },

  getDefaultPythonVersion() {
    return this.configStore.get('settings.defaultPythonVersion', null);
  },

  setDefaultPythonVersion(version) {
    if (version) {
      this.configStore.set('settings.defaultPythonVersion', version);
      return;
    }

    this.configStore.delete('settings.defaultPythonVersion');
  },

  getDefaultMysqlType() {
    return this.getActiveMysqlInfo().dbType;
  },

  getDefaultMysqlVersion() {
    return this.getActiveMysqlInfo().version;
  },

  getFirstInstalledPhpVersion() {
    if (!this.resourcesPath) return '8.3';

    const platform = getPlatform();
    const phpDir = path.join(this.resourcesPath, 'php');

    try {
      if (!fs.existsSync(phpDir)) return '8.3';

      const versions = fs.readdirSync(phpDir)
        .filter((version) => version !== 'downloads' && version !== 'win' && version !== 'mac')
        .filter((version) => {
          const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
          return fs.existsSync(path.join(phpDir, version, platform, phpExe));
        })
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

      return versions[0] || '8.3';
    } catch {
      return '8.3';
    }
  },

  getFirstInstalledPythonVersion() {
    if (!this.resourcesPath) return '3.13';

    const platform = getPlatform();
    const pyDir = path.join(this.resourcesPath, 'python');
    const pyExe = process.platform === 'win32' ? 'python.exe' : 'bin/python3';

    try {
      if (!fs.existsSync(pyDir)) return '3.13';

      const versions = fs.readdirSync(pyDir)
        .filter((version) => version !== 'downloads' && version !== 'win' && version !== 'mac')
        .filter((version) => fs.existsSync(path.join(pyDir, version, platform, pyExe)))
        .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));

      return versions[0] || '3.13';
    } catch {
      return '3.13';
    }
  },
};