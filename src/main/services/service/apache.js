const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');

function hasStaleStandardPortBindings(content = '', httpPort = 80, httpsPort = 443) {
  const stalePorts = new Set();

  if (httpPort !== 80) {
    stalePorts.add('80');
  }

  if (httpsPort !== 443) {
    stalePorts.add('443');
  }

  if (stalePorts.size === 0) {
    return false;
  }

  for (const port of stalePorts) {
    const virtualHostRegex = new RegExp(`:${port}>`);
    const listenRegex = new RegExp(`^\\s*Listen\\s+(?:[^\\s]+:)?${port}(?:\\s|$)`, 'm');
    if (virtualHostRegex.test(content) || listenRegex.test(content)) {
      return true;
    }
  }

  return false;
}

module.exports = {
  hasStaleStandardPortBindings,
  // Apache
  async startApache(version = '2.4') {
    const apachePath = this.getApachePath(version);
    const httpdExe = path.join(apachePath, 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd');

    if (!await fs.pathExists(httpdExe)) {
      this.managers.log?.systemError(`Apache ${version} binary not found. Please download Apache from the Binary Manager.`);
      const status = this.serviceStatus.get('apache');
      status.status = 'not_installed';
      status.error = `Apache ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = this.getDataPath();
    const confPath = path.join(dataPath, 'apache', 'httpd.conf');
    const logsPath = path.join(dataPath, 'apache', 'logs');

    await fs.ensureDir(path.join(dataPath, 'apache'));
    await fs.ensureDir(logsPath);
    await fs.ensureDir(path.join(dataPath, 'apache', 'vhosts'));
    await fs.ensureDir(path.join(dataPath, 'www'));

    if (process.platform === 'win32') {
      const hasRunningApache = Array.from(this.processes.keys()).some(k => k.startsWith('apache-'));
      if (!hasRunningApache) {
        try {
          const { killProcessesByPath, isProcessRunning } = require('../../utils/SpawnUtils');
          if (isProcessRunning('httpd.exe')) {
            const apacheResourcesPath = path.join(this.resourcePath, 'apache');
            this.managers.log?.systemInfo('Killing stale DevBox Apache processes before start');
            await killProcessesByPath('httpd.exe', apacheResourcesPath);
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (e) {
          this.managers.log?.systemWarn('Could not kill stale Apache processes', { error: e.message });
        }
      }
    }

    let httpPort, httpsPort;

    const standardHttp = this.webServerPorts.standard.http;
    const standardHttps = this.webServerPorts.standard.https;

    let canUseStandard = false;

    if (this.standardPortOwner === null) {
      const otherWebServer = 'nginx';
      const otherStatus = this.serviceStatus.get(otherWebServer);
      const otherIsRunning = otherStatus?.status === 'running';

      if (otherIsRunning) {
        canUseStandard = false;
      } else {
        canUseStandard = await isPortAvailable(standardHttp) && await isPortAvailable(standardHttps);
      }

      if (canUseStandard) {
        this.standardPortOwner = 'apache';
        this.standardPortOwnerVersion = version;
      }
    } else if (this.standardPortOwner === 'apache') {
      canUseStandard = true;
    }

    if (canUseStandard) {
      httpPort = standardHttp;
      httpsPort = standardHttps;
    } else {
      httpPort = this.serviceConfigs.apache.alternatePort;
      httpsPort = this.serviceConfigs.apache.alternateSslPort;
    }

    if (!await isPortAvailable(httpPort)) {
      httpPort = await findAvailablePort(httpPort, 100);
      if (!httpPort) {
        throw new Error(`Could not find available HTTP port for Apache`);
      }
    }

    if (!await isPortAvailable(httpsPort)) {
      httpsPort = await findAvailablePort(httpsPort, 100);
      if (!httpsPort) {
        throw new Error(`Could not find available HTTPS port for Apache`);
      }
    }

    this.serviceConfigs.apache.actualHttpPort = httpPort;
    this.serviceConfigs.apache.actualSslPort = httpsPort;

    await this.createApacheConfig(apachePath, confPath, logsPath, httpPort, httpsPort);

    // Clear stale vhost files if using non-standard ports
    if (httpPort !== 80 || httpsPort !== 443) {
      const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
      try {
        if (await fs.pathExists(vhostsDir)) {
          const files = await fs.readdir(vhostsDir);
          for (const file of files) {
            if (file.endsWith('.conf')) {
              const content = await fs.readFile(path.join(vhostsDir, file), 'utf8');
              if (hasStaleStandardPortBindings(content, httpPort, httpsPort)) {
                this.managers.log?.systemInfo(`Removing stale Apache vhost ${file} with port 80/443 (using ${httpPort}/${httpsPort})`);
                await fs.remove(path.join(vhostsDir, file));
              }
            }
          }
        }
      } catch (e) {
        // Vhosts dir may not exist yet
      }
    }

    await this.regenerateWebServerVhosts('apache', version);

    const testConfig = async () => {
      const { execSync } = require('child_process');
      try {
        execSync(`"${httpdExe}" -t -f "${confPath}"`, {
          cwd: apachePath,
          windowsHide: true,
          timeout: 10000,
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe']
        });
        return { success: true };
      } catch (configError) {
        const stderr = configError.stderr || '';
        const stdout = configError.stdout || '';
        const message = configError.message || '';
        const errorMsg = `${stderr} ${stdout} ${message}`.trim();
        const portBindError = errorMsg.includes('10013') || errorMsg.includes('10048') ||
          errorMsg.includes('could not bind') || errorMsg.includes('Address already in use') ||
          errorMsg.includes('make_sock');
        return { success: false, error: errorMsg, isPortError: portBindError };
      }
    };

    let testResult = await testConfig();

    if (!testResult.success && testResult.isPortError) {
      const newHttpPort = this.webServerPorts.alternate.http;
      const newHttpsPort = this.webServerPorts.alternate.https;

      let altHttpPort = newHttpPort;
      let altHttpsPort = newHttpsPort;

      if (!await isPortAvailable(altHttpPort)) {
        altHttpPort = await findAvailablePort(altHttpPort, 100);
      }
      if (!await isPortAvailable(altHttpsPort)) {
        altHttpsPort = await findAvailablePort(altHttpsPort, 100);
      }

      if (altHttpPort && altHttpsPort) {
        httpPort = altHttpPort;
        httpsPort = altHttpsPort;

        const vhostsDir = path.join(dataPath, 'apache', 'vhosts');
        try {
          const files = await fs.readdir(vhostsDir);
          for (const file of files) {
            if (file.endsWith('.conf')) {
              await fs.remove(path.join(vhostsDir, file));
            }
          }
        } catch (e) {
          // Vhosts dir may not exist yet
        }

        await this.createApacheConfig(apachePath, confPath, logsPath, httpPort, httpsPort);

        if (this.standardPortOwner === 'apache') {
          this.standardPortOwner = null;
        }

        this.serviceConfigs.apache.actualHttpPort = httpPort;
        this.serviceConfigs.apache.actualSslPort = httpsPort;

        await this.regenerateWebServerVhosts('apache', version);

        testResult = await testConfig();
      }
    }

    if (!testResult.success) {
      this.managers.log?.systemError('Apache configuration test failed', { error: testResult.error });
      throw new Error(`Apache configuration error: ${testResult.error}`);
    }

    const proc = spawn(httpdExe, ['-f', confPath], {
      cwd: apachePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });

    proc.stdout.on('data', (data) => {
      this.managers.log?.service('apache', data.toString());
    });

    proc.stderr.on('data', (data) => {
      this.managers.log?.service('apache', data.toString(), 'error');
    });

    proc.on('error', (error) => {
      this.managers.log?.systemError('Apache process error', { error: error.message });
      const status = this.serviceStatus.get('apache');
      status.status = 'error';
      status.error = error.message;
    });

    const processKey = this.getProcessKey('apache', version);
    proc.on('exit', (code) => {
      const status = this.serviceStatus.get('apache');

      if (process.platform === 'win32' && code === 0 && status.status === 'running') {
        this.processes.delete(processKey);
        status.pid = null;
        return;
      }

      if (status.status === 'running') {
        status.status = 'stopped';
        this.runningVersions.get('apache')?.delete(version);
      }
    });

    this.processes.set(processKey, proc);
    const status = this.serviceStatus.get('apache');
    status.pid = proc.pid;
    status.port = httpPort;
    status.sslPort = httpsPort;
    status.version = version;

    this.runningVersions.get('apache').set(version, { port: httpPort, sslPort: httpsPort, startedAt: new Date() });

    try {
      await this.waitForService('apache', 30000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`Apache ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = `Apache ${version} failed to start properly: ${error.message}`;
      this.runningVersions.get('apache').delete(version);
      if (this.standardPortOwner === 'apache' && this.standardPortOwnerVersion === version) {
        this.standardPortOwner = null;
        this.standardPortOwnerVersion = null;
      }

      try {
        if (process.platform === 'win32') {
          const { killProcessByPid, killProcessesByPath } = require('../../utils/SpawnUtils');
          if (proc?.pid) {
            await killProcessByPid(proc.pid, true);
          } else {
            await killProcessesByPath('httpd.exe', apachePath);
          }
        }
        if (proc && !proc.killed) {
          proc.kill();
        }
      } catch (cleanupError) {
        // Ignore
      }

      throw error;
    }
  },

  async reloadApache(version = null) {
    if (!version) {
      const status = this.serviceStatus.get('apache');
      version = status?.version || '2.4';
    }

    const apachePath = this.getApachePath(version);
    const httpdExe = path.join(apachePath, 'bin', process.platform === 'win32' ? 'httpd.exe' : 'httpd');
    const dataPath = this.getDataPath();
    const confPath = path.join(dataPath, 'apache', 'httpd.conf');

    if (!await fs.pathExists(httpdExe)) {
      return;
    }

    const status = this.serviceStatus.get('apache');
    if (status?.status !== 'running') {
      return;
    }

    if (process.platform === 'win32') {
      try {
        const processKey = this.getProcessKey('apache', version);
        const trackedProcess = this.processes.get(processKey);

        if (trackedProcess) {
          await this.killProcess(trackedProcess);
          this.processes.delete(processKey);
        }

        await new Promise(resolve => setTimeout(resolve, 1500));

        const versionInfo = this.runningVersions.get('apache')?.get(version);
        let expectedHttpPort = versionInfo?.port || this.serviceConfigs.apache.actualHttpPort;
        let expectedSslPort = versionInfo?.sslPort || this.serviceConfigs.apache.actualSslPort;

        if (!expectedHttpPort || !await isPortAvailable(expectedHttpPort) ||
            !expectedSslPort || !await isPortAvailable(expectedSslPort)) {
          this.managers.log?.systemInfo(`Apache reload: ports ${expectedHttpPort}/${expectedSslPort} no longer available, doing full restart`);
          this.runningVersions.get('apache')?.delete(version);
          await this.startService('apache', version);
          return;
        }

        const dataPathReload = this.getDataPath();
        const logsPath = path.join(dataPathReload, 'apache', 'logs');
        await this.createApacheConfig(apachePath, confPath, logsPath, expectedHttpPort, expectedSslPort);

        const proc = spawn(httpdExe, ['-f', confPath], {
          cwd: apachePath,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          windowsHide: true,
        });

        proc.stdout.on('data', (data) => {
          this.managers.log?.service('apache', data.toString());
        });
        proc.stderr.on('data', (data) => {
          this.managers.log?.service('apache', data.toString(), 'error');
        });
        proc.on('error', (error) => {
          this.managers.log?.systemError('Apache process error during reload', { error: error.message });
          const s = this.serviceStatus.get('apache');
          s.status = 'error';
          s.error = error.message;
        });
        proc.on('exit', (code) => {
          const s = this.serviceStatus.get('apache');
          const benignWindowsDetach = process.platform === 'win32' && code === 0 && s.status === 'running';
          if (benignWindowsDetach) {
            this.processes.delete(processKey);
            s.pid = null;
            return;
          }

          if (s.status === 'running') {
            s.status = 'stopped';
            this.runningVersions.get('apache')?.delete(version);
          }
        });

        this.processes.set(processKey, proc);
        status.pid = proc.pid;

        const startWait = Date.now();
        let ready = false;
        while (Date.now() - startWait < 15000) {
          if (await this.checkPortOpen(expectedHttpPort)) {
            ready = true;
            break;
          }
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (ready) {
          status.status = 'running';
          status.startedAt = Date.now();
          this.runningVersions.get('apache').set(version, { port: expectedHttpPort, sslPort: expectedSslPort, startedAt: new Date() });
        } else {
          this.managers.log?.systemWarn(`Apache did not become ready on port ${expectedHttpPort} after reload`);
        }
      } catch (error) {
        this.managers.log?.systemError('Apache reload failed', { error: error.message });
        throw error;
      }
    } else {
      return new Promise((resolve, reject) => {
        const proc = spawn(httpdExe, ['-k', 'graceful', '-f', confPath], {
          cwd: apachePath,
        });

        proc.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            this.managers.log?.systemError(`Apache reload failed with code ${code}`);
            reject(new Error(`Apache reload failed with code ${code}`));
          }
        });

        proc.on('error', (error) => {
          this.managers.log?.systemError('Apache reload error', { error: error.message });
          reject(error);
        });
      });
    }
  },

  async createApacheConfig(apachePath, confPath, logsPath, httpPort = 8081, httpsPort = 8444, additionalListenPorts = []) {
    const dataPath = this.getDataPath();
    const mimeTypesPath = path.join(apachePath, 'conf', 'mime.types').replace(/\\/g, '/');

    const caPath = path.join(dataPath, 'ssl', 'ca');
    const caCertFile = path.join(caPath, 'rootCA.pem').replace(/\\/g, '/');
    const caKeyFile = path.join(caPath, 'rootCA-key.pem').replace(/\\/g, '/');
    const caExists = await fs.pathExists(caCertFile);
    const sslCatchAll = caExists ? `
# Default SSL catch-all (must be first, before project vhosts)
<VirtualHost *:${httpsPort}>
    ServerName _devbox_catchall_
    SSLEngine on
    SSLCertificateFile "${caCertFile}"
    SSLCertificateKeyFile "${caKeyFile}"
    <Location />
        Require all denied
    </Location>
</VirtualHost>
` : '';

    const networkPort80OwnerId = this.managers.project?.networkPort80Owner;

    const listenSet = new Set([`Listen 0.0.0.0:${httpPort}`, `Listen 0.0.0.0:${httpsPort}`]);

    const allProjects = this.configStore?.get('projects', []) || [];
    const runningApacheProjects = this.managers.project?.runningProjects;
    const networkApacheProjects = allProjects.filter((project) => {
      if (!project.networkAccess || project.webServer !== 'apache') {
        return false;
      }
      return runningApacheProjects?.has(project.id);
    });

    networkApacheProjects.forEach(p => {
      if (p.id === networkPort80OwnerId) {
        // Already covered by Listen 80
      } else {
        if (p.port && p.port !== 80) {
          listenSet.add(`Listen 0.0.0.0:${p.port}`);
        }
      }
    });

    additionalListenPorts
      .filter((port) => Number.isInteger(port) && port > 0 && port !== 80 && port !== httpPort)
      .forEach((port) => {
        listenSet.add(`Listen 0.0.0.0:${port}`);
      });

    const listenDirectives = Array.from(listenSet).join('\n');

    const config = `ServerRoot "${apachePath.replace(/\\/g, '/')}"
${listenDirectives}

# Core modules
LoadModule authz_core_module modules/mod_authz_core.so
LoadModule authz_host_module modules/mod_authz_host.so
LoadModule dir_module modules/mod_dir.so
LoadModule mime_module modules/mod_mime.so
LoadModule log_config_module modules/mod_log_config.so
LoadModule rewrite_module modules/mod_rewrite.so
LoadModule alias_module modules/mod_alias.so
LoadModule env_module modules/mod_env.so
LoadModule setenvif_module modules/mod_setenvif.so
LoadModule headers_module modules/mod_headers.so

# CGI modules for PHP
LoadModule cgi_module modules/mod_cgi.so
LoadModule actions_module modules/mod_actions.so

# Proxy modules for PHP-FPM
LoadModule proxy_module modules/mod_proxy.so
LoadModule proxy_http_module modules/mod_proxy_http.so
LoadModule proxy_fcgi_module modules/mod_proxy_fcgi.so

# SSL modules
LoadModule ssl_module modules/mod_ssl.so
LoadModule socache_shmcb_module modules/mod_socache_shmcb.so

TypesConfig "${mimeTypesPath}"

ServerName localhost:${httpPort}
DocumentRoot "${dataPath.replace(/\\/g, '/')}/www"

<Directory "${dataPath.replace(/\\/g, '/')}/www">
    Options Indexes FollowSymLinks
    AllowOverride All
    Require all granted
</Directory>

ErrorLog "${logsPath.replace(/\\/g, '/')}/error.log"
CustomLog "${logsPath.replace(/\\/g, '/')}/access.log" combined
${sslCatchAll}
IncludeOptional "${dataPath.replace(/\\/g, '/')}/apache/vhosts/*.conf"
`;
    await fs.writeFile(confPath, config);
  },
};
