const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');

module.exports = {
  validateRepositoryUrl(url) {
    if (!url || typeof url !== 'string') {
      return { valid: false, type: 'unknown', error: 'URL is required' };
    }

    const trimmedUrl = url.trim();
    const httpsPattern = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org|[\w.-]+)\/.+\.git$/i;
    const httpsPatternNoGit = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org|[\w.-]+)\/.+$/i;
    const sshPattern = /^git@[\w.-]+:.+\.git$/i;
    const sshPatternNoGit = /^git@[\w.-]+:.+$/i;

    if (httpsPattern.test(trimmedUrl) || httpsPatternNoGit.test(trimmedUrl)) {
      return { valid: true, type: 'https' };
    }

    if (sshPattern.test(trimmedUrl) || sshPatternNoGit.test(trimmedUrl)) {
      return { valid: true, type: 'ssh' };
    }

    return { valid: false, type: 'unknown', error: 'Invalid repository URL format' };
  },

  async cloneRepository(url, destPath, options = {}) {
    if (!this.gitPath) {
      return { success: false, error: 'Git is not available. Please install Git from the Binary Manager.' };
    }

    const { authType = 'public', accessToken, branch, onProgress } = options;
    const validation = this.validateRepositoryUrl(url);
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    let cloneUrl = url;
    if (authType === 'token' && accessToken && validation.type === 'https') {
      cloneUrl = url.replace(/^https:\/\//, `https://${accessToken}@`);
    }

    const destExists = await fs.pathExists(destPath);
    let cloneIntoExisting = false;

    if (destExists) {
      const files = await fs.readdir(destPath);
      if (files.length === 0) {
        cloneIntoExisting = true;
      } else {
        return { success: false, error: 'Destination folder already exists and is not empty.' };
      }
    } else {
      await fs.ensureDir(path.dirname(destPath));
    }

    const args = ['clone', '--progress'];
    if (branch) {
      args.push('--branch', branch);
    }

    if (cloneIntoExisting) {
      args.push(cloneUrl, '.');
    } else {
      args.push(cloneUrl, destPath);
    }

    const env = { ...process.env };
    if (authType === 'ssh') {
      const sshKeyFile = path.join(this.sshKeyPath, 'devboxpro_rsa');
      if (await fs.pathExists(sshKeyFile)) {
        env.GIT_SSH_COMMAND = `ssh -i "${sshKeyFile}" -o StrictHostKeyChecking=no`;
      }
    }

    return new Promise((resolve) => {
      const spawnOptions = {
        windowsHide: true,
        env,
      };

      if (cloneIntoExisting) {
        spawnOptions.cwd = destPath;
      }

      const proc = spawn(this.gitPath, args, spawnOptions);
      let errorOutput = '';

      proc.stderr.on('data', (data) => {
        const text = data.toString();
        errorOutput += text;

        const progressMatch = text.match(/(\d+)%/);
        if (progressMatch && onProgress) {
          onProgress({
            percent: parseInt(progressMatch[1], 10),
            text: text.trim(),
          });
        }

        this.emitProgress({
          percent: progressMatch ? parseInt(progressMatch[1], 10) : 0,
          text: text.trim(),
        });
      });

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        if (onProgress) {
          onProgress({ text: text.trim() });
        }
      });

      proc.on('close', (code) => {
        if (code === 0) {
          this.managers?.log?.systemInfo('Repository cloned successfully', {
            destPath,
            authType,
          });
          resolve({ success: true });
          return;
        }

        fs.remove(destPath).catch(() => {});

        let sanitizedOutput = errorOutput;
        if (accessToken) {
          sanitizedOutput = sanitizedOutput.replace(new RegExp(accessToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[TOKEN]');
        }
        sanitizedOutput = sanitizedOutput.replace(/https:\/\/[^@]+@/g, 'https://[REDACTED]@');

        let error = 'Clone failed';
        if (sanitizedOutput.includes('Repository not found')) {
          error = 'Repository not found. Check the URL or your access permissions.';
        } else if (sanitizedOutput.includes('Authentication failed')) {
          error = 'Authentication failed. Check your access token or SSH key.';
        } else if (sanitizedOutput.includes('Permission denied')) {
          error = 'Permission denied. Check your SSH key configuration.';
        } else if (sanitizedOutput.includes('already exists')) {
          error = 'Destination folder already exists and is not empty.';
        } else if (sanitizedOutput.trim()) {
          error = sanitizedOutput.trim().split('\n').pop();
        }

        this.managers?.log?.systemWarn('Repository clone failed', {
          destPath,
          authType,
          error: error.substring(0, 200),
        });

        resolve({ success: false, error });
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: `Failed to start git: ${err.message}` });
      });
    });
  },

  async testAuthentication(url, credentials = {}) {
    if (!this.gitPath) {
      return { success: false, error: 'Git is not available' };
    }

    const { authType = 'public', accessToken } = credentials;
    const validation = this.validateRepositoryUrl(url);

    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    let testUrl = url;
    if (authType === 'token' && accessToken && validation.type === 'https') {
      testUrl = url.replace(/^https:\/\//, `https://${accessToken}@`);
    }

    const env = { ...process.env };
    if (authType === 'ssh') {
      const sshKeyFile = path.join(this.sshKeyPath, 'devboxpro_rsa');
      if (await fs.pathExists(sshKeyFile)) {
        env.GIT_SSH_COMMAND = `ssh -i "${sshKeyFile}" -o StrictHostKeyChecking=no`;
      }
    }

    return new Promise((resolve) => {
      const proc = spawn(this.gitPath, ['ls-remote', '--exit-code', testUrl], {
        windowsHide: true,
        env,
        timeout: 30000,
      });

      let errorOutput = '';
      proc.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
          return;
        }

        let error = 'Authentication failed';
        if (errorOutput.includes('Repository not found')) {
          error = 'Repository not found';
        } else if (errorOutput.includes('Authentication failed')) {
          error = 'Invalid credentials';
        } else if (errorOutput.includes('Permission denied')) {
          error = 'SSH key not authorized';
        }
        resolve({ success: false, error });
      });

      proc.on('error', (err) => {
        resolve({ success: false, error: err.message });
      });
    });
  },
};