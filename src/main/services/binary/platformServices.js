const path = require('path');
const fs = require('fs-extra');
const unzipper = require('unzipper');
const { spawn } = require('child_process');

module.exports = {
  async downloadPostgresql(version = '17') {
    const id = `postgresql-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.postgresql[version]?.[platform];

    this.ensureAutomatedDownloadAvailable(downloadInfo, `PostgreSQL ${version}`, platform);

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'postgresql', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);

      this.emitProgress(id, { status: 'extracting', progress: 0 });
      const directory = await unzipper.Open.file(downloadPath);
      const totalFiles = directory.files.length;
      let processed = 0;

      for (const file of directory.files) {
        if (file.path.includes('pgAdmin') || file.path.toLowerCase().endsWith('.asar')) {
          processed++;
          continue;
        }

        const targetPath = path.join(extractPath, file.path);
        if (file.type === 'Directory') {
          await fs.ensureDir(targetPath);
        } else {
          await fs.ensureDir(path.dirname(targetPath));
          await new Promise((resolve, reject) => {
            file.stream()
              .pipe(fs.createWriteStream(targetPath))
              .on('finish', resolve)
              .on('error', reject);
          });
        }

        processed++;
        if (processed % 200 === 0) {
          const pct = Math.round((processed / totalFiles) * 90);
          this.emitProgress(id, { status: 'extracting', progress: pct });
        }
      }

      this.emitProgress(id, { status: 'extracting', progress: 95 });

      const pgsqlDir = path.join(extractPath, 'pgsql');
      if (await fs.pathExists(pgsqlDir)) {
        await fs.copy(pgsqlDir, extractPath, { overwrite: true });
        await fs.remove(pgsqlDir);
      }

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download PostgreSQL ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  getPostgresqlBinPath(version = '17') {
    const platform = this.getPlatform();
    return path.join(this.resourcesPath, 'postgresql', version, platform, 'bin');
  },

  async downloadPython(version = '3.13') {
    const id = `python-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.python[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Python ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'python', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      if (platform === 'win') {
        const majorMinor = version.replace('.', '').replace('.', '');
        const pthFile = path.join(extractPath, `python${majorMinor}._pth`);
        if (await fs.pathExists(pthFile)) {
          let content = await fs.readFile(pthFile, 'utf8');
          content = content.replace('#import site', 'import site');
          await fs.writeFile(pthFile, content);
        }
      }

      await this.bootstrapPip(extractPath, platform, id);

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Python ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async bootstrapPip(pythonDir, platform, id) {
    const pyExe = platform === 'win' ? 'python.exe' : 'bin/python3';
    const pythonPath = path.join(pythonDir, pyExe);

    if (!await fs.pathExists(pythonPath)) {
      this.managers?.log?.systemWarn('Cannot bootstrap pip: Python executable not found');
      return;
    }

    try {
      this.emitProgress(id, { status: 'installing_pip', progress: 85, message: 'Installing pip...' });

      const getPipPath = path.join(pythonDir, 'get-pip.py');
      const getPipUrl = 'https://bootstrap.pypa.io/get-pip.py';
      const getPipId = `${id}-getpip`;

      try {
        await this.downloadFile(getPipUrl, getPipPath, getPipId);
        this.emitProgress(getPipId, { status: 'completed', progress: 100 });
      } catch (err) {
        this.emitProgress(getPipId, { status: 'error', error: err.message });
        throw err;
      }

      await new Promise((resolve, reject) => {
        const proc = spawn(pythonPath, [getPipPath, '--no-warn-script-location'], {
          cwd: pythonDir,
          windowsHide: true,
          env: { ...process.env },
        });

        let stderr = '';
        proc.stdout.on('data', () => { });
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`get-pip.py failed with code ${code}: ${stderr}`));
        });

        proc.on('error', (err) => {
          reject(new Error(`Failed to run get-pip.py: ${err.message}`));
        });
      });

      await fs.remove(getPipPath);

      this.managers?.log?.system?.('pip bootstrapped successfully');
    } catch (error) {
      this.managers?.log?.systemWarn?.('Failed to bootstrap pip', { error: error.message });
    }
  },

  getPythonPath(version = '3.13') {
    const platform = this.getPlatform();
    const pyDir = path.join(this.resourcesPath, 'python', version, platform);
    const pyExe = platform === 'win' ? 'python.exe' : 'bin/python3';
    return path.join(pyDir, pyExe);
  },

  async runPip(version = '3.13', args = [], onOutput = null) {
    const pyPath = this.getPythonPath(version);
    const pipArgs = ['-m', 'pip', ...args];

    if (!await fs.pathExists(pyPath)) {
      throw new Error(`Python ${version} is not installed`);
    }

    return new Promise((resolve, reject) => {
      const proc = spawn(pyPath, pipArgs, {
        windowsHide: true,
        shell: false,
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (data) => {
        stdout += data;
        onOutput?.(data.toString().trim(), 'stdout');
      });
      proc.stderr.on('data', (data) => {
        stderr += data;
        onOutput?.(data.toString().trim(), 'stderr');
      });
      proc.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr || `pip exited with code ${code}`)));
      proc.on('error', reject);
    });
  },

  async downloadMongodb(version = '8.0') {
    const id = `mongodb-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mongodb[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`MongoDB ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mongodb', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      const contents = await fs.readdir(extractPath);
      const extractedDir = contents.find((entry) => entry.startsWith('mongodb-'));
      if (extractedDir) {
        const srcPath = path.join(extractPath, extractedDir);
        const files = await fs.readdir(srcPath);
        for (const file of files) {
          await fs.move(path.join(srcPath, file), path.join(extractPath, file), { overwrite: true });
        }
        await fs.remove(srcPath);
      }

      await this.downloadMongosh(version);
      await this.downloadMongoTools(version);

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download MongoDB ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  async downloadMongosh(mongoVersion = '8.0') {
    const id = `mongosh-${mongoVersion}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mongosh?.latest?.[platform];

    if (!downloadInfo) {
      return { success: false, error: 'mongosh not available for this platform' };
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mongodb', mongoVersion, platform);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      const contents = await fs.readdir(extractPath);
      const mongoshDir = contents.find((entry) => entry.startsWith('mongosh-'));
      if (mongoshDir) {
        const srcBin = path.join(extractPath, mongoshDir, 'bin');
        const destBin = path.join(extractPath, 'bin');
        if (await fs.pathExists(srcBin)) {
          const binFiles = await fs.readdir(srcBin);
          for (const file of binFiles) {
            await fs.move(path.join(srcBin, file), path.join(destBin, file), { overwrite: true });
          }
        }
        await fs.remove(path.join(extractPath, mongoshDir));
      }

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemWarn('Failed to download mongosh', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  async downloadMongoTools(mongoVersion = '8.0') {
    const id = `mongotools-${mongoVersion}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.mongotools?.latest?.[platform];

    if (!downloadInfo) {
      return { success: false, error: 'MongoDB Database Tools not available for this platform' };
    }

    this.ensureAutomatedDownloadAvailable(downloadInfo, 'MongoDB Database Tools', platform);

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'mongodb', mongoVersion, platform);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      // Move tools binaries from nested directory into the main bin folder
      const contents = await fs.readdir(extractPath);
      const toolsDir = contents.find((entry) => entry.startsWith('mongodb-database-tools'));
      if (toolsDir) {
        const srcBin = path.join(extractPath, toolsDir, 'bin');
        const destBin = path.join(extractPath, 'bin');
        if (await fs.pathExists(srcBin)) {
          const binFiles = await fs.readdir(srcBin);
          for (const file of binFiles) {
            await fs.move(path.join(srcBin, file), path.join(destBin, file), { overwrite: true });
          }
        }
        await fs.remove(path.join(extractPath, toolsDir));
      }

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemWarn('Failed to download MongoDB Database Tools', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  getMongodbBinPath(version = '8.0') {
    const platform = this.getPlatform();
    return path.join(this.resourcesPath, 'mongodb', version, platform, 'bin');
  },

  async downloadSqlite(version = '3') {
    const normalizedVersion = version || '3';
    const id = 'sqlite';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.sqlite[normalizedVersion]?.[platform];

    if (!downloadInfo || downloadInfo.url === 'builtin') {
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, builtin: true, version: normalizedVersion };
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'sqlite', normalizedVersion, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);
      await fs.remove(downloadPath);

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version: normalizedVersion };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download SQLite', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  getSqlitePath(version = '3') {
    const platform = this.getPlatform();
    const sqliteDir = path.join(this.resourcesPath, 'sqlite', version, platform);
    const sqliteExe = platform === 'win' ? 'sqlite3.exe' : 'sqlite3';
    return path.join(sqliteDir, sqliteExe);
  },

  async downloadMinio() {
    const id = 'minio';
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.minio?.latest?.[platform];

    if (!downloadInfo) {
      throw new Error(`MinIO not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const minioDir = path.join(this.resourcesPath, 'minio', platform);
      await fs.ensureDir(minioDir);

      const destPath = path.join(minioDir, downloadInfo.filename);

      await this.downloadFile(downloadInfo.url, destPath, id);
      await this.checkCancelled(id, destPath);

      if (platform !== 'win') {
        await fs.chmod(destPath, '755');
      }

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError('Failed to download MinIO', { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  getMinioPath() {
    const platform = this.getPlatform();
    const minioDir = path.join(this.resourcesPath, 'minio', platform);
    const minioExe = platform === 'win' ? 'minio.exe' : 'minio';
    return path.join(minioDir, minioExe);
  },

  async downloadMemcached(version = '1.6') {
    const id = `memcached-${version}`;
    const platform = this.getPlatform();
    const downloadInfo = this.downloads.memcached[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Memcached ${version} not available for ${platform}`);
    }

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
      const extractPath = path.join(this.resourcesPath, 'memcached', version, platform);

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);

      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);
      await this.extractArchive(downloadPath, extractPath, id);

      const contents = await fs.readdir(extractPath);
      const extractedDir = contents.find((entry) => entry.startsWith('memcached-'));
      if (extractedDir) {
        const srcPath = path.join(extractPath, extractedDir);
        const stat = await fs.stat(srcPath);
        if (stat.isDirectory()) {
          const files = await fs.readdir(srcPath);
          for (const file of files) {
            await fs.move(path.join(srcPath, file), path.join(extractPath, file), { overwrite: true });
          }
          await fs.remove(srcPath);
        }
      }

      if (platform === 'win') {
        const binPath = path.join(extractPath, 'bin');
        if (await fs.pathExists(binPath)) {
          const binFiles = await fs.readdir(binPath);
          for (const file of binFiles) {
            await fs.move(path.join(binPath, file), path.join(extractPath, file), { overwrite: true });
          }
          await fs.remove(binPath);
        }
      }

      await fs.remove(downloadPath);
      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version };
    } catch (error) {
      if (error.cancelled) {
        return { success: false, cancelled: true };
      }
      this.managers?.log?.systemError(`Failed to download Memcached ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },

  getMemcachedPath(version = '1.6') {
    const platform = this.getPlatform();
    const memcachedDir = path.join(this.resourcesPath, 'memcached', version, platform);
    const memcachedExe = platform === 'win' ? 'memcached.exe' : 'memcached';
    return path.join(memcachedDir, memcachedExe);
  },
};