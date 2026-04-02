const path = require('path');
const fs = require('fs-extra');
const tar = require('tar');
const { Worker } = require('worker_threads');

module.exports = {
  async extractArchive(archivePath, destPath, id) {
    this.emitProgress(id, { status: 'extracting', progress: 0 });

    const ext = path.extname(archivePath).toLowerCase();
    const basename = path.basename(archivePath).toLowerCase();

    await fs.ensureDir(destPath);

    if (ext === '.zip') {
      const isValidZip = await this.validateZipFile(archivePath);
      if (!isValidZip) {
        const fileStart = await fs.readFile(archivePath, { encoding: 'utf8', flag: 'r' }).catch(() => '');
        const first500 = fileStart.slice(0, 500).toLowerCase();
        if (first500.includes('<!doctype') || first500.includes('<html')) {
          throw new Error('Downloaded file is HTML instead of ZIP. The download source may be blocking automated downloads or the URL is invalid.');
        }
        throw new Error('Invalid ZIP file. The download may have been corrupted or blocked.');
      }
      await this.extractZipAsync(archivePath, destPath, id);
    } else if (basename.endsWith('.tar.gz') || ext === '.tgz') {
      const strip = await this.getTarStripCount(archivePath);
      await tar.x({
        file: archivePath,
        cwd: destPath,
        strip,
      });
    }

    this.emitProgress(id, { status: 'extracting', progress: 100 });
  },

  async getTarStripCount(archivePath) {
    let firstSegment = null;
    let hasNestedEntries = false;
    let hasRootFiles = false;

    await tar.t({
      file: archivePath,
      onentry: (entry) => {
        if (!entry?.path || entry.type === 'Directory') {
          return;
        }

        const normalizedPath = String(entry.path).replace(/\\/g, '/').replace(/^\.\//, '');
        const segments = normalizedPath.split('/').filter(Boolean);

        if (segments.length <= 1) {
          hasRootFiles = true;
          return;
        }

        hasNestedEntries = true;
        if (firstSegment === null) {
          firstSegment = segments[0];
          return;
        }

        if (firstSegment !== segments[0]) {
          firstSegment = false;
        }
      },
    });

    if (hasRootFiles || !hasNestedEntries || !firstSegment) {
      return 0;
    }

    return 1;
  },

  async validateZipFile(filePath) {
    try {
      const buffer = Buffer.alloc(4);
      const fd = await fs.open(filePath, 'r');
      await new Promise((resolve, reject) => {
        require('fs').read(fd, buffer, 0, 4, 0, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      await fs.close(fd);
      return buffer[0] === 0x50 && buffer[1] === 0x4B;
    } catch (err) {
      this.managers?.log?.systemError('Error validating ZIP file', { error: err.message });
      return false;
    }
  },

  async extractZipAsync(archivePath, destPath, id) {
    return new Promise((resolve, reject) => {
      try {
        const workerPath = path.join(__dirname, '..', 'extractWorker.js');

        const worker = new Worker(workerPath, {
          workerData: { archivePath, destPath },
        });

        this.activeWorkers.set(id, { worker, reject, destPath });

        worker.on('message', (message) => {
          if (message.type === 'progress') {
            this.emitProgress(id, { status: 'extracting', progress: message.progress });
          } else if (message.type === 'done') {
            this.activeWorkers.delete(id);
            resolve();
          } else if (message.type === 'error') {
            this.activeWorkers.delete(id);
            reject(new Error(message.error));
          }
        });

        worker.on('error', (error) => {
          this.activeWorkers.delete(id);
          reject(error);
        });

        worker.on('exit', (code) => {
          this.activeWorkers.delete(id);
          if (code !== 0) {
            reject(new Error(`Worker stopped with exit code ${code}`));
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  },
};