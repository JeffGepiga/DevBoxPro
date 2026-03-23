const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');
const { spawnSyncSafe } = require('../../utils/SpawnUtils');

// Helper function to spawn a process hidden on Windows
function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    const proc = spawn(command, args, {
      ...options,
      windowsHide: true,
    });
    return proc;
  } else {
    return spawn(command, args, {
      ...options,
      detached: true,
    });
  }
}

function hasStandardPortListenDirective(content = '') {
  return /^\s*listen\s+(?:[^;\s]+:)?(?:80|443)\b/m.test(content);
}

function hasStaleStandardPortListenDirective(content = '', httpPort = 80, sslPort = 443) {
  const stalePorts = [];

  if (httpPort !== 80) {
    stalePorts.push('80');
  }

  if (sslPort !== 443) {
    stalePorts.push('443');
  }

  if (stalePorts.length === 0) {
    return false;
  }

  return stalePorts.some((port) => {
    const regex = new RegExp(`^\\s*listen\\s+(?:[^;\\s]+:)?${port}\\b`, 'm');
    return regex.test(content);
  });
}

async function waitForPortsAvailable(httpPort, sslPort, timeoutMs = 8000) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const httpAvailable = await isPortAvailable(httpPort);
    const sslAvailable = await isPortAvailable(sslPort);
    if (httpAvailable && sslAvailable) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return await isPortAvailable(httpPort) && await isPortAvailable(sslPort);
}

module.exports = {
  hasStandardPortListenDirective,
  hasStaleStandardPortListenDirective,
  getNginxExecutablePath(version = '1.28') {
    const nginxPath = this.getNginxPath(version);
    if (process.platform === 'win32') {
      return path.join(nginxPath, 'nginx.exe');
    }

    const managedPath = path.join(nginxPath, 'nginx');
    const legacyPath = path.join(nginxPath, 'sbin', 'nginx');
    return fs.existsSync(managedPath) ? managedPath : legacyPath;
  },

  // Nginx
  async startNginx(version = '1.28') {
    const nginxPath = this.getNginxPath(version);
    const nginxExe = this.getNginxExecutablePath(version);

    // Check if Nginx binary exists
    if (!await fs.pathExists(nginxExe)) {
      this.managers.log?.systemError(`Nginx ${version} binary not found. Please download Nginx from the Binary Manager.`);
      const status = this.serviceStatus.get('nginx');
      status.status = 'not_installed';
      status.error = `Nginx ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = this.getDataPath();
    const versionDataPath = path.join(dataPath, 'nginx', version);
    const confPath = path.join(versionDataPath, 'nginx.conf');
    const logsPath = path.join(versionDataPath, 'logs');

    // Determine which ports to use based on first-come-first-served
    let httpPort, sslPort;

    const standardHttp = this.webServerPorts.standard.http;
    const standardHttps = this.webServerPorts.standard.https;

    let canUseStandard = false;

    if (this.standardPortOwner === null) {
      const otherWebServer = 'apache';
      const otherStatus = this.serviceStatus.get(otherWebServer);
      const otherIsRunning = otherStatus?.status === 'running';

      if (otherIsRunning) {
        canUseStandard = false;
      } else {
        canUseStandard = await isPortAvailable(standardHttp) && await isPortAvailable(standardHttps);
      }

      if (canUseStandard) {
        this.standardPortOwner = 'nginx';
        this.standardPortOwnerVersion = version;
      }
    } else if (this.standardPortOwner === 'nginx') {
      if (this.standardPortOwnerVersion === version) {
        canUseStandard = true;
      }
    }

    if (canUseStandard) {
      const standardPortsAvailable = await waitForPortsAvailable(standardHttp, standardHttps, 1500);
      if (!standardPortsAvailable) {
        if (this.standardPortOwner === 'nginx' && this.standardPortOwnerVersion === version) {
          this.standardPortOwner = null;
          this.standardPortOwnerVersion = null;
        }

        canUseStandard = false;
        this.managers.log?.systemWarn('Nginx could not reclaim the standard front-door ports during startup; falling back to alternate ports', {
          version,
          httpPort: standardHttp,
          sslPort: standardHttps,
        });
      }
    }

    if (canUseStandard) {
    } else {
      const versionOffset = this.versionPortOffsets.nginx?.[version] || 0;
      httpPort = this.serviceConfigs.nginx.alternatePort + versionOffset;
      sslPort = this.serviceConfigs.nginx.alternateSslPort + versionOffset;
    }

    if (!await isPortAvailable(httpPort)) {
      httpPort = await findAvailablePort(httpPort, 100);
      if (!httpPort) {
        throw new Error(`Could not find available HTTP port for Nginx`);
      }
    }

    if (!await isPortAvailable(sslPort)) {
      sslPort = await findAvailablePort(sslPort, 100);
      if (!sslPort) {
        throw new Error(`Could not find available HTTPS port for Nginx`);
      }
    }

    this.serviceConfigs.nginx.actualHttpPort = httpPort;
    this.serviceConfigs.nginx.actualSslPort = sslPort;

    await fs.ensureDir(versionDataPath);
    await fs.ensureDir(logsPath);
    await fs.ensureDir(path.join(versionDataPath, 'sites'));
    await fs.ensureDir(path.join(versionDataPath, 'conf.d'));

    await fs.ensureDir(path.join(nginxPath, 'temp', 'client_body_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'proxy_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'fastcgi_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'uwsgi_temp'));
    await fs.ensureDir(path.join(nginxPath, 'temp', 'scgi_temp'));

    if (process.platform === 'win32') {
      const hasRunningNginx = Array.from(this.processes.keys()).some(k => k.startsWith('nginx-'));
      if (!hasRunningNginx) {
        try {
          const { killProcessesByPath, isProcessRunning } = require('../../utils/SpawnUtils');
          if (isProcessRunning('nginx.exe')) {
            const nginxResourcesPath = path.join(this.resourcePath, 'nginx');
            this.managers.log?.systemInfo('Killing stale DevBox nginx processes before start');
            await killProcessesByPath('nginx.exe', nginxResourcesPath);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (e) {
          this.managers.log?.systemWarn('Could not kill stale nginx processes', { error: e.message });
        }
      }
    }

    // Always recreate config with current ports
    await this.createNginxConfig(confPath, logsPath, httpPort, sslPort, version);

    // Clear stale vhost files if using non-standard ports
    if (httpPort !== 80 || sslPort !== 443) {
      const sitesDir = path.join(versionDataPath, 'sites');
      try {
        if (await fs.pathExists(sitesDir)) {
          const files = await fs.readdir(sitesDir);
          for (const file of files) {
            if (file.endsWith('.conf')) {
              const content = await fs.readFile(path.join(sitesDir, file), 'utf8');
              if (hasStaleStandardPortListenDirective(content, httpPort, sslPort)) {
                this.managers.log?.systemInfo(`Removing stale vhost ${file} with port 80/443 (nginx using ${httpPort}/${sslPort})`);
                await fs.remove(path.join(sitesDir, file));
              }
            }
          }
        }
      } catch (e) {
        // Sites dir may not exist yet
      }
    }

    await this.regenerateWebServerVhosts('nginx', version);

    // Test Nginx configuration before starting
    const testConfig = async () => {
      try {
        const result = spawnSyncSafe(nginxExe, ['-t', '-c', confPath, '-p', nginxPath], {
          cwd: nginxPath,
          windowsHide: true,
          timeout: 10000,
          stdio: ['pipe', 'pipe', 'pipe']
        });

        if (result.status !== 0 || result.error) {
          throw {
            stderr: result.stderr || '',
            stdout: result.stdout || '',
            message: result.error?.message || `Process exited with status ${result.status}`,
          };
        }

        return { success: true };
      } catch (configError) {
        const stderr = configError.stderr || '';
        const stdout = configError.stdout || '';
        const message = configError.message || '';
        const errorMsg = `${stderr} ${stdout} ${message}`;
        const portBindError = errorMsg.includes('10013') || errorMsg.includes('10048') ||
          errorMsg.includes('bind()') || errorMsg.includes('Address already in use');
        return { success: false, error: errorMsg, isPortError: portBindError };
      }
    };

    let testResult = await testConfig();

    if (!testResult.success && testResult.isPortError) {
      const versionOffset = this.versionPortOffsets.nginx?.[version] || 0;
      const newHttpPort = this.webServerPorts.alternate.http + versionOffset;
      const newSslPort = this.webServerPorts.alternate.https + versionOffset;

      let altHttpPort = newHttpPort;
      let altSslPort = newSslPort;

      if (!await isPortAvailable(altHttpPort)) {
        altHttpPort = await findAvailablePort(altHttpPort, 100);
      }
      if (!await isPortAvailable(altSslPort)) {
        altSslPort = await findAvailablePort(altSslPort, 100);
      }

      if (altHttpPort && altSslPort) {
        httpPort = altHttpPort;
        sslPort = altSslPort;

        const sitesDir = path.join(versionDataPath, 'sites');
        try {
          const files = await fs.readdir(sitesDir);
          for (const file of files) {
            if (file.endsWith('.conf')) {
              await fs.remove(path.join(sitesDir, file));
            }
          }
        } catch (e) {
          // Sites dir may not exist yet
        }

        await this.createNginxConfig(confPath, logsPath, httpPort, sslPort, version);

        if (this.standardPortOwner === 'nginx' && this.standardPortOwnerVersion === version) {
          this.standardPortOwner = null;
          this.standardPortOwnerVersion = null;
        }

        this.serviceConfigs.nginx.actualHttpPort = httpPort;
        this.serviceConfigs.nginx.actualSslPort = sslPort;

        await this.regenerateWebServerVhosts('nginx', version);

        testResult = await testConfig();
      }
    }

    if (!testResult.success) {
      this.managers.log?.systemError('Nginx configuration test failed', { error: testResult.error });
      throw new Error(`Nginx configuration error: ${testResult.error}`);
    }

    const handleTrackedProcessExit = () => {
      void (async () => {
        const versionInfo = this.runningVersions.get('nginx')?.get(version);
        const expectedHttpPort = versionInfo?.port || httpPort;
        const versionStillServing = expectedHttpPort ? await this.checkPortOpen(expectedHttpPort) : false;
        if (versionStillServing) {
          this.processes.delete(this.getProcessKey('nginx', version));
          return;
        }

        this.processes.delete(this.getProcessKey('nginx', version));
        this.runningVersions.get('nginx')?.delete(version);

        if (this.standardPortOwner === 'nginx' && this.standardPortOwnerVersion === version) {
          this.standardPortOwner = null;
          this.standardPortOwnerVersion = null;
        }

        const status = this.serviceStatus.get('nginx');
        const remainingVersions = this.runningVersions.get('nginx');
        const firstRemaining = remainingVersions?.entries().next().value;

        if (firstRemaining) {
          status.status = 'running';
          status.version = firstRemaining[0];
          status.port = firstRemaining[1].port;
          status.sslPort = firstRemaining[1].sslPort;
          return;
        }

        if (status.version === version || status.status === 'running') {
          status.status = 'stopped';
          status.pid = null;
        }
      })();
    };

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(nginxExe, ['-c', confPath, '-p', nginxPath], {
        cwd: nginxPath,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('Nginx process error', { error: error.message });
        const status = this.serviceStatus.get('nginx');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', handleTrackedProcessExit);
    } else {
      proc = spawn(nginxExe, ['-c', confPath, '-p', nginxPath], {
        cwd: nginxPath,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('nginx', data.toString(), 'error');
      });

      proc.on('error', (error) => {
        this.managers.log?.systemError('Nginx process error', { error: error.message });
        const status = this.serviceStatus.get('nginx');
        status.status = 'error';
        status.error = error.message;
      });

      proc.on('exit', handleTrackedProcessExit);
    }

    this.processes.set(this.getProcessKey('nginx', version), proc);
    const status = this.serviceStatus.get('nginx');
    status.port = httpPort;
    status.sslPort = sslPort;
    status.version = version;

    this.runningVersions.get('nginx').set(version, { port: httpPort, sslPort, startedAt: new Date() });

    // Wait for this specific nginx version to be ready on its port
    try {
      const startWait = Date.now();
      let nginxReady = false;
      while (Date.now() - startWait < 15000) {
        if (await this.checkPortOpen(httpPort)) {
          nginxReady = true;
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!nginxReady) {
        throw new Error(`Nginx ${version} did not open port ${httpPort} within 15s`);
      }
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`Nginx ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = `Nginx ${version} failed to start properly: ${error.message}`;
      this.runningVersions.get('nginx').delete(version);
      if (this.standardPortOwner === 'nginx' && this.standardPortOwnerVersion === version) {
        this.standardPortOwner = null;
        this.standardPortOwnerVersion = null;
      }
      throw error;
    }
  },

  // Test Nginx configuration without starting/reloading
  async testNginxConfig(version = null) {
    if (!version) {
      const status = this.serviceStatus.get('nginx');
      version = status?.version || '1.28';
    }

    const nginxPath = this.getNginxPath(version);
    const nginxExe = this.getNginxExecutablePath(version);
    const dataPath = this.getDataPath();
    const confPath = path.join(dataPath, 'nginx', version, 'nginx.conf');

    if (!await fs.pathExists(nginxExe)) {
      return { success: false, error: 'Nginx binary not found' };
    }

    const { execSync } = require('child_process');
    try {
      execSync(`"${nginxExe}" -t -c "${confPath}" -p "${nginxPath}"`, {
        cwd: nginxPath,
        windowsHide: true,
        timeout: 10000,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe']
      });
      return { success: true };
    } catch (error) {
      const stderr = error.stderr || '';
      const stdout = error.stdout || '';
      const errorMsg = `${stderr} ${stdout} ${error.message || ''}`.trim();
      return { success: false, error: errorMsg };
    }
  },

  // Reload Nginx configuration without stopping
  async reloadNginx(version = null) {
    if (!version) {
      const status = this.serviceStatus.get('nginx');
      version = status?.version || '1.28';
    }

    const nginxPath = this.getNginxPath(version);
    const nginxExe = this.getNginxExecutablePath(version);
    const dataPath = this.getDataPath();
    const confPath = path.join(dataPath, 'nginx', version, 'nginx.conf');

    if (!await fs.pathExists(nginxExe)) {
      return;
    }

    const status = this.serviceStatus.get('nginx');
    const versionRunning = this.runningVersions.get('nginx')?.has(version);
    if (!versionRunning && (status?.status !== 'running' || status?.version !== version)) {
      return;
    }

    const testResult = await this.testNginxConfig(version);
    if (!testResult.success) {
      this.managers.log?.systemError('Nginx config test failed before reload', { error: testResult.error });
      throw new Error(`Nginx config invalid: ${testResult.error}`);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const proc = spawn(nginxExe, ['-s', 'reload', '-c', confPath, '-p', nginxPath], {
        windowsHide: true,
        cwd: nginxPath,
      });

      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          this.managers.log?.systemWarn('Nginx reload timed out after 10s, assuming success');
          try { proc.kill(); } catch (e) { /* ignore */ }
          resolve();
        }
      }, 10000);

      proc.on('close', (code) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;

        if (code === 0) {
          resolve();
        } else {
          this.managers.log?.systemError(`Nginx reload failed with code ${code}`);
          reject(new Error(`Nginx reload failed with code ${code}`));
        }
      });

      proc.on('error', (error) => {
        clearTimeout(timeout);
        if (settled) return;
        settled = true;
        this.managers.log?.systemError('Nginx reload error', { error: error.message });
        reject(error);
      });
    });
  },

  async createNginxConfig(confPath, logsPath, httpPort = 80, sslPort = 443, version = '1.28') {
    const dataPath = this.getDataPath();
    const nginxPath = this.getNginxPath(version);
    const mimeTypesPath = path.join(nginxPath, 'conf', 'mime.types').replace(/\\/g, '/');
    const fastcgiParamsPath = path.join(nginxPath, 'conf', 'fastcgi_params').replace(/\\/g, '/');

    const webServerDataPath = dataPath;
    const sitesPath = path.join(webServerDataPath, 'nginx', version, 'sites').replace(/\\/g, '/');
    const pidPath = path.join(webServerDataPath, 'nginx', version, 'nginx.pid').replace(/\\/g, '/');
    const normalizedLogsPath = logsPath.replace(/\\/g, '/');
    const normalizedDataPath = dataPath.replace(/\\/g, '/');

    await fs.ensureDir(path.join(webServerDataPath, 'nginx', version, 'sites'));
    await fs.ensureDir(path.join(webServerDataPath, 'nginx', version, 'logs'));

    const config = `worker_processes 1;
  pid "${pidPath}";
  error_log "${normalizedLogsPath}/error.log";

events {
    worker_connections 1024;
}

http {
    include       "${mimeTypesPath}";
    default_type  application/octet-stream;
    sendfile      on;
    keepalive_timeout 65;
    client_max_body_size 128M;
    server_names_hash_bucket_size 128;
    
    access_log "${normalizedLogsPath}/access.log";
    error_log "${normalizedLogsPath}/http_error.log";

    # FastCGI params
    include "${fastcgiParamsPath}";

    # Include virtual host configs from sites directory
    include "${sitesPath}/*.conf";

    # Fallback server for unmatched requests
    server {
        listen ${httpPort};
        server_name localhost;
      root "${normalizedDataPath}/www";
        index index.html index.php;
        
        location / {
            try_files $uri $uri/ =404;
        }
    }

    # Default SSL catch-all: reject SSL handshakes for unrecognized hostnames.
    server {
        listen ${sslPort} ssl default_server;
        ssl_reject_handshake on;
    }
}
`;
    await fs.writeFile(confPath, config);
  },

  async regenerateWebServerVhosts(serviceName, version = null) {
    const projectManager = this.managers.project;
    if (!projectManager) {
      return;
    }

    try {
      if (serviceName === 'nginx') {
        await projectManager.regenerateAllNginxVhosts(null, version);
      } else if (serviceName === 'apache') {
        await projectManager.regenerateAllApacheVhosts(null, version);
      }
    } catch (error) {
      this.managers.log?.systemWarn(`Could not regenerate ${serviceName} vhosts before start`, { error: error.message });
    }
  },
};
