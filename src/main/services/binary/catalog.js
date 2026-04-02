const path = require('path');
const fs = require('fs-extra');

module.exports = {
  createBinaryFilesInUseError(type, version = null, originalError = null) {
    const label = `${type}${version ? ` ${version}` : ''}`;
    const lockedError = new Error(`${label} cannot be fully deleted because one or more files inside its binary folder are still in use. Stop the project or service using this binary, then try deleting it again.`);
    lockedError.code = 'BINARY_FILES_IN_USE';
    lockedError.originalError = originalError?.message || originalError || null;
    return lockedError;
  },

  async getRunningConflicts(type, version) {
    const items = [];
    const projectManager = this.managers?.project;
    const serviceManager = this.managers?.service;

    if ((type === 'php' || type === 'nodejs') && projectManager) {
      const projects = typeof projectManager.getAllProjects === 'function'
        ? projectManager.getAllProjects()
        : [];

      for (const project of projects) {
        if (!project?.id) {
          continue;
        }

        const matchesPhp = type === 'php' && project.phpVersion === version;
        const matchesNode = type === 'nodejs' && project.nodeVersion === version;

        if (matchesPhp || matchesNode) {
          const runtimeLabel = type === 'php' ? `PHP ${version}` : `Node.js ${version}`;
          items.push({
            kind: 'project',
            id: project.id,
            name: project.name,
            reason: project.isRunning ? `Running project uses ${runtimeLabel}` : `Project is configured to use ${runtimeLabel}`,
          });
        }
      }
    }

    if (['cloudflared', 'zrok'].includes(type)) {
      const activeTunnels = this.managers?.tunnel?.getAllTunnelStatuses?.() || {};
      for (const [projectId, tunnelState] of Object.entries(activeTunnels)) {
        if (tunnelState?.provider !== type) {
          continue;
        }

        const project = this.managers?.project?.getProject?.(projectId);
        items.push({
          kind: 'tunnel',
          id: projectId,
          name: project?.name || projectId,
          reason: 'Tunnel provider is currently active for this project',
        });
      }
    }

    const serviceTypes = ['mysql', 'mariadb', 'redis', 'postgresql', 'mongodb', 'memcached', 'nginx', 'apache', 'mailpit', 'minio'];
    if (serviceTypes.includes(type) && serviceManager) {
      const runningMap = serviceManager.runningVersions?.get(type);
      if (runningMap) {
        if (version) {
          if (runningMap.has(version)) {
            items.push({ kind: 'service', version, name: `${type} ${version}`, reason: 'Service is currently running' });
          }
        } else {
          for (const [runningVersion] of runningMap) {
            items.push({ kind: 'service', version: runningVersion || null, name: `${type}${runningVersion ? ` ${runningVersion}` : ''}`, reason: 'Service is currently running' });
          }
        }
      }
    }

    return { hasConflicts: items.length > 0, items };
  },

  async removeBinary(type, version = null, force = false) {
    const conflicts = await this.getRunningConflicts(type, version);

    if (conflicts.hasConflicts && !force) {
      const error = new Error(`${type}${version ? ` ${version}` : ''} is currently in use. Stop the project or service using it, then try deleting the binary again.`);
      error.code = 'BINARY_IN_USE';
      error.conflicts = conflicts.items;
      throw error;
    }

    if (force) {
      for (const item of conflicts.items) {
        try {
          if (item.kind === 'project') {
            await this.managers?.project?.stopProject(item.id);
          } else if (item.kind === 'service') {
            await this.managers?.service?.stopService(type, item.version ?? version ?? null);
          } else if (item.kind === 'tunnel') {
            await this.managers?.tunnel?.stopTunnel(item.id);
          }
        } catch (error) {
          this.managers?.log?.systemWarn(`Could not stop ${item.name} before removal`, { error: error.message });
        }
      }

      if (conflicts.hasConflicts) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }

    const platform = this.getPlatform();
    let targetPath;

    if (version) {
      if (['php', 'nodejs', 'mysql', 'mariadb', 'redis', 'nginx', 'apache'].includes(type)) {
        targetPath = path.join(this.resourcesPath, type, version, platform);
      } else {
        targetPath = path.join(this.resourcesPath, type, version);
      }
    } else if (type === 'phpmyadmin') {
      targetPath = path.join(this.resourcesPath, 'phpmyadmin');
    } else if (type === 'composer') {
      targetPath = path.join(this.resourcesPath, 'composer');
    } else if (type === 'mailpit') {
      targetPath = path.join(this.resourcesPath, 'mailpit', platform);
    } else {
      targetPath = path.join(this.resourcesPath, type, platform);
    }

    await this.assertBinaryFolderDeletable(targetPath, type, version);

    try {
      await fs.remove(targetPath);
    } catch (error) {
      if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
        throw this.createBinaryFilesInUseError(type, version, error);
      }

      throw error;
    }

    return { success: true };
  },

  async assertBinaryFolderDeletable(targetPath, type, version = null) {
    if (!await fs.pathExists(targetPath)) {
      return;
    }

    const tempPath = `${targetPath}.delete-check-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    let moved = false;

    try {
      await fs.move(targetPath, tempPath, { overwrite: false });
      moved = true;
      await fs.move(tempPath, targetPath, { overwrite: false });
    } catch (error) {
      if (moved) {
        await fs.move(tempPath, targetPath, { overwrite: false }).catch(() => { });
      }

      if (['EBUSY', 'EPERM', 'EACCES'].includes(error.code)) {
        throw this.createBinaryFilesInUseError(type, version, error);
      }

      throw error;
    }
  },

  getDownloadUrls() {
    const platform = this.getPlatform();
    const urls = {
      php: {},
      mysql: {},
      mariadb: {},
      redis: {},
      mailpit: this.downloads.mailpit[platform],
      cloudflared: this.downloads.cloudflared?.[platform],
      zrok: this.downloads.zrok?.[platform],
      phpmyadmin: this.downloads.phpmyadmin.all,
      nginx: {},
      apache: {},
      nodejs: {},
      composer: this.downloads.composer.all,
    };

    for (const version of Object.keys(this.downloads.php)) {
      urls.php[version] = {
        ...this.downloads.php[version][platform],
        label: this.downloads.php[version].label,
      };
    }

    for (const serviceName of ['mysql', 'mariadb', 'redis', 'nginx', 'apache', 'nodejs']) {
      urls[serviceName] = urls[serviceName] || {};
      for (const version of Object.keys(this.downloads[serviceName])) {
        urls[serviceName][version] = {
          ...this.downloads[serviceName][version][platform],
          label: this.downloads[serviceName][version].label,
          defaultPort: this.downloads[serviceName][version].defaultPort,
        };
      }
    }

    urls.python = {};
    for (const version of Object.keys(this.downloads.python || {})) {
      if (this.downloads.python[version][platform]) {
        urls.python[version] = {
          ...this.downloads.python[version][platform],
          label: this.downloads.python[version].label,
        };
      }
    }

    return urls;
  },

  getAvailableVersions(serviceName) {
    return this.versionMeta[serviceName] || [];
  },

  getVersionMeta() {
    const meta = {};
    for (const [service, versions] of Object.entries(this.versionMeta)) {
      meta[service] = versions.map((version) => {
        const info = this.downloads[service]?.[version];
        return {
          version,
          label: info?.label || null,
          defaultPort: info?.defaultPort || null,
        };
      });
    }
    return meta;
  },

  async checkForServiceUpdates() {
    const updates = {
      composer: { updateAvailable: false },
      phpmyadmin: { updateAvailable: false },
      cloudflared: { updateAvailable: false },
      zrok: { updateAvailable: false },
      lastChecked: new Date().toISOString(),
    };

    try {
      const platform = this.getPlatform();
      const serviceChecks = {
        composer: this.downloads.composer?.all,
        phpmyadmin: this.downloads.phpmyadmin?.all,
        cloudflared: this.downloads.cloudflared?.[platform],
        zrok: this.downloads.zrok?.[platform],
      };

      for (const [serviceName, configuredDownload] of Object.entries(serviceChecks)) {
        const localMeta = await this.getLocalServiceMetadata(serviceName);
        if (!localMeta || !configuredDownload) {
          continue;
        }

        const resolvedDownload = configuredDownload.githubRepo
          ? await this.resolveGithubReleaseAsset(
            configuredDownload.githubRepo,
            configuredDownload.assetPattern,
            configuredDownload.fallbackAssetPatterns || []
          ).catch(() => null)
          : configuredDownload;

        if (!resolvedDownload?.url) {
          continue;
        }

        const remoteMeta = await this.fetchRemoteMetadata(resolvedDownload.url).catch(() => null);
        const tagChanged = Boolean(resolvedDownload.tagName && resolvedDownload.tagName !== localMeta.tagName);
        const lastModifiedChanged = Boolean(remoteMeta?.lastModified && localMeta?.lastModified && remoteMeta.lastModified !== localMeta.lastModified);
        const etagChanged = Boolean(remoteMeta?.etag && localMeta?.etag && remoteMeta.etag !== localMeta.etag);

        updates[serviceName].updateAvailable = tagChanged || lastModifiedChanged || etagChanged;
      }
    } catch (error) {
      this.managers?.log?.systemWarn('Error during service update check', { error: error.message });
    }

    return updates;
  },
};