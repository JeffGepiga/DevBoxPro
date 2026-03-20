const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  async initialize() {
    this.gitPath = await this.findGitExecutable();
    await fs.ensureDir(this.sshKeyPath);

    if (this.gitPath) {
      this.managers.log?.systemInfo('Git found', { path: this.gitPath });
    } else {
      this.managers.log?.systemWarn('Git not found - download from Binary Manager to enable repository cloning');
    }
  },

  async findGitExecutable() {
    const isWindows = process.platform === 'win32';
    const gitExe = isWindows ? 'git.exe' : 'git';

    const systemGit = await this.checkSystemGit();
    if (systemGit) {
      return systemGit;
    }

    const portableGitPath = path.join(this.resourcesPath, 'git', isWindows ? 'win' : 'mac');
    const portableGitExe = path.join(portableGitPath, 'cmd', gitExe);
    if (await fs.pathExists(portableGitExe)) {
      return portableGitExe;
    }

    const portableGitBin = path.join(portableGitPath, 'bin', gitExe);
    if (await fs.pathExists(portableGitBin)) {
      return portableGitBin;
    }

    return null;
  },

  async checkSystemGit() {
    return new Promise((resolve) => {
      const isWindows = process.platform === 'win32';
      const command = isWindows ? 'where' : 'which';

      const proc = spawn(command, ['git'], {
        shell: true,
        windowsHide: true,
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0 && output.trim()) {
          resolve(output.trim().split(/[\r\n]+/)[0]);
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  },

  async isGitAvailable() {
    if (!this.gitPath) {
      this.gitPath = await this.findGitExecutable();
    }

    if (!this.gitPath) {
      return { available: false, path: null, source: null };
    }

    const isPortable = this.gitPath.includes(this.resourcesPath);
    const version = await this.getGitVersion();

    return {
      available: true,
      path: this.gitPath,
      source: isPortable ? 'portable' : 'system',
      version,
    };
  },

  async getGitVersion() {
    if (!this.gitPath) {
      return null;
    }

    return new Promise((resolve) => {
      const proc = spawn(this.gitPath, ['--version'], {
        windowsHide: true,
      });

      let output = '';
      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const match = output.match(/git version ([\d.]+)/);
          resolve(match ? match[1] : output.trim());
        } else {
          resolve(null);
        }
      });

      proc.on('error', () => {
        resolve(null);
      });
    });
  },
};