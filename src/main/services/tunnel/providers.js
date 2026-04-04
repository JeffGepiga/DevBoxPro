const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const { spawn } = require('child_process');

module.exports = {
  getPlatform() {
    if (process.platform === 'win32') {
      return 'win';
    }

    if (process.platform === 'darwin') {
      return 'mac';
    }

    return 'linux';
  },

  getProviderExeName(provider) {
    const isWindows = this.getPlatform() === 'win';

    if (provider === 'cloudflared') {
      return isWindows ? 'cloudflared.exe' : 'cloudflared';
    }

    if (provider === 'zrok') {
      return isWindows ? 'zrok.exe' : 'zrok';
    }

    throw new Error(`Unsupported tunnel provider: ${provider}`);
  },

  async findBinaryPathRecursive(dir, exeName, currentDepth = 0, maxDepth = 3) {
    if (!dir || currentDepth > maxDepth || !await fs.pathExists(dir)) {
      return null;
    }

    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && entry.name === exeName) {
        return path.join(dir, entry.name);
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const found = await this.findBinaryPathRecursive(path.join(dir, entry.name), exeName, currentDepth + 1, maxDepth);
      if (found) {
        return found;
      }
    }

    return null;
  },

  async getProviderBinaryPath(provider) {
    const platform = this.getPlatform();
    const resourcesPath = this.managers?.binaryDownload?.resourcesPath;

    if (!resourcesPath) {
      throw new Error('Binary manager resources path is not available');
    }

    const baseDir = path.join(resourcesPath, provider, platform);
    const exeName = this.getProviderExeName(provider);
    const directPath = path.join(baseDir, exeName);

    if (await fs.pathExists(directPath)) {
      return directPath;
    }

    return this.findBinaryPathRecursive(baseDir, exeName);
  },

  async ensureProviderInstalled(provider) {
    const binaryPath = await this.getProviderBinaryPath(provider);
    if (!binaryPath) {
      throw new Error(`${provider} is not installed. Install it from Binary Manager → Tools.`);
    }

    return binaryPath;
  },

  getProjectsSharingWebServerTarget(project) {
    const projectManager = this.managers?.project;
    const effectiveWebServer = projectManager?.getEffectiveWebServer?.(project) || project?.webServer || 'nginx';
    const effectiveVersion = projectManager?.getEffectiveWebServerVersion?.(project, effectiveWebServer)
      || project?.webServerVersion
      || null;
    const projects = this.configStore?.get('projects', []) || [];

    return projects.filter((entry) => {
      if (!entry?.id) {
        return false;
      }

      const entryWebServer = projectManager?.getEffectiveWebServer?.(entry) || entry?.webServer || 'nginx';
      const entryVersion = projectManager?.getEffectiveWebServerVersion?.(entry, entryWebServer)
        || entry?.webServerVersion
        || null;

      return entryWebServer === effectiveWebServer && entryVersion === effectiveVersion;
    });
  },

  buildTunnelTarget(project, provider = null) {
    const projectManager = this.managers?.project;
    const httpPort = projectManager?.getProjectLocalAccessPorts?.(project)?.httpPort || 80;
    const backendHttpPort = projectManager?.getProjectProxyBackendHttpPort?.(project) || httpPort;
    const primaryDomain = projectManager?.getProjectPrimaryDomain?.(project) || project?.domain;

    if (!primaryDomain) {
      throw new Error('Project domain is not configured');
    }

    const suffix = httpPort === 80 ? '' : `:${httpPort}`;
    const projectUrl = `http://${primaryDomain}${suffix}`;

    if (provider === 'cloudflared') {
      const sharedBackendProjects = this.getProjectsSharingWebServerTarget(project);
      const canUseDedicatedBackendPort = sharedBackendProjects.length <= 1;

      if (canUseDedicatedBackendPort) {
        return {
          targetUrl: `http://127.0.0.1:${backendHttpPort}`,
          displayUrl: projectUrl,
          hostHeader: primaryDomain,
        };
      }

      return {
        targetUrl: `http://127.0.0.1:${httpPort}`,
        displayUrl: projectUrl,
        hostHeader: primaryDomain,
      };
    }

    return {
      targetUrl: projectUrl,
      displayUrl: projectUrl,
      hostHeader: primaryDomain,
    };
  },

  getTunnelStartArgs(provider, tunnelTarget) {
    const target = typeof tunnelTarget === 'string'
      ? { targetUrl: tunnelTarget, hostHeader: null }
      : (tunnelTarget || {});

    if (provider === 'cloudflared') {
      return ['tunnel', '--url', target.targetUrl, '--no-autoupdate'];
    }

    if (provider === 'zrok') {
      return ['share', 'public', target.targetUrl, '--headless'];
    }

    throw new Error(`Unsupported tunnel provider: ${provider}`);
  },

  extractPublicUrl(provider, output) {
    const text = String(output || '');

    if (provider === 'cloudflared') {
      const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
      return match?.[0] || null;
    }

    if (provider === 'zrok') {
      const fullUrlMatch = text.match(/https?:\/\/[^\s"'<>]+/iu);
      if (fullUrlMatch?.[0]) {
        return fullUrlMatch[0];
      }

      const hostnameMatch = text.match(/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:shares\.)?zrok\.io)(?:[\/\?#][^\s"'<>]*)?/iu);
      if (hostnameMatch?.[0]) {
        return `https://${hostnameMatch[0]}`;
      }

      return null;
    }

    return null;
  },

  spawnTunnelProcess(binaryPath, args, project) {
    return spawn(binaryPath, args, {
      cwd: project?.path || process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
  },

  runOneShotCommand(binaryPath, args, options = {}) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';

      const proc = spawn(binaryPath, args, {
        cwd: options.cwd || process.cwd(),
        env: options.env || process.env,
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (chunk) => {
        stdout += chunk.toString();
      });

      proc.stderr?.on('data', (chunk) => {
        stderr += chunk.toString();
      });

      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        reject(new Error(stderr || stdout || `${path.basename(binaryPath)} exited with code ${code}`));
      });
    });
  },

  fetchLatestGithubRelease(repo) {
    return new Promise((resolve, reject) => {
      const request = https.get({
        hostname: 'api.github.com',
        path: `/repos/${repo}/releases/latest`,
        headers: {
          'User-Agent': 'DevBoxPro-App',
          Accept: 'application/vnd.github.v3+json',
        },
      }, (response) => {
        let raw = '';

        response.on('data', (chunk) => {
          raw += chunk.toString();
        });

        response.on('end', () => {
          if (response.statusCode !== 200) {
            reject(new Error(`GitHub API returned status ${response.statusCode}`));
            return;
          }

          try {
            resolve(JSON.parse(raw));
          } catch (error) {
            reject(new Error('Failed to parse GitHub release response'));
          }
        });
      });

      request.on('error', reject);
      request.setTimeout(15000, () => {
        request.destroy(new Error('GitHub release lookup timed out'));
      });
    });
  },

  async getZrokStatus() {
    const settings = this.configStore.get('settings', {}) || {};
    return {
      enabled: Boolean(settings.zrokEnabled),
      configuredAt: settings.zrokConfiguredAt || null,
    };
  },

  async enableZrok(token) {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
      throw new Error('Enter a zrok token to enable app-wide zrok access.');
    }

    const binaryPath = await this.ensureProviderInstalled('zrok');
    await this.runOneShotCommand(binaryPath, ['enable', normalizedToken]);

    this.configStore.set('settings.zrokEnabled', true);
    this.configStore.set('settings.zrokConfiguredAt', new Date().toISOString());

    return this.getZrokStatus();
  },
};