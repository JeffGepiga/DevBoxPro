const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async importBinary(serviceName, version, filePath) {
    const id = version && version !== 'default' ? `${serviceName}-${version}` : serviceName;
    const platform = this.getPlatform();

    // Disable Electron's ASAR filesystem interception for the duration of this import.
    // Some packages (e.g. PostgreSQL's bundled pgAdmin 4) contain .asar files inside their
    // ZIP archives. Without this, Electron intercepts ALL fs operations on .asar paths
    // (stat, readdir, createWriteStream, rename, remove, etc.) and throws "Invalid package".
    // This covers: fs.remove (corrupted-folder cleanup), ZIP extraction, and
    // normalizeExtractedStructure (which moves the pgAdmin directory tree).
    const prevNoAsar = process.noAsar;
    process.noAsar = true;

    try {
      this.emitProgress(id, { status: 'starting', progress: 0 });

      if (!await fs.pathExists(filePath)) {
        throw new Error('File not found: ' + filePath);
      }

      const ext = path.extname(filePath).toLowerCase();

      if (serviceName === 'composer' && ext === '.phar') {
        const composerPath = path.join(this.resourcesPath, 'composer');
        await fs.ensureDir(composerPath);
        await fs.copy(filePath, path.join(composerPath, 'composer.phar'));

        try {
          const downloadInfo = this.downloads.composer?.all;
          if (downloadInfo) {
            const meta = await this.fetchRemoteMetadata(downloadInfo.url);
            await this.saveServiceMetadata('composer', meta);
          }
        } catch {
        }

        this.emitProgress(id, { status: 'completed', progress: 100 });
        return { success: true, version: 'latest', path: composerPath };
      }

      if (serviceName === 'phpmyadmin') {
        const extractPath = path.join(this.resourcesPath, 'phpmyadmin');
        await fs.remove(extractPath);
        await fs.ensureDir(extractPath);

        this.emitProgress(id, { status: 'extracting', progress: 50 });
        await this.extractArchive(filePath, extractPath, id);
        await this.normalizeExtractedStructure(serviceName, extractPath);
        await this.createPhpMyAdminConfig(extractPath);

        this.emitProgress(id, { status: 'completed', progress: 100 });
        return { success: true, version: 'latest', path: extractPath };
      }

      if (serviceName === 'mailpit') {
        const extractPath = path.join(this.resourcesPath, 'mailpit', platform);
        await fs.remove(extractPath);
        await fs.ensureDir(extractPath);

        this.emitProgress(id, { status: 'extracting', progress: 50 });
        await this.extractArchive(filePath, extractPath, id);
        await this.normalizeExtractedStructure(serviceName, extractPath);

        this.emitProgress(id, { status: 'completed', progress: 100 });
        return { success: true, version: 'latest', path: extractPath };
      }

      if (ext === '.zip') {
        const isValid = await this.validateZipFile(filePath);
        if (!isValid) {
          throw new Error('Invalid ZIP file.');
        }
      } else if (!filePath.endsWith('.tar.gz') && ext !== '.tgz') {
        throw new Error('Unsupported archive format. Please use .zip or .tar.gz');
      }

      const extractPath = path.join(this.resourcesPath, serviceName, version, platform);

      // Pre-delete directories known to contain .asar files using the OS shell
      // (rmdir /s /q on Windows) rather than Node's fs. Electron's ASAR fs patch
      // intercepts lstat/unlink on .asar paths and throws "Invalid package", which
      // would cause fs.remove(extractPath) to fail on re-imports over old extractions.
      const asarBundleDirs = ['pgAdmin 4', 'StackBuilder'];
      for (const dir of asarBundleDirs) {
        const dirPath = path.join(extractPath, dir);
        try {
          if (await fs.pathExists(dirPath)) {
            await new Promise((resolve) => {
              require('child_process').exec(
                process.platform === 'win32'
                  ? `rmdir /s /q "${dirPath}"`
                  : `rm -rf "${dirPath}"`,
                () => resolve(), // resolve regardless of error — best-effort
              );
            });
          }
        } catch {
          // Non-fatal: best-effort pre-cleanup.
        }
      }

      await fs.remove(extractPath);
      await fs.ensureDir(extractPath);


      this.emitProgress(id, { status: 'extracting', progress: 50 });

      await this.extractArchive(filePath, extractPath, id);
      await this.normalizeExtractedStructure(serviceName, extractPath);

      if (serviceName === 'php') {
        await this.createPhpIni(extractPath, version);
      }

      if (serviceName === 'apache') {
        await this.createApacheConfig(extractPath);
      }

      if (serviceName === 'nodejs') {
        const contents = await fs.readdir(extractPath);
        const extractedDir = contents.find((entry) => entry.startsWith('node-'));
        if (extractedDir) {
          const srcPath = path.join(extractPath, extractedDir);
          const files = await fs.readdir(srcPath);
          for (const file of files) {
            await fs.move(path.join(srcPath, file), path.join(extractPath, file), { overwrite: true });
          }
          await fs.remove(srcPath);
        }
        await this.setupNodejsEnvironment(version, extractPath);
      }

      this.emitProgress(id, { status: 'completed', progress: 100 });
      return { success: true, version, path: extractPath };
    } catch (error) {
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    } finally {
      process.noAsar = prevNoAsar;
    }
  },

  async normalizeExtractedStructure(serviceName, extractPath) {
    const contents = await fs.readdir(extractPath);

    if (contents.length === 1) {
      const singleItem = contents[0];
      const singlePath = path.join(extractPath, singleItem);
      const stat = await fs.stat(singlePath);

      if (stat.isDirectory()) {
        const innerContents = await fs.readdir(singlePath);
        for (const item of innerContents) {
          await fs.move(path.join(singlePath, item), path.join(extractPath, item), { overwrite: true });
        }
        await fs.remove(singlePath);
      }
    }

    const apache24Path = path.join(extractPath, 'Apache24');
    if (await fs.pathExists(apache24Path)) {
      const innerContents = await fs.readdir(apache24Path);
      for (const item of innerContents) {
        await fs.move(path.join(apache24Path, item), path.join(extractPath, item), { overwrite: true });
      }
      await fs.remove(apache24Path);
    }
  },
};