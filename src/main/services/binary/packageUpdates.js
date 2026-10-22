const path = require('path');
const fs = require('fs-extra');
const { execFile } = require('child_process');
const { killProcessesByPath, killProcessesInDirectory } = require('../../utils/SpawnUtils');

function parseSemVer(versionStr) {
  if (!versionStr || typeof versionStr !== 'string') return null;
  const match = versionStr.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3] || '0', 10),
  };
}

function compareSemVer(v1, v2) {
  const p1 = parseSemVer(v1);
  const p2 = parseSemVer(v2);

  if (!p1 && !p2) return 0;
  if (!p1) return -1;
  if (!p2) return 1;

  if (p1.major !== p2.major) return p1.major - p2.major;
  if (p1.minor !== p2.minor) return p1.minor - p2.minor;
  return p1.patch - p2.patch;
}

const SUPPORTED_UPDATE_SERVICES = ['php', 'nodejs', 'python', 'mysql', 'mariadb'];

module.exports = {
  parseSemVer,
  compareSemVer,
  SUPPORTED_UPDATE_SERVICES,

  async getInstalledPackageVersion(service, version) {
    if (service === 'php') {
      return this.getInstalledPhpVersion(version);
    }

    const platform = this.getPlatform();
    let serviceDir = '';
    let exePath = '';

    if (service === 'nodejs') {
      serviceDir = path.join(this.resourcesPath, 'nodejs', version, platform);
      exePath = path.join(serviceDir, platform === 'win' ? 'node.exe' : 'bin/node');
    } else if (service === 'python') {
      serviceDir = path.join(this.resourcesPath, 'python', version, platform);
      exePath = path.join(serviceDir, platform === 'win' ? 'python.exe' : 'bin/python3');
    } else if (service === 'mysql') {
      serviceDir = path.join(this.resourcesPath, 'mysql', version, platform);
      exePath = path.join(serviceDir, 'bin', platform === 'win' ? 'mysqld.exe' : 'mysqld');
    } else if (service === 'mariadb') {
      serviceDir = path.join(this.resourcesPath, 'mariadb', version, platform);
      exePath = path.join(serviceDir, 'bin', platform === 'win' ? 'mariadbd.exe' : 'mariadbd');
      if (!await fs.pathExists(exePath) && platform === 'win') {
        exePath = path.join(serviceDir, 'bin', 'mysqld.exe');
      }
    } else {
      return null;
    }

    if (!await fs.pathExists(exePath)) {
      return null;
    }

    const versionInfoPath = path.join(serviceDir, '.version-info.json');
    if (await fs.pathExists(versionInfoPath)) {
      try {
        const info = await fs.readJson(versionInfoPath);
        if (info.version && typeof info.version === 'string') {
          return info.version;
        }
      } catch {
        // Fall back to CLI execution
      }
    }

    return new Promise((resolve) => {
      let args = ['--version'];
      if (service === 'nodejs') {
        args = ['-v'];
      } else if (service === 'python') {
        args = ['-V'];
      } else if (service === 'mysql' || service === 'mariadb') {
        args = ['--version'];
      }

      execFile(exePath, args, { timeout: 4000, windowsHide: true }, (error, stdout, stderr) => {
        const output = (stdout || stderr || '').trim();
        const parsed = parseSemVer(output);
        if (parsed) {
          resolve(`${parsed.major}.${parsed.minor}.${parsed.patch}`);
        } else {
          resolve(version);
        }
      });
    });
  },

  getConfiguredPackageVersion(service, version) {
    if (service === 'php') {
      return this.getConfiguredPhpVersion(version);
    }

    const platform = this.getPlatform();
    const downloadInfo = this.downloads[service]?.[version]?.[platform];
    if (!downloadInfo) return null;

    const source = downloadInfo.filename || downloadInfo.url || '';
    const parsed = parseSemVer(source);
    if (!parsed) return version;
    return `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  },

  async getPackageVersionDetails(service, version) {
    if (service === 'php') {
      return this.getPhpVersionDetails(version);
    }

    const platform = this.getPlatform();
    const isInstalled = await this.isPackageInstalled(service, version, platform);
    const configuredVersion = this.getConfiguredPackageVersion(service, version);

    if (!isInstalled) {
      return {
        service,
        version,
        installed: false,
        installedVersion: null,
        configuredVersion,
        hasUpdate: false,
        isCustom: false,
      };
    }

    const installedVersion = await this.getInstalledPackageVersion(service, version);
    const predefinedVersions = this.versionMeta[service] || [];
    const isCustom = !predefinedVersions.includes(version);

    let hasUpdate = false;
    if (configuredVersion && installedVersion) {
      hasUpdate = compareSemVer(configuredVersion, installedVersion) > 0;
    }

    return {
      service,
      version,
      installed: true,
      installedVersion: installedVersion || version,
      configuredVersion: configuredVersion || version,
      hasUpdate,
      isCustom,
    };
  },

  async isPackageInstalled(service, version, platform) {
    if (service === 'nodejs') {
      return this.isNodejsVersionInstalled(version, platform);
    }
    if (service === 'python') {
      const pyPath = path.join(this.resourcesPath, 'python', version, platform);
      const exe = platform === 'win' ? 'python.exe' : 'bin/python3';
      return fs.pathExists(path.join(pyPath, exe));
    }
    if (service === 'mysql') {
      const myPath = path.join(this.resourcesPath, 'mysql', version, platform, 'bin');
      const exe = platform === 'win' ? 'mysqld.exe' : 'mysqld';
      return fs.pathExists(path.join(myPath, exe));
    }
    if (service === 'mariadb') {
      const maPath = path.join(this.resourcesPath, 'mariadb', version, platform, 'bin');
      const exe = platform === 'win' ? 'mariadbd.exe' : 'mariadbd';
      const fallbackExe = platform === 'win' ? 'mysqld.exe' : 'mysqld';
      return (await fs.pathExists(path.join(maPath, exe))) || (await fs.pathExists(path.join(maPath, fallbackExe)));
    }
    return false;
  },

  async getAllPackageVersionDetails(service = null) {
    if (service === 'php') {
      return this.getAllPhpVersionDetails();
    }

    const servicesToQuery = service ? [service] : SUPPORTED_UPDATE_SERVICES;
    const results = {};

    for (const svc of servicesToQuery) {
      if (svc === 'php') {
        results.php = await this.getAllPhpVersionDetails();
        continue;
      }

      results[svc] = {};
      const versions = this.versionMeta[svc] || [];

      for (const version of versions) {
        try {
          const detail = await this.getPackageVersionDetails(svc, version);
          if (detail) {
            results[svc][version] = detail;
          }
        } catch {
          // Ignore individual version check errors
        }
      }
    }

    return service ? results[service] : results;
  },

  async checkPackageModifications(service, version) {
    if (service === 'php') {
      return this.checkPhpModifications(version);
    }

    const platform = this.getPlatform();
    const serviceDir = path.join(this.resourcesPath, service, version, platform);

    if (!await fs.pathExists(serviceDir)) {
      return {
        service,
        version,
        hasModifications: false,
        reasons: [],
        modifiedFiles: [],
        customPackages: [],
        customFiles: [],
      };
    }

    const reasons = [];
    const modifiedFiles = [];
    const customPackages = [];
    const customFiles = [];

    if (service === 'nodejs') {
      const nodeModulesPath = path.join(serviceDir, 'node_modules');
      if (await fs.pathExists(nodeModulesPath)) {
        try {
          const entries = await fs.readdir(nodeModulesPath);
          const userPkgs = entries.filter((e) => !e.startsWith('.') && e !== 'npm' && e !== 'corepack');
          if (userPkgs.length > 0) {
            reasons.push(`${userPkgs.length} global npm package(s) installed (e.g. ${userPkgs.slice(0, 3).join(', ')})`);
            customPackages.push(...userPkgs);
            modifiedFiles.push('node_modules');
          }
        } catch {}
      }

      const npmrcPaths = [path.join(serviceDir, '.npmrc'), path.join(serviceDir, 'etc', 'npmrc')];
      for (const p of npmrcPaths) {
        if (await fs.pathExists(p)) {
          const rel = path.relative(serviceDir, p);
          reasons.push(`Custom npm configuration found (${rel})`);
          customFiles.push(rel);
          modifiedFiles.push(rel);
        }
      }

      try {
        const rootEntries = await fs.readdir(serviceDir);
        for (const entry of rootEntries) {
          const lower = entry.toLowerCase();
          if (['pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'pm2', 'pm2.cmd'].includes(lower)) {
            customFiles.push(entry);
            modifiedFiles.push(entry);
          }
        }
      } catch {}
    } else if (service === 'python') {
      const sitePkgsDirs = [
        path.join(serviceDir, 'site-packages'),
        path.join(serviceDir, 'Lib', 'site-packages'),
      ];

      for (const siteDir of sitePkgsDirs) {
        if (await fs.pathExists(siteDir)) {
          try {
            const entries = await fs.readdir(siteDir);
            const userPkgs = entries.filter((e) => !e.startsWith('.') && !e.endsWith('.dist-info') && e !== 'pip' && e !== 'pkg_resources' && e !== 'setuptools');
            if (userPkgs.length > 0) {
              reasons.push(`${userPkgs.length} pip package(s) installed in site-packages (e.g. ${userPkgs.slice(0, 3).join(', ')})`);
              customPackages.push(...userPkgs);
              modifiedFiles.push(path.relative(serviceDir, siteDir));
              break;
            }
          } catch {}
        }
      }

      const scriptsDir = path.join(serviceDir, 'Scripts');
      if (await fs.pathExists(scriptsDir)) {
        try {
          const entries = await fs.readdir(scriptsDir);
          const scripts = entries.filter((e) => !e.startsWith('.') && !['pip.exe', 'pip3.exe'].includes(e.toLowerCase()));
          if (scripts.length > 0) {
            reasons.push(`${scripts.length} custom CLI tool(s) in Scripts/ (e.g. ${scripts.slice(0, 3).join(', ')})`);
            customFiles.push('Scripts');
            modifiedFiles.push('Scripts');
          }
        } catch {}
      }

      if (platform === 'win') {
        const majorMinor = version.replace(/\./g, '');
        const pthFile = path.join(serviceDir, `python${majorMinor}._pth`);
        if (await fs.pathExists(pthFile)) {
          try {
            const content = await fs.readFile(pthFile, 'utf8');
            if (content.includes('import site')) {
              customFiles.push(path.basename(pthFile));
            }
          } catch {}
        }
      }

      const pipIni = path.join(serviceDir, 'pip.ini');
      if (await fs.pathExists(pipIni)) {
        reasons.push('Custom pip.ini configuration detected');
        customFiles.push('pip.ini');
        modifiedFiles.push('pip.ini');
      }
    } else if (service === 'mysql' || service === 'mariadb') {
      const configPaths = [
        path.join(serviceDir, 'my.ini'),
        path.join(serviceDir, 'my.cnf'),
        path.join(serviceDir, 'bin', 'my.ini'),
      ];

      for (const p of configPaths) {
        if (await fs.pathExists(p)) {
          const rel = path.relative(serviceDir, p);
          reasons.push(`Custom configuration file detected (${rel})`);
          customFiles.push(rel);
          modifiedFiles.push(rel);
        }
      }

      const pluginDir = path.join(serviceDir, 'lib', 'plugin');
      if (await fs.pathExists(pluginDir)) {
        try {
          const plugins = await fs.readdir(pluginDir);
          const customPlugins = plugins.filter((f) => f.endsWith('.dll') || f.endsWith('.so'));
          if (customPlugins.length > 0) {
            // Count plugins
            customFiles.push(`lib/plugin (${customPlugins.length} plugins)`);
          }
        } catch {}
      }
    }

    return {
      service,
      version,
      hasModifications: reasons.length > 0,
      reasons,
      modifiedFiles: [...new Set(modifiedFiles)],
      customPackages: [...new Set(customPackages)],
      customFiles: [...new Set(customFiles)],
      dataSafeNotice: (service === 'mysql' || service === 'mariadb')
        ? 'Your database tables and data are safely stored in AppData/data and will remain completely untouched.'
        : null,
    };
  },

  async updatePackage(service, version, options = {}) {
    if (service === 'php') {
      return this.updatePhp(version, options);
    }

    const {
      preserveModifications = true,
      force = true,
    } = options;

    const platform = this.getPlatform();
    const downloadInfo = this.downloads[service]?.[version]?.[platform];

    if (!downloadInfo) {
      throw new Error(`Download definition for ${service} ${version} not found in binaries.json for platform ${platform}`);
    }

    const id = `${service}-${version}`;
    this.emitProgress(id, { status: 'starting', progress: 0, message: `Preparing to safely update ${service} ${version}...` });

    const targetPath = path.join(this.resourcesPath, service, version, platform);
    const stagingPath = path.join(this.resourcesPath, service, `${version}-update-staging`);
    const downloadPath = path.join(this.resourcesPath, 'downloads', downloadInfo.filename);
    const stoppedProjects = [];

    try {
      // Clean up any stale staging folder from an earlier interrupted attempt
      await fs.remove(stagingPath).catch(() => {});

      // 1. Process safety: check and stop running services or lock processes
      let wasRunning = false;
      if (service === 'mysql' || service === 'mariadb') {
        const status = this.managers?.service?.getServiceStatus?.(service);
        if (status?.status === 'running') {
          wasRunning = true;
          this.emitProgress(id, { status: 'stopping_service', progress: 5, message: `Stopping ${service} ${version} for safe binary replacement...` });
          await this.managers.service.stop(service, version).catch(() => {});
          await new Promise((r) => setTimeout(r, 1000));
        }
      } else if (service === 'nodejs') {
        if (this.managers?.project) {
          const allProjects = typeof this.managers.project.getAllProjects === 'function'
            ? this.managers.project.getAllProjects()
            : (Array.isArray(this.managers.project.projects)
                ? this.managers.project.projects
                : Object.values(this.managers.project.projects || {}));
          for (const project of allProjects) {
            if (project?.isRunning && (project.nodeVersion === version || project.runtimeVersion === version)) {
              try {
                await this.managers.project.stopProject(project.id);
                stoppedProjects.push(project.id);
              } catch {}
            }
          }
        }
      }

      await killProcessesInDirectory(targetPath);
      if (platform === 'win') {
        if (service === 'nodejs') await killProcessesByPath('node.exe', targetPath).catch(() => {});
        if (service === 'python') await killProcessesByPath('python.exe', targetPath).catch(() => {});
        if (service === 'mysql') await killProcessesByPath('mysqld.exe', targetPath).catch(() => {});
        if (service === 'mariadb') {
          await killProcessesByPath('mariadbd.exe', targetPath).catch(() => {});
          await killProcessesByPath('mysqld.exe', targetPath).catch(() => {});
        }
      }

      // 2. Scan modifications before downloading
      const modifications = await this.checkPackageModifications(service, version);

      // 3. Download the new archive
      this.emitProgress(id, { status: 'downloading', progress: 15, message: `Downloading ${downloadInfo.filename}...` });
      await fs.ensureDir(path.dirname(downloadPath));
      await this.downloadFile(downloadInfo.url, downloadPath, id);
      await this.checkCancelled(id, downloadPath);

      // 4. Extract into clean staging directory
      this.emitProgress(id, { status: 'extracting', progress: 60, message: 'Extracting package to staging...' });
      await fs.remove(stagingPath).catch(() => {});
      await fs.ensureDir(stagingPath);
      await this.extractArchive(downloadPath, stagingPath, id);

      // If staging folder has nested single root (e.g. node-v20... or mongodb...), flatten
      const contents = await fs.readdir(stagingPath);
      const prefix = service === 'nodejs' ? 'node-' : `${service}-`;
      const nestedDir = contents.find((entry) => entry.startsWith(prefix) || entry.startsWith(`${service}_`));
      if (nestedDir && (await fs.stat(path.join(stagingPath, nestedDir))).isDirectory()) {
        const srcPath = path.join(stagingPath, nestedDir);
        const innerFiles = await fs.readdir(srcPath);
        for (const file of innerFiles) {
          await fs.move(path.join(srcPath, file), path.join(stagingPath, file), { overwrite: true });
        }
        await fs.remove(srcPath);
      }

      // 5. Preserve modifications
      if (preserveModifications && (await fs.pathExists(targetPath))) {
        this.emitProgress(id, { status: 'preserving', progress: 85, message: 'Preserving custom configuration and files...' });

        if (service === 'nodejs') {
          // Preserve node_modules
          const oldModules = path.join(targetPath, 'node_modules');
          const newModules = path.join(stagingPath, 'node_modules');
          if (await fs.pathExists(oldModules)) {
            await fs.ensureDir(newModules);
            const pkgs = await fs.readdir(oldModules);
            for (const pkg of pkgs) {
              const srcPkg = path.join(oldModules, pkg);
              const destPkg = path.join(newModules, pkg);
              if (!await fs.pathExists(destPkg)) {
                await fs.copy(srcPkg, destPkg).catch(() => {});
              }
            }
          }

          // Preserve .npmrc
          for (const npmrcRel of ['.npmrc', path.join('etc', 'npmrc')]) {
            const oldNpmrc = path.join(targetPath, npmrcRel);
            const newNpmrc = path.join(stagingPath, npmrcRel);
            if (await fs.pathExists(oldNpmrc) && !await fs.pathExists(newNpmrc)) {
              await fs.ensureDir(path.dirname(newNpmrc));
              await fs.copy(oldNpmrc, newNpmrc).catch(() => {});
            }
          }

          // Preserve custom shims like pnpm.cmd / yarn.cmd
          for (const shim of ['pnpm', 'pnpm.cmd', 'yarn', 'yarn.cmd', 'pm2', 'pm2.cmd']) {
            const oldShim = path.join(targetPath, shim);
            const newShim = path.join(stagingPath, shim);
            if (await fs.pathExists(oldShim) && !await fs.pathExists(newShim)) {
              await fs.copy(oldShim, newShim).catch(() => {});
            }
          }
        } else if (service === 'python') {
          // Preserve site-packages
          const sitePaths = [
            { oldP: path.join(targetPath, 'site-packages'), newP: path.join(stagingPath, 'site-packages') },
            { oldP: path.join(targetPath, 'Lib', 'site-packages'), newP: path.join(stagingPath, 'Lib', 'site-packages') },
          ];

          for (const { oldP, newP } of sitePaths) {
            if (await fs.pathExists(oldP)) {
              await fs.ensureDir(newP);
              const entries = await fs.readdir(oldP);
              for (const entry of entries) {
                const src = path.join(oldP, entry);
                const dest = path.join(newP, entry);
                if (!await fs.pathExists(dest)) {
                  await fs.copy(src, dest).catch(() => {});
                }
              }
            }
          }

          // Preserve Scripts
          const oldScripts = path.join(targetPath, 'Scripts');
          const newScripts = path.join(stagingPath, 'Scripts');
          if (await fs.pathExists(oldScripts)) {
            await fs.ensureDir(newScripts);
            const scripts = await fs.readdir(oldScripts);
            for (const script of scripts) {
              const src = path.join(oldScripts, script);
              const dest = path.join(newScripts, script);
              if (!await fs.pathExists(dest)) {
                await fs.copy(src, dest).catch(() => {});
              }
            }
          }

          // Ensure import site is uncommented in python3xx._pth
          if (platform === 'win') {
            const majorMinor = version.replace(/\./g, '');
            const pthFile = path.join(stagingPath, `python${majorMinor}._pth`);
            if (await fs.pathExists(pthFile)) {
              let pthContent = await fs.readFile(pthFile, 'utf8');
              pthContent = pthContent.replace('#import site', 'import site');
              await fs.writeFile(pthFile, pthContent, 'utf8');
            }
          }

          // Preserve pip.ini
          const oldPipIni = path.join(targetPath, 'pip.ini');
          const newPipIni = path.join(stagingPath, 'pip.ini');
          if (await fs.pathExists(oldPipIni) && !await fs.pathExists(newPipIni)) {
            await fs.copy(oldPipIni, newPipIni).catch(() => {});
          }
        } else if (service === 'mysql' || service === 'mariadb') {
          // Preserve custom config
          for (const cfg of ['my.ini', 'my.cnf', path.join('bin', 'my.ini')]) {
            const oldCfg = path.join(targetPath, cfg);
            const newCfg = path.join(stagingPath, cfg);
            if (await fs.pathExists(oldCfg) && !await fs.pathExists(newCfg)) {
              await fs.copy(oldCfg, newCfg).catch(() => {});
            }
          }

          // Preserve custom plugins
          const oldPluginDir = path.join(targetPath, 'lib', 'plugin');
          const newPluginDir = path.join(stagingPath, 'lib', 'plugin');
          if ((await fs.pathExists(oldPluginDir)) && (await fs.pathExists(newPluginDir))) {
            const plugins = await fs.readdir(oldPluginDir);
            for (const plugin of plugins) {
              const src = path.join(oldPluginDir, plugin);
              const dest = path.join(newPluginDir, plugin);
              if (!await fs.pathExists(dest)) {
                await fs.copy(src, dest).catch(() => {});
              }
            }
          }
        }
      }

      // 6. Safe swap
      this.emitProgress(id, { status: 'applying', progress: 92, message: 'Replacing binaries...' });

      await killProcessesInDirectory(targetPath);
      if (platform === 'win') {
        if (service === 'nodejs') await killProcessesByPath('node.exe', targetPath).catch(() => {});
        if (service === 'python') await killProcessesByPath('python.exe', targetPath).catch(() => {});
        if (service === 'mysql') await killProcessesByPath('mysqld.exe', targetPath).catch(() => {});
        if (service === 'mariadb') {
          await killProcessesByPath('mariadbd.exe', targetPath).catch(() => {});
          await killProcessesByPath('mysqld.exe', targetPath).catch(() => {});
        }
      }

      // Retry removal on Windows in case of lingering locks
      let removed = false;
      for (let attempt = 1; attempt <= 5; attempt++) {
        try {
          await fs.remove(targetPath);
          removed = true;
          break;
        } catch (e) {
          if (attempt === 5) throw e;
          await killProcessesInDirectory(targetPath);
          await new Promise((r) => setTimeout(r, 600 * attempt));
        }
      }

      await fs.move(stagingPath, targetPath, { overwrite: true });

      // 7. Post-update actions
      if (service === 'nodejs') {
        await this.setupNodejsEnvironment?.(version, targetPath);
      } else if (service === 'python') {
        const pyExe = path.join(targetPath, platform === 'win' ? 'python.exe' : 'bin/python3');
        const pipInstalled = await fs.pathExists(path.join(targetPath, 'Scripts', 'pip.exe'))
          || await fs.pathExists(path.join(targetPath, 'site-packages', 'pip'))
          || await fs.pathExists(path.join(targetPath, 'Lib', 'site-packages', 'pip'));

        if (!pipInstalled && (await fs.pathExists(pyExe))) {
          await this.bootstrapPip?.(targetPath, platform, id).catch(() => {});
        }
      } else if ((service === 'mysql' || service === 'mariadb') && wasRunning) {
        this.emitProgress(id, { status: 'restarting_service', progress: 96, message: `Restarting ${service} ${version}...` });
        await this.managers?.service?.start?.(service, version).catch(() => {});
      }

      // Restart stopped projects
      for (const projId of stoppedProjects) {
        try {
          await this.managers?.project?.startProject?.(projId);
        } catch {}
      }

      // 8. Clean download archive
      await fs.remove(downloadPath).catch(() => {});

      // 9. Write .version-info.json
      const configuredVersion = this.getConfiguredPackageVersion(service, version);
      await fs.writeJson(path.join(targetPath, '.version-info.json'), {
        service,
        version: configuredVersion,
        baseVersion: version,
        filename: downloadInfo.filename,
        url: downloadInfo.url,
        updatedAt: new Date().toISOString(),
        preservedModifications: preserveModifications,
        preservedFiles: preserveModifications ? modifications.modifiedFiles : [],
      }, { spaces: 2 });

      this.emitProgress(id, { status: 'completed', progress: 100 });

      return {
        success: true,
        service,
        version,
        newVersion: configuredVersion,
        preservedModifications: preserveModifications,
        preservedFiles: preserveModifications ? modifications.modifiedFiles : [],
      };
    } catch (error) {
      await fs.remove(stagingPath).catch(() => {});

      for (const projId of stoppedProjects) {
        try {
          await this.managers?.project?.startProject?.(projId);
        } catch {}
      }

      if ((service === 'mysql' || service === 'mariadb') && wasRunning && (await fs.pathExists(targetPath))) {
        try {
          await this.managers?.service?.start?.(service, version);
        } catch {}
      }

      if (error.cancelled) {
        return { success: false, cancelled: true };
      }

      this.managers?.log?.systemError(`Failed to update ${service} ${version}`, { error: error.message });
      this.emitProgress(id, { status: 'error', error: error.message });
      throw error;
    }
  },
};
