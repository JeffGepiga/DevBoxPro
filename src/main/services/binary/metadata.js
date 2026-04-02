const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');

module.exports = {
  getServiceMetadataPath(serviceName) {
    if (serviceName === 'composer') {
      return path.join(this.resourcesPath, 'composer');
    }

    if (serviceName === 'phpmyadmin') {
      return path.join(this.resourcesPath, 'phpmyadmin');
    }

    if (['cloudflared', 'zrok'].includes(serviceName)) {
      return path.join(this.resourcesPath, serviceName, this.getPlatform());
    }

    return null;
  },

  async saveServiceMetadata(serviceName, data) {
    try {
      const targetPath = this.getServiceMetadataPath(serviceName);
      if (!targetPath) {
        return;
      }

      await fs.ensureDir(targetPath);
      await fs.writeFile(
        path.join(targetPath, '.version-info.json'),
        JSON.stringify({ ...data, downloadedAt: new Date().toISOString() }, null, 2)
      );
    } catch (err) {
      this.managers?.log?.systemWarn(`Failed to save metadata for ${serviceName}`, { error: err.message });
    }
  },

  async getLocalServiceMetadata(serviceName) {
    try {
      const targetPath = this.getServiceMetadataPath(serviceName);
      if (!targetPath) {
        return null;
      }

      const infoPath = path.join(targetPath, '.version-info.json');
      if (await fs.pathExists(infoPath)) {
        const content = await fs.readFile(infoPath, 'utf8');
        return JSON.parse(content);
      }
    } catch (err) {
    }
    return null;
  },

  fetchRemoteMetadata(urlStr) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(urlStr);
      const protocol = urlStr.startsWith('https') ? https : http;

      const options = {
        method: 'HEAD',
        family: 4,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) DevBoxPro/1.0',
        },
      };

      const req = protocol.request(parsedUrl, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, urlStr).toString();

          this.fetchRemoteMetadata(redirectUrl).then(resolve).catch(reject);
        } else {
          resolve({
            lastModified: res.headers['last-modified'] || res.headers.date,
            etag: res.headers.etag,
          });
        }
      });

      req.on('error', reject);
      req.end();
    });
  },
};