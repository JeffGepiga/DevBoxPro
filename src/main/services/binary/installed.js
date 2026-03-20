const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async getInstalledBinaries() {
    const platform = this.getPlatform();
    const installed = {
      php: {},
      mysql: {},
      mariadb: {},
      redis: {},
      mailpit: false,
      phpmyadmin: false,
      nginx: {},
      apache: {},
      nodejs: {},
      composer: false,
      git: false,
    };

    for (const version of this.versionMeta.php) {
      const phpPath = path.join(this.resourcesPath, 'php', version, platform);
      const phpExe = platform === 'win' ? 'php.exe' : 'php';
      const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';
      const phpExists = await fs.pathExists(path.join(phpPath, phpExe));
      const phpCgiExists = await fs.pathExists(path.join(phpPath, phpCgiExe));
      installed.php[version] = phpExists && phpCgiExists;
    }
    await this.scanCustomPhpVersions(installed.php, platform);

    for (const version of this.versionMeta.mysql) {
      const mysqlPath = path.join(this.resourcesPath, 'mysql', version, platform, 'bin');
      const mysqlExe = platform === 'win' ? 'mysqld.exe' : 'mysqld';
      installed.mysql[version] = await fs.pathExists(path.join(mysqlPath, mysqlExe));
    }
    await this.scanCustomVersions('mysql', installed.mysql, platform, platform === 'win' ? 'bin/mysqld.exe' : 'bin/mysqld');

    for (const version of this.versionMeta.mariadb) {
      const mariadbPath = path.join(this.resourcesPath, 'mariadb', version, platform, 'bin');
      const mariadbExe = platform === 'win' ? 'mariadbd.exe' : 'mariadbd';
      installed.mariadb[version] = await fs.pathExists(path.join(mariadbPath, mariadbExe));
    }
    await this.scanCustomVersions('mariadb', installed.mariadb, platform, platform === 'win' ? 'bin/mariadbd.exe' : 'bin/mariadbd');

    for (const version of this.versionMeta.redis) {
      const redisPath = path.join(this.resourcesPath, 'redis', version, platform);
      const redisExe = platform === 'win' ? 'redis-server.exe' : 'redis-server';
      installed.redis[version] = await fs.pathExists(path.join(redisPath, redisExe));
    }
    const redisExe = platform === 'win' ? 'redis-server.exe' : 'redis-server';
    await this.scanBinaryVersionsRecursive('redis', installed.redis, platform, redisExe);

    const mailpitPath = path.join(this.resourcesPath, 'mailpit', platform);
    const mailpitExe = platform === 'win' ? 'mailpit.exe' : 'mailpit';
    installed.mailpit = await fs.pathExists(path.join(mailpitPath, mailpitExe));

    const pmaPath = path.join(this.resourcesPath, 'phpmyadmin', 'index.php');
    installed.phpmyadmin = await fs.pathExists(pmaPath);

    for (const version of this.versionMeta.nginx) {
      const nginxPath = path.join(this.resourcesPath, 'nginx', version, platform);
      const nginxExe = platform === 'win' ? 'nginx.exe' : 'nginx';
      installed.nginx[version] = await fs.pathExists(path.join(nginxPath, nginxExe));
    }
    const nginxExe = platform === 'win' ? 'nginx.exe' : 'nginx';
    await this.scanBinaryVersionsRecursive('nginx', installed.nginx, platform, nginxExe);

    for (const version of this.versionMeta.apache) {
      const apachePath = path.join(this.resourcesPath, 'apache', version, platform);
      const apacheExe = platform === 'win' ? 'bin/httpd.exe' : 'bin/httpd';
      installed.apache[version] = await fs.pathExists(path.join(apachePath, apacheExe));
    }
    await this.scanCustomVersions('apache', installed.apache, platform, platform === 'win' ? 'bin/httpd.exe' : 'bin/httpd');

    for (const version of this.versionMeta.nodejs) {
      installed.nodejs[version] = await this.isNodejsVersionInstalled(version, platform);
    }
    const nodeExe = platform === 'win' ? 'node.exe' : 'node';
    await this.scanBinaryVersionsRecursive('nodejs', installed.nodejs, platform, nodeExe);

    for (const [version, isInstalled] of Object.entries(installed.nodejs)) {
      if (isInstalled) {
        installed.nodejs[version] = await this.isNodejsVersionInstalled(version, platform);
      }
    }

    const composerPath = path.join(this.resourcesPath, 'composer', 'composer.phar');
    installed.composer = await fs.pathExists(composerPath);

    const gitPath = path.join(this.resourcesPath, 'git', platform);
    const gitExe = platform === 'win' ? 'cmd/git.exe' : 'bin/git';
    installed.git = await fs.pathExists(path.join(gitPath, gitExe));

    installed.postgresql = {};
    for (const version of (this.versionMeta.postgresql || [])) {
      const pgPath = path.join(this.resourcesPath, 'postgresql', version, platform, 'bin');
      const pgExe = platform === 'win' ? 'postgres.exe' : 'postgres';
      installed.postgresql[version] = await fs.pathExists(path.join(pgPath, pgExe));
    }

    installed.python = {};
    for (const version of (this.versionMeta.python || [])) {
      const pyPath = path.join(this.resourcesPath, 'python', version, platform);
      const pyExe = platform === 'win' ? 'python.exe' : 'bin/python3';
      installed.python[version] = await fs.pathExists(path.join(pyPath, pyExe));
    }

    installed.mongodb = {};
    for (const version of (this.versionMeta.mongodb || [])) {
      const mongoPath = path.join(this.resourcesPath, 'mongodb', version, platform, 'bin');
      const mongoExe = platform === 'win' ? 'mongod.exe' : 'mongod';
      const mongoShellExe = platform === 'win' ? 'mongosh.exe' : 'mongosh';
      const legacyMongoShellExe = platform === 'win' ? 'mongo.exe' : 'mongo';
      const serverInstalled = await fs.pathExists(path.join(mongoPath, mongoExe));
      const shellInstalled = await fs.pathExists(path.join(mongoPath, mongoShellExe))
        || await fs.pathExists(path.join(mongoPath, legacyMongoShellExe));
      installed.mongodb[version] = serverInstalled && shellInstalled;
    }

    const sqlitePath = path.join(this.resourcesPath, 'sqlite', '3', platform);
    const sqliteExe = platform === 'win' ? 'sqlite3.exe' : 'sqlite3';
    const sqliteBuiltin = platform !== 'win';
    installed.sqlite = sqliteBuiltin || await fs.pathExists(path.join(sqlitePath, sqliteExe));

    const minioPath = path.join(this.resourcesPath, 'minio', platform);
    const minioExe = platform === 'win' ? 'minio.exe' : 'minio';
    installed.minio = await fs.pathExists(path.join(minioPath, minioExe));

    installed.memcached = {};
    for (const version of (this.versionMeta.memcached || [])) {
      const memcachedPath = path.join(this.resourcesPath, 'memcached', version, platform);
      const memcachedExe = platform === 'win' ? 'memcached.exe' : 'memcached';
      installed.memcached[version] = await fs.pathExists(path.join(memcachedPath, memcachedExe));
    }

    return installed;
  },

  async scanCustomVersions(serviceName, installedObj, platform, exePath) {
    try {
      const serviceDir = path.join(this.resourcesPath, serviceName);
      if (!await fs.pathExists(serviceDir)) return;

      const dirs = await fs.readdir(serviceDir);
      for (const dir of dirs) {
        if (installedObj[dir] !== undefined || dir === 'win' || dir === 'mac') continue;

        const fullPath = path.join(serviceDir, dir, platform, exePath);
        if (await fs.pathExists(fullPath)) {
          installedObj[dir] = true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn(`Error scanning custom ${serviceName} versions`, { error: error.message });
    }
  },

  async scanCustomPhpVersions(installedObj, platform) {
    try {
      const serviceDir = path.join(this.resourcesPath, 'php');
      if (!await fs.pathExists(serviceDir)) return;

      const phpExe = platform === 'win' ? 'php.exe' : 'php';
      const phpCgiExe = platform === 'win' ? 'php-cgi.exe' : 'php-cgi';

      const dirs = await fs.readdir(serviceDir);
      for (const dir of dirs) {
        if (installedObj[dir] !== undefined || dir === 'win' || dir === 'mac') continue;

        const phpPath = path.join(serviceDir, dir, platform, phpExe);
        const phpCgiPath = path.join(serviceDir, dir, platform, phpCgiExe);
        const phpExists = await fs.pathExists(phpPath);
        const phpCgiExists = await fs.pathExists(phpCgiPath);

        if (phpExists && phpCgiExists) {
          installedObj[dir] = true;
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Error scanning custom PHP versions', { error: error.message });
    }
  },

  async scanBinaryVersionsRecursive(serviceName, installedObj, platform, exeName, maxDepth = 2) {
    try {
      const serviceDir = path.join(this.resourcesPath, serviceName);
      if (!await fs.pathExists(serviceDir)) return;

      const dirs = await fs.readdir(serviceDir);
      for (const dir of dirs) {
        if (installedObj[dir] !== undefined || dir === 'win' || dir === 'mac') continue;

        const standardPath = path.join(serviceDir, dir, platform, exeName);
        if (await fs.pathExists(standardPath)) {
          installedObj[dir] = true;
          continue;
        }

        const versionPlatformDir = path.join(serviceDir, dir, platform);
        if (await fs.pathExists(versionPlatformDir)) {
          const found = await this.findExecutableRecursive(versionPlatformDir, exeName, 0, maxDepth);
          if (found) {
            installedObj[dir] = true;
          }
        }
      }
    } catch (error) {
      this.managers?.log?.systemWarn(`Error scanning ${serviceName} versions`, { error: error.message });
    }
  },

  async findExecutableRecursive(dir, exeName, currentDepth, maxDepth) {
    if (currentDepth > maxDepth) return false;

    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isFile() && entry.name === exeName) {
          return true;
        }
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subDir = path.join(dir, entry.name);
          const found = await this.findExecutableRecursive(subDir, exeName, currentDepth + 1, maxDepth);
          if (found) return true;
        }
      }
    } catch {
      // Ignore per-directory errors during recursive scans.
    }

    return false;
  },

  getNodejsInstallPaths(version = '20', platform = this.getPlatform()) {
    const nodejsPath = path.join(this.resourcesPath, 'nodejs', version, platform);

    return {
      nodejsPath,
      nodePath: platform === 'win' ? path.join(nodejsPath, 'node.exe') : path.join(nodejsPath, 'bin', 'node'),
      npmPath: platform === 'win' ? path.join(nodejsPath, 'npm.cmd') : path.join(nodejsPath, 'bin', 'npm'),
      npxPath: platform === 'win' ? path.join(nodejsPath, 'npx.cmd') : path.join(nodejsPath, 'bin', 'npx'),
      npmCliPath: platform === 'win'
        ? path.join(nodejsPath, 'node_modules', 'npm', 'bin', 'npm-cli.js')
        : path.join(nodejsPath, 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      npxCliPath: platform === 'win'
        ? path.join(nodejsPath, 'node_modules', 'npm', 'bin', 'npx-cli.js')
        : path.join(nodejsPath, 'lib', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
    };
  },

  async isNodejsVersionInstalled(version = '20', platform = this.getPlatform()) {
    const paths = this.getNodejsInstallPaths(version, platform);
    const hasNode = await fs.pathExists(paths.nodePath);

    if (!hasNode) {
      return false;
    }

    const hasNpm = await fs.pathExists(paths.npmPath);
    const hasNpmCli = await fs.pathExists(paths.npmCliPath);
    const hasNpx = await fs.pathExists(paths.npxPath);
    const hasNpxCli = await fs.pathExists(paths.npxCliPath);

    return (hasNpm || hasNpmCli) && (hasNpx || hasNpxCli);
  },
};
