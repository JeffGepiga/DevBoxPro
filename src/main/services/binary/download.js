const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');
const { createWriteStream } = require('fs');

module.exports = {
  isVersionProbeEligibleError(error) {
    const message = error?.message || '';
    return /status 403|status 404|returned HTML|invalid|not found/i.test(message);
  },

  buildPatchFallbackCandidates(downloadInfo, maxOffset = 5) {
    if (!downloadInfo?.url || !downloadInfo?.filename) {
      return [];
    }

    const urlMatch = downloadInfo.url.match(/(\d+\.\d+\.\d+)/);
    const filenameMatch = downloadInfo.filename.match(/(\d+\.\d+\.\d+)/);
    const baseVersion = urlMatch?.[1] || filenameMatch?.[1];

    if (!baseVersion) {
      return [];
    }

    const [major, minor, patch] = baseVersion.split('.').map((value) => parseInt(value, 10));
    if ([major, minor, patch].some(Number.isNaN)) {
      return [];
    }

    const candidates = [];
    const seenVersions = new Set([baseVersion]);
    const patchOffsets = [
      ...Array.from({ length: maxOffset }, (_, index) => index + 1),
      ...Array.from({ length: maxOffset }, (_, index) => -(index + 1)),
    ];

    for (const offset of patchOffsets) {
      const nextPatch = patch + offset;
      if (nextPatch < 0) {
        continue;
      }

      const nextVersion = `${major}.${minor}.${nextPatch}`;
      if (seenVersions.has(nextVersion)) {
        continue;
      }

      seenVersions.add(nextVersion);
      candidates.push({
        ...downloadInfo,
        url: downloadInfo.url.replace(baseVersion, nextVersion),
        filename: downloadInfo.filename.replace(baseVersion, nextVersion),
        resolvedVersion: nextVersion,
      });
    }

    return candidates;
  },

  async downloadWithVersionProbe(serviceName, version, id, downloadInfo) {
    const platform = this.getPlatform();
    const attempts = [downloadInfo];
    let lastError = null;

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];
      const downloadPath = path.join(this.resourcesPath, 'downloads', attempt.filename);

      try {
        await this.downloadFile(attempt.url, downloadPath, id);

        if (index > 0) {
          this.managers?.log?.systemWarn(`Recovered ${serviceName} ${version} download using alternate patch asset`, {
            requestedUrl: downloadInfo.url,
            resolvedUrl: attempt.url,
          });

          if (this.downloads?.[serviceName]?.[version]?.[platform]) {
            this.downloads[serviceName][version][platform] = {
              ...this.downloads[serviceName][version][platform],
              url: attempt.url,
              filename: attempt.filename,
            };
          }
        }

        return { downloadPath, downloadInfo: attempt };
      } catch (error) {
        lastError = error;
        await fs.remove(downloadPath).catch(() => { });

        if (index === 0 && this.isVersionProbeEligibleError(error)) {
          attempts.push(...this.buildPatchFallbackCandidates(downloadInfo));
          continue;
        }
      }
    }

    throw lastError || new Error(`Failed to download ${serviceName} ${version}`);
  },

  async downloadFile(url, destPath, id, options = {}) {
    await fs.ensureDir(path.dirname(destPath));

    return new Promise((resolve, reject) => {
      const file = createWriteStream(destPath);
      const protocol = url.startsWith('https') ? https : http;
      const parsedUrl = new URL(url);

      // Guard flag to prevent error handlers from deleting a successfully downloaded file.
      // On small/fast downloads (e.g. composer.phar), the request can emit 'error' (socket
      // cleanup) AFTER file 'finish' already fired and resolved the promise.
      let settled = false;

      const downloadInfo = { request: null, file, reject, destPath };
      this.activeDownloads.set(id, downloadInfo);

      const requestOptions = {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'application/octet-stream, application/zip, */*',
          'Accept-Language': 'en-US,en;q=0.9',
          Host: parsedUrl.host,
        },
      };

      if (url.startsWith('https')) {
        requestOptions.agent = new https.Agent({
          rejectUnauthorized: !options.retryWithoutVerify,
        });
      }

      if (options.forceIPv4) {
        requestOptions.family = 4;
      }

      const request = protocol.get(url, requestOptions, (response) => {
        if (response.statusCode === 301 || response.statusCode === 302 || response.statusCode === 303 || response.statusCode === 307) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (error) { }
          settled = true;
          const redirectUrl = response.headers.location.startsWith('http')
            ? response.headers.location
            : new URL(response.headers.location, url).toString();
          return this.downloadFile(redirectUrl, destPath, id, options)
            .then(resolve)
            .catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (error) { }
          settled = true;
          reject(new Error(`Download failed with status ${response.statusCode}`));
          return;
        }

        const contentType = response.headers['content-type'] || '';
        if (contentType.includes('text/html') && !destPath.endsWith('.html')) {
          file.close();
          try { fs.unlinkSync(destPath); } catch (error) { }
          settled = true;
          reject(new Error('Server returned HTML instead of binary. Download may be blocked or URL may be invalid.'));
          return;
        }

        const totalSize = parseInt(response.headers['content-length'], 10) || 0;
        let downloadedSize = 0;

        response.on('data', (chunk) => {
          downloadedSize += chunk.length;
          const progress = totalSize > 0 ? Math.round((downloadedSize / totalSize) * 100) : 0;
          this.emitProgress(id, {
            status: 'downloading',
            progress,
            downloaded: downloadedSize,
            total: totalSize,
          });
        });

        response.pipe(file);

        file.on('finish', () => {
          settled = true;
          file.close();
          this.activeDownloads.delete(id);
          resolve(destPath);
        });
      });

      downloadInfo.request = request;

      request.on('error', (err) => {
        if (settled) return; // Download already completed or handled — don't delete the file
        settled = true;

        file.close();
        this.activeDownloads.delete(id);
        fs.unlink(destPath, () => { });

        if (this.cancelledDownloads.has(id)) {
          this.cancelledDownloads.delete(id);
          const cancelError = new Error('Download cancelled');
          cancelError.cancelled = true;
          reject(cancelError);
          return;
        }

        const isSSLError = err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'
          || err.code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
          || err.code === 'CERT_HAS_EXPIRED'
          || err.message.includes('certificate')
          || err.message.includes('SSL');

        if (!options.retryWithoutVerify && isSSLError) {
          settled = false; // Allow retry to settle
          this.managers?.log?.systemWarn(`SSL certificate error for ${id}, retrying without verification`, { error: err.message });
          this.downloadFile(url, destPath, id, { ...options, retryWithoutVerify: true })
            .then(resolve)
            .catch(reject);
          return;
        }

        const isNetworkError = err.code === 'ETIMEDOUT'
          || err.code === 'ESOCKETTIMEDOUT'
          || err.code === 'ENETUNREACH';

        if (!options.forceIPv4 && isNetworkError) {
          settled = false; // Allow retry to settle
          this.managers?.log?.systemWarn(`Network error (${err.code}) for ${id}, retrying with IPv4 forced`, { error: err.message });
          this.downloadFile(url, destPath, id, { ...options, forceIPv4: true })
            .then(resolve)
            .catch(reject);
          return;
        }

        let userMessage = err.message;
        if (err.code === 'ENOTFOUND') {
          userMessage = 'Cannot reach download server. Check your internet connection.';
        } else if (err.code === 'ECONNREFUSED') {
          userMessage = 'Connection refused. Server may be down or blocked by firewall.';
        } else if (err.code === 'ETIMEDOUT' || err.code === 'ESOCKETTIMEDOUT') {
          userMessage = 'Connection timed out. Check your internet or firewall settings.';
        } else if (err.code === 'ECONNRESET') {
          userMessage = 'Connection was reset. This may be caused by a firewall or proxy.';
        } else if (err.code === 'CERT_HAS_EXPIRED' || err.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
          userMessage = 'SSL certificate error. Check your system date/time or antivirus settings.';
        } else if (err.code === 'EACCES' || err.code === 'EPERM') {
          userMessage = 'Permission denied. Run as administrator or check antivirus.';
        }

        this.managers?.log?.systemError(`Download failed for ${id}`, {
          url,
          error: err.message,
          code: err.code,
        });

        const networkError = new Error(userMessage);
        networkError.code = err.code;
        networkError.originalError = err.message;
        reject(networkError);
      });

      file.on('error', (err) => {
        if (settled) return; // Download already completed or handled — don't delete the file
        settled = true;

        file.close();
        this.activeDownloads.delete(id);
        fs.unlink(destPath, () => { });
        if (this.cancelledDownloads.has(id)) {
          this.cancelledDownloads.delete(id);
          const cancelError = new Error('Download cancelled');
          cancelError.cancelled = true;
          reject(cancelError);
          return;
        }

        this.managers?.log?.systemError(`File write failed for ${id}`, {
          path: destPath,
          error: err.message,
          code: err.code,
        });
        reject(err);
      });
    });
  },

  cancelDownload(id) {
    let cancelled = false;

    const downloadInfo = this.activeDownloads.get(id);
    if (downloadInfo) {
      try {
        if (downloadInfo.request) {
          downloadInfo.request.destroy();
        }

        if (downloadInfo.file) {
          downloadInfo.file.close();
        }

        if (downloadInfo.destPath) {
          fs.unlink(downloadInfo.destPath, () => { });
        }
      } catch (error) {
        this.managers?.log?.systemError(`Error cancelling download for ${id}`, { error: error.message });
      }

      this.activeDownloads.delete(id);
      cancelled = true;
    }

    const workerInfo = this.activeWorkers.get(id);
    if (workerInfo) {
      try {
        if (workerInfo.worker) {
          workerInfo.worker.terminate();
        }

        if (workerInfo.destPath) {
          fs.remove(workerInfo.destPath, () => { });
        }
      } catch (error) {
        this.managers?.log?.systemError(`Error cancelling extraction for ${id}`, { error: error.message });
      }

      this.activeWorkers.delete(id);
      cancelled = true;
    }

    if (!cancelled) {
      return false;
    }

    this.cancelledDownloads.add(id);
    this.downloadProgress.delete(id);
    this.lastProgressEmit.delete(id);
    this.emitProgress(id, { status: 'cancelled', progress: 0 }, true);

    return true;
  },

  async checkCancelled(id, downloadPath = null) {
    if (this.cancelledDownloads.has(id)) {
      this.cancelledDownloads.delete(id);
      if (downloadPath) {
        await fs.remove(downloadPath).catch(() => { });
      }
      const error = new Error('Download cancelled');
      error.cancelled = true;
      throw error;
    }
  },
};