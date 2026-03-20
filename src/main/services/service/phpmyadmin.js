const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { SERVICE_VERSIONS } = require('../../../shared/serviceConfig');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');

function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    return spawn(command, args, { ...options, windowsHide: true });
  } else {
    return spawn(command, args, { ...options, detached: true });
  }
}

module.exports = {
  // phpMyAdmin (using built-in PHP server)
  async startPhpMyAdmin() {
    const phpManager = this.managers.php;
    const defaultPhp = phpManager.getDefaultVersion();

    const availableVersions = phpManager.getAvailableVersions().filter(v => v.available);
    if (availableVersions.length === 0) {
      this.managers.log?.systemError('No PHP version available. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'No PHP version available. Please download from Binary Manager.';
      return;
    }

    let phpPath;
    try {
      phpPath = phpManager.getPhpBinaryPath(defaultPhp);
    } catch (error) {
      this.managers.log?.systemError('PHP binary not found. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'PHP binary not found. Please download from Binary Manager.';
      return;
    }

    if (!await fs.pathExists(phpPath)) {
      this.managers.log?.systemError('PHP binary not found. Please download PHP from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'PHP binary not found. Please download from Binary Manager.';
      return;
    }

    // Ensure mysqli extension is enabled for phpMyAdmin
    try {
      const extensions = phpManager.getExtensions(defaultPhp);
      const mysqliExt = extensions.find(ext => ext.name === 'mysqli');
      if (mysqliExt && !mysqliExt.enabled) {
        await phpManager.toggleExtension(defaultPhp, 'mysqli', true);
      }
    } catch (error) {
      // Ignore - extension may not be available
    }

    const phpmyadminPath = path.join(this.resourcePath, 'phpmyadmin');

    if (!await fs.pathExists(phpmyadminPath)) {
      this.managers.log?.systemError('phpMyAdmin not found. Please download phpMyAdmin from the Binary Manager.');
      const status = this.serviceStatus.get('phpmyadmin');
      status.status = 'not_installed';
      status.error = 'phpMyAdmin not found. Please download from Binary Manager.';
      return;
    }

    const defaultPort = this.serviceConfigs.phpmyadmin.defaultPort;
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available port for phpMyAdmin starting from ${defaultPort}`);
      }
    }

    this.serviceConfigs.phpmyadmin.actualPort = port;

    try {
      await this.updatePhpMyAdminConfig(phpmyadminPath);
    } catch (error) {
      this.managers.log?.systemError('Failed to update phpMyAdmin config', { error: error.message });
    }

    const phpDir = path.dirname(phpPath);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(phpPath, ['-S', `127.0.0.1:${port}`, '-t', phpmyadminPath, '-c', phpDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString(), 'error');
      });
    } else {
      proc = spawn(phpPath, ['-S', `127.0.0.1:${port}`, '-t', phpmyadminPath, '-c', phpDir], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('phpmyadmin', data.toString(), 'error');
      });
    }

    this.processes.set('phpmyadmin', proc);
    const status = this.serviceStatus.get('phpmyadmin');
    status.port = port;

    try {
      await this.waitForService('phpmyadmin', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError('phpMyAdmin failed to become ready', { error: error.message });
      status.status = 'error';
      status.error = `phpMyAdmin failed to start properly: ${error.message}`;
      throw error;
    }
  },

  async updatePhpMyAdminConfig(pmaPath) {
    const servers = [];
    let serverIndex = 1;

    let installedBinaries = { mysql: {}, mariadb: {} };
    if (this.managers.binaryDownload) {
      try {
        installedBinaries = await this.managers.binaryDownload.getInstalledBinaries();
      } catch (err) {
        this.managers.log?.systemWarn('Could not get installed binaries, showing all versions', { error: err.message });
      }
    }

    const addServer = (name, port, verboseName) => {
      servers.push(`
$cfg['Servers'][${serverIndex}]['verbose'] = '${verboseName}';
$cfg['Servers'][${serverIndex}]['host'] = '127.0.0.1';
$cfg['Servers'][${serverIndex}]['port'] = '${port}';
$cfg['Servers'][${serverIndex}]['auth_type'] = 'cookie';
$cfg['Servers'][${serverIndex}]['user'] = 'root';
$cfg['Servers'][${serverIndex}]['password'] = '';
$cfg['Servers'][${serverIndex}]['AllowNoPassword'] = true;
`);
      serverIndex++;
    };

    const mysqlVersions = (SERVICE_VERSIONS.mysql || [])
      .filter(v => installedBinaries.mysql?.[v] === true)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of mysqlVersions) {
      const port = this.getVersionPort('mysql', version, this.serviceConfigs.mysql.defaultPort);
      addServer('mysql', port, `MySQL ${version}`);
    }

    const mariadbVersions = (SERVICE_VERSIONS.mariadb || [])
      .filter(v => installedBinaries.mariadb?.[v] === true)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of mariadbVersions) {
      const port = this.getVersionPort('mariadb', version, this.serviceConfigs.mariadb.defaultPort);
      addServer('mariadb', port, `MariaDB ${version}`);
    }

    if (servers.length === 0) {
      addServer('mysql', 3306, 'MySQL');
    }

    const generateSecret = (length) => {
      const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    const configContent = `<?php
/**
 * phpMyAdmin configuration for DevBox Pro
 * AUTO-GENERATED - DO NOT EDIT MANUALLY
 */

$cfg['blowfish_secret'] = '${generateSecret(32)}';
$cfg['UploadDir'] = '';
$cfg['SaveDir'] = '';
$cfg['DefaultLang'] = 'en';
$cfg['ServerDefault'] = 1; // Default to first server

// Server Configurations
${servers.join('')}
`;

    await fs.writeFile(path.join(pmaPath, 'config.inc.php'), configContent);
  },
};
