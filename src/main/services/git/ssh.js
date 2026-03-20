const path = require('path');
const fs = require('fs-extra');
const childProcess = require('child_process');

module.exports = {
  async generateSshKey() {
    const { commandExists } = require('../../utils/SpawnUtils');

    const keyPath = path.join(this.sshKeyPath, 'devboxpro_rsa');
    const publicKeyPath = `${keyPath}.pub`;

    if (await fs.pathExists(keyPath)) {
      try {
        const publicKey = await fs.readFile(publicKeyPath, 'utf8');
        return { success: true, publicKey: publicKey.trim(), exists: true };
      } catch (err) {
      }
    }

    await fs.ensureDir(this.sshKeyPath);

    let sshKeygenPath = 'ssh-keygen';
    const isWindows = process.platform === 'win32';

    if (isWindows) {
      const hasSystemSshKeygen = commandExists('ssh-keygen');

      if (!hasSystemSshKeygen && this.gitPath) {
        const gitDir = path.dirname(path.dirname(this.gitPath));
        const potentialPaths = [
          path.join(gitDir, 'usr', 'bin', 'ssh-keygen.exe'),
          path.join(gitDir, 'bin', 'ssh-keygen.exe'),
        ];

        for (const candidate of potentialPaths) {
          if (await fs.pathExists(candidate)) {
            sshKeygenPath = candidate;
            break;
          }
        }
      }

      const windowsSshKeygen = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe');
      if (await fs.pathExists(windowsSshKeygen)) {
        sshKeygenPath = windowsSshKeygen;
      }

      const finalPathExists = sshKeygenPath === 'ssh-keygen'
        ? hasSystemSshKeygen
        : await fs.pathExists(sshKeygenPath);

      if (!finalPathExists) {
        return {
          success: false,
          error: 'ssh-keygen not found. To use SSH keys, please install OpenSSH:\n\n1. Go to Settings → Apps → Optional Features\n2. Click "Add a feature"\n3. Search for "OpenSSH Client"\n4. Click Install\n\nOr install Git for Windows which includes ssh-keygen.'
        };
      }
    } else if (!commandExists('ssh-keygen')) {
      return {
        success: false,
        error: 'ssh-keygen not found. Please install OpenSSH via your package manager.'
      };
    }

    const args = ['-t', 'ed25519', '-f', keyPath, '-N', '', '-C', 'devboxpro-generated-key', '-q'];

    try {
      return new Promise((resolve) => {
        let resolved = false;
        const proc = childProcess.spawn(sshKeygenPath, args, {
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stderr = '';
        proc.stderr.on('data', (data) => {
          stderr += data.toString();
        });

        proc.on('close', async (code) => {
          if (resolved) {
            return;
          }
          resolved = true;

          if (code === 0) {
            try {
              const publicKey = await fs.readFile(publicKeyPath, 'utf8');
              resolve({ success: true, publicKey: publicKey.trim(), exists: false });
            } catch (err) {
              resolve({ success: false, error: 'Failed to read generated public key' });
            }
          } else {
            resolve({ success: false, error: stderr || 'Failed to generate SSH key' });
          }
        });

        proc.on('error', (err) => {
          if (resolved) {
            return;
          }
          resolved = true;
          resolve({ success: false, error: `ssh-keygen not available: ${err.message}` });
        });

        setTimeout(() => {
          if (resolved) {
            return;
          }
          resolved = true;
          try {
            proc.kill();
          } catch (e) {
          }
          resolve({ success: false, error: 'SSH key generation timed out' });
        }, 30000);
      });
    } catch (err) {
      return { success: false, error: `ssh-keygen not available: ${err.message}` };
    }
  },

  async getSshPublicKey() {
    const publicKeyPath = path.join(this.sshKeyPath, 'devboxpro_rsa.pub');

    if (await fs.pathExists(publicKeyPath)) {
      try {
        const publicKey = await fs.readFile(publicKeyPath, 'utf8');
        return { exists: true, publicKey: publicKey.trim() };
      } catch (err) {
        return { exists: false };
      }
    }

    return { exists: false };
  },

  async regenerateSshKey() {
    const keyPath = path.join(this.sshKeyPath, 'devboxpro_rsa');
    const publicKeyPath = `${keyPath}.pub`;

    try {
      if (await fs.pathExists(keyPath)) {
        await fs.remove(keyPath);
      }
      if (await fs.pathExists(publicKeyPath)) {
        await fs.remove(publicKeyPath);
      }
    } catch (err) {
      return { success: false, error: `Failed to delete existing key: ${err.message}` };
    }

    return this.generateSshKey();
  },
};