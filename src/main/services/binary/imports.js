const path = require('path');
const fs = require('fs-extra');

module.exports = {
  async importBinary(serviceName, version, filePath) {
    const id = version && version !== 'default' ? `${serviceName}-${version}` : serviceName;
    const platform = this.getPlatform();

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