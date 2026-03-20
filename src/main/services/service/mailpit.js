const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { isPortAvailable, findAvailablePort } = require('../../utils/PortUtils');

function spawnHidden(command, args, options = {}) {
  if (process.platform === 'win32') {
    return spawn(command, args, { ...options, windowsHide: true });
  } else {
    return spawn(command, args, { ...options, detached: true });
  }
}

module.exports = {
  // Mailpit
  async startMailpit() {
    const mailpitPath = this.getMailpitPath();
    const mailpitBin = path.join(mailpitPath, process.platform === 'win32' ? 'mailpit.exe' : 'mailpit');

    if (!await fs.pathExists(mailpitBin)) {
      this.managers.log?.systemError('Mailpit binary not found. Please download Mailpit from the Binary Manager.');
      const status = this.serviceStatus.get('mailpit');
      status.status = 'not_installed';
      status.error = 'Mailpit binary not found. Please download from Binary Manager.';
      return;
    }

    const defaultPort = this.serviceConfigs.mailpit.defaultPort;
    const defaultSmtpPort = this.serviceConfigs.mailpit.smtpPort;

    let port = defaultPort;
    let smtpPort = defaultSmtpPort;

    if (!await isPortAvailable(port)) {
      port = await findAvailablePort(defaultPort, 100);
      if (!port) {
        throw new Error(`Could not find available web port for Mailpit starting from ${defaultPort}`);
      }
    }

    if (!await isPortAvailable(smtpPort)) {
      smtpPort = await findAvailablePort(defaultSmtpPort, 100);
      if (!smtpPort) {
        throw new Error(`Could not find available SMTP port for Mailpit starting from ${defaultSmtpPort}`);
      }
    }

    this.serviceConfigs.mailpit.actualPort = port;
    this.serviceConfigs.mailpit.actualSmtpPort = smtpPort;

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(mailpitBin, ['--listen', `127.0.0.1:${port}`, '--smtp', `127.0.0.1:${smtpPort}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString(), 'error');
      });
    } else {
      proc = spawn(mailpitBin, ['--listen', `127.0.0.1:${port}`, '--smtp', `127.0.0.1:${smtpPort}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('mailpit', data.toString(), 'error');
      });
    }

    this.processes.set('mailpit', proc);
    const status = this.serviceStatus.get('mailpit');
    status.port = port;
    status.smtpPort = smtpPort;

    try {
      await this.waitForService('mailpit', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError('Mailpit failed to become ready', { error: error.message });
      status.status = 'error';
      status.error = `Mailpit failed to start properly: ${error.message}`;
      throw error;
    }
  },
};
