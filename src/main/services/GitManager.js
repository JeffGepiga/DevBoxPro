const path = require('path');
const fs = require('fs-extra');
const { spawn } = require('child_process');
const { app } = require('electron');
const os = require('os');

/**
 * GitManager - Handles Git operations for cloning repositories
 * Supports both system Git and portable Git downloaded via BinaryDownloadManager
 */
class GitManager {
    constructor(configStore, managers) {
        this.configStore = configStore;
        this.managers = managers;
        this.resourcesPath = path.join(app.getPath('userData'), 'resources');
        this.gitPath = null; // Path to git executable
        this.progressListeners = new Set();
        this.sshKeyPath = path.join(app.getPath('userData'), 'ssh');
    }

    /**
     * Initialize GitManager - detect system Git or use portable version
     */
    async initialize() {
        this.gitPath = await this.findGitExecutable();

        // Ensure SSH directory exists
        await fs.ensureDir(this.sshKeyPath);

        if (this.gitPath) {
            this.managers.log?.systemInfo('Git found', { path: this.gitPath });
        } else {
            this.managers.log?.systemWarn('Git not found - download from Binary Manager to enable repository cloning');
        }
    }

    /**
     * Find Git executable - check system PATH first, then portable Git
     * @returns {string|null} Path to git executable or null if not found
     */
    async findGitExecutable() {
        const platform = process.platform;
        const isWindows = platform === 'win32';
        const gitExe = isWindows ? 'git.exe' : 'git';

        // 1. Check if system Git is available
        const systemGit = await this.checkSystemGit();
        if (systemGit) {
            return systemGit;
        }

        // 2. Check for portable Git in resources
        const portableGitPath = path.join(this.resourcesPath, 'git', isWindows ? 'win' : 'mac');
        const portableGitExe = path.join(portableGitPath, 'cmd', gitExe);

        if (await fs.pathExists(portableGitExe)) {
            return portableGitExe;
        }

        // Also check bin folder for portable Git
        const portableGitBin = path.join(portableGitPath, 'bin', gitExe);
        if (await fs.pathExists(portableGitBin)) {
            return portableGitBin;
        }

        return null;
    }

    /**
     * Check if system Git is installed and accessible
     * @returns {string|null} Path to system git or null
     */
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
                    // Return the first path found
                    const gitPath = output.trim().split(/[\r\n]+/)[0];
                    resolve(gitPath);
                } else {
                    resolve(null);
                }
            });

            proc.on('error', () => {
                resolve(null);
            });
        });
    }

    /**
     * Check if Git is available
     * @returns {Object} { available: boolean, path: string, source: 'system'|'portable'|null }
     */
    async isGitAvailable() {
        if (!this.gitPath) {
            this.gitPath = await this.findGitExecutable();
        }

        if (!this.gitPath) {
            return { available: false, path: null, source: null };
        }

        // Determine source
        const isPortable = this.gitPath.includes(this.resourcesPath);

        // Get version
        const version = await this.getGitVersion();

        return {
            available: true,
            path: this.gitPath,
            source: isPortable ? 'portable' : 'system',
            version,
        };
    }

    /**
     * Get Git version string
     * @returns {string|null} Version string or null
     */
    async getGitVersion() {
        if (!this.gitPath) return null;

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
                    // Parse "git version 2.43.0" -> "2.43.0"
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
    }

    /**
     * Validate a repository URL
     * @param {string} url - Repository URL to validate
     * @returns {Object} { valid: boolean, type: 'https'|'ssh'|'unknown', error?: string }
     */
    validateRepositoryUrl(url) {
        if (!url || typeof url !== 'string') {
            return { valid: false, type: 'unknown', error: 'URL is required' };
        }

        const trimmedUrl = url.trim();

        // HTTPS URL pattern
        const httpsPattern = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org|[\w.-]+)\/.+\.git$/i;
        const httpsPatternNoGit = /^https?:\/\/(github\.com|gitlab\.com|bitbucket\.org|[\w.-]+)\/.+$/i;

        // SSH URL patterns
        const sshPattern = /^git@[\w.-]+:.+\.git$/i;
        const sshPatternNoGit = /^git@[\w.-]+:.+$/i;

        if (httpsPattern.test(trimmedUrl) || httpsPatternNoGit.test(trimmedUrl)) {
            return { valid: true, type: 'https' };
        }

        if (sshPattern.test(trimmedUrl) || sshPatternNoGit.test(trimmedUrl)) {
            return { valid: true, type: 'ssh' };
        }

        return { valid: false, type: 'unknown', error: 'Invalid repository URL format' };
    }

    /**
     * Clone a repository
     * @param {string} url - Repository URL
     * @param {string} destPath - Destination path
     * @param {Object} options - Clone options
     * @param {string} options.authType - 'public', 'token', or 'ssh'
     * @param {string} options.accessToken - Personal access token (for token auth)
     * @param {string} options.branch - Branch to clone (optional)
     * @param {function} options.onProgress - Progress callback
     * @returns {Object} { success: boolean, error?: string }
     */
    async cloneRepository(url, destPath, options = {}) {
        if (!this.gitPath) {
            return { success: false, error: 'Git is not available. Please install Git from the Binary Manager.' };
        }

        const { authType = 'public', accessToken, branch, onProgress } = options;

        // Validate URL
        const validation = this.validateRepositoryUrl(url);
        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Prepare the URL with authentication if needed
        let cloneUrl = url;
        if (authType === 'token' && accessToken && validation.type === 'https') {
            // Insert token into HTTPS URL
            // https://github.com/user/repo.git -> https://TOKEN@github.com/user/repo.git
            cloneUrl = url.replace(/^https:\/\//, `https://${accessToken}@`);
        }

        // Check if destination already exists
        const destExists = await fs.pathExists(destPath);
        let cloneIntoExisting = false;

        if (destExists) {
            // Check if directory is empty
            const files = await fs.readdir(destPath);
            if (files.length === 0) {
                // Directory exists but is empty - we can clone into it
                cloneIntoExisting = true;
            } else {
                return { success: false, error: 'Destination folder already exists and is not empty.' };
            }
        } else {
            // Ensure destination directory's parent exists
            const parentDir = path.dirname(destPath);
            await fs.ensureDir(parentDir);
        }

        // Build clone command arguments
        const args = ['clone', '--progress'];

        if (branch) {
            args.push('--branch', branch);
        }

        // If cloning into existing empty directory, use "." as destination
        if (cloneIntoExisting) {
            args.push(cloneUrl, '.');
        } else {
            args.push(cloneUrl, destPath);
        }

        // Set up environment for SSH auth if needed
        const env = { ...process.env };
        if (authType === 'ssh') {
            const sshKeyFile = path.join(this.sshKeyPath, 'devboxpro_rsa');
            if (await fs.pathExists(sshKeyFile)) {
                // Use the generated SSH key
                env.GIT_SSH_COMMAND = `ssh -i "${sshKeyFile}" -o StrictHostKeyChecking=no`;
            }
        }

        return new Promise((resolve) => {
            const spawnOptions = {
                windowsHide: true,
                env,
            };

            // If cloning into existing empty directory, set cwd to that directory
            if (cloneIntoExisting) {
                spawnOptions.cwd = destPath;
            }

            const proc = spawn(this.gitPath, args, spawnOptions);

            let errorOutput = '';

            // Git sends progress to stderr
            proc.stderr.on('data', (data) => {
                const text = data.toString();
                errorOutput += text;

                // Parse progress from Git output
                // Examples: "Receiving objects:  45% (123/273)"
                const progressMatch = text.match(/(\d+)%/);
                if (progressMatch && onProgress) {
                    onProgress({
                        percent: parseInt(progressMatch[1], 10),
                        text: text.trim(),
                    });
                }

                // Also emit to listeners
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
                    // Security: Log successful clone without exposing sensitive data
                    this.managers?.log?.systemInfo('Repository cloned successfully', {
                        destPath,
                        authType,
                    });
                    resolve({ success: true });
                } else {
                    // Clean up failed clone attempt
                    fs.remove(destPath).catch(() => { });

                    // Security: Sanitize error output to remove any tokens before logging or returning
                    let sanitizedOutput = errorOutput;
                    if (accessToken) {
                        // Remove any occurrence of the access token from error output
                        sanitizedOutput = sanitizedOutput.replace(new RegExp(accessToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[TOKEN]');
                    }
                    // Also sanitize any https://TOKEN@... patterns
                    sanitizedOutput = sanitizedOutput.replace(/https:\/\/[^@]+@/g, 'https://[REDACTED]@');

                    // Parse error message
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

                    // Security: Log failed clone without exposing sensitive data
                    this.managers?.log?.systemWarn('Repository clone failed', {
                        destPath,
                        authType,
                        error: error.substring(0, 200),
                    });

                    resolve({ success: false, error });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: `Failed to start git: ${err.message}` });
            });
        });
    }

    /**
     * Generate an SSH key pair for Git authentication
     * @returns {Object} { success: boolean, publicKey?: string, error?: string }
     */
    async generateSshKey() {
        const { spawnAsync, commandExists } = require('../utils/SpawnUtils');

        const keyPath = path.join(this.sshKeyPath, 'devboxpro_rsa');
        const publicKeyPath = `${keyPath}.pub`;

        // Check if key already exists
        if (await fs.pathExists(keyPath)) {
            // Return existing public key
            try {
                const publicKey = await fs.readFile(publicKeyPath, 'utf8');
                return { success: true, publicKey: publicKey.trim(), exists: true };
            } catch (err) {
                // Key file corrupted, regenerate
            }
        }

        // Ensure directory exists
        await fs.ensureDir(this.sshKeyPath);

        // Find ssh-keygen path
        let sshKeygenPath = 'ssh-keygen';
        const isWindows = process.platform === 'win32';

        if (isWindows) {
            // First check system PATH
            const hasSystemSshKeygen = commandExists('ssh-keygen');

            if (hasSystemSshKeygen) {
                sshKeygenPath = 'ssh-keygen';
            } else if (this.gitPath) {
                // Try to find in Git installation
                const gitDir = path.dirname(path.dirname(this.gitPath));
                const potentialPaths = [
                    path.join(gitDir, 'usr', 'bin', 'ssh-keygen.exe'),
                    path.join(gitDir, 'bin', 'ssh-keygen.exe'),
                ];
                for (const p of potentialPaths) {
                    const exists = await fs.pathExists(p);
                    if (exists) {
                        sshKeygenPath = p;
                        break;
                    }
                }
            }

            // Also check Windows built-in OpenSSH
            const windowsSshKeygen = path.join(process.env.SYSTEMROOT || 'C:\\Windows', 'System32', 'OpenSSH', 'ssh-keygen.exe');
            const windowsSshKeygenExists = await fs.pathExists(windowsSshKeygen);
            if (windowsSshKeygenExists) {
                sshKeygenPath = windowsSshKeygen;
            }

            // Check if we found ssh-keygen anywhere
            const finalPathExists = sshKeygenPath === 'ssh-keygen'
                ? hasSystemSshKeygen
                : await fs.pathExists(sshKeygenPath);

            if (!finalPathExists) {
                return {
                    success: false,
                    error: 'ssh-keygen not found. To use SSH keys, please install OpenSSH:\n\n' +
                        '1. Go to Settings → Apps → Optional Features\n' +
                        '2. Click "Add a feature"\n' +
                        '3. Search for "OpenSSH Client"\n' +
                        '4. Click Install\n\n' +
                        'Or install Git for Windows which includes ssh-keygen.'
                };
            }
        } else {
            // macOS/Linux - check if ssh-keygen exists
            if (!commandExists('ssh-keygen')) {
                return {
                    success: false,
                    error: 'ssh-keygen not found. Please install OpenSSH via your package manager.'
                };
            }
        }

        // Build the command as a single string for shell execution
        // This properly handles the empty passphrase on Windows
        const keyPathEscaped = keyPath.replace(/\\/g, '\\\\');
        const command = isWindows
            ? `"${sshKeygenPath}" -t ed25519 -f "${keyPathEscaped}" -N "" -C "devboxpro-generated-key" -q`
            : `"${sshKeygenPath}" -t ed25519 -f "${keyPath}" -N "" -C "devboxpro-generated-key" -q`;

        try {
            const { spawn } = require('child_process');

            return new Promise((resolve) => {
                let resolved = false;

                const proc = spawn(command, [], {
                    windowsHide: true,
                    shell: true,
                    stdio: ['ignore', 'pipe', 'pipe'],
                });

                let stdout = '';
                let stderr = '';

                proc.stdout.on('data', (data) => {
                    stdout += data.toString();
                });

                proc.stderr.on('data', (data) => {
                    stderr += data.toString();
                });

                proc.on('close', async (code) => {
                    if (resolved) return;
                    resolved = true;

                    if (code === 0) {
                        try {
                            const publicKey = await fs.readFile(publicKeyPath, 'utf8');
                            resolve({ success: true, publicKey: publicKey.trim(), exists: false });
                        } catch (err) {
                            resolve({ success: false, error: 'Failed to read generated public key' });
                        }
                    } else {
                        const errorMsg = stderr || 'Failed to generate SSH key';
                        resolve({ success: false, error: errorMsg });
                    }
                });

                proc.on('error', (err) => {
                    if (resolved) return;
                    resolved = true;
                    resolve({ success: false, error: `ssh-keygen not available: ${err.message}` });
                });

                // Timeout after 30 seconds
                setTimeout(() => {
                    if (resolved) return;
                    resolved = true;
                    try { proc.kill(); } catch (e) { }
                    resolve({ success: false, error: 'SSH key generation timed out' });
                }, 30000);
            });
        } catch (err) {
            return { success: false, error: `ssh-keygen not available: ${err.message}` };
        }
    }

    /**
     * Get the public SSH key if it exists
     * @returns {Object} { exists: boolean, publicKey?: string }
     */
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
    }

    /**
     * Regenerate SSH key - deletes existing key and generates a new one
     * @returns {Object} { success: boolean, publicKey?: string, error?: string }
     */
    async regenerateSshKey() {
        const keyPath = path.join(this.sshKeyPath, 'devboxpro_rsa');
        const publicKeyPath = `${keyPath}.pub`;

        // Delete existing keys
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

        // Generate new key
        return this.generateSshKey();
    }

    /**
     * Test authentication for a repository
     * @param {string} url - Repository URL
     * @param {Object} credentials - { authType, accessToken }
     * @returns {Object} { success: boolean, error?: string }
     */
    async testAuthentication(url, credentials = {}) {
        if (!this.gitPath) {
            return { success: false, error: 'Git is not available' };
        }

        const { authType = 'public', accessToken } = credentials;
        const validation = this.validateRepositoryUrl(url);

        if (!validation.valid) {
            return { success: false, error: validation.error };
        }

        // Prepare URL with auth
        let testUrl = url;
        if (authType === 'token' && accessToken && validation.type === 'https') {
            testUrl = url.replace(/^https:\/\//, `https://${accessToken}@`);
        }

        // Set up environment for SSH
        const env = { ...process.env };
        if (authType === 'ssh') {
            const sshKeyFile = path.join(this.sshKeyPath, 'devboxpro_rsa');
            if (await fs.pathExists(sshKeyFile)) {
                env.GIT_SSH_COMMAND = `ssh -i "${sshKeyFile}" -o StrictHostKeyChecking=no`;
            }
        }

        // Use git ls-remote to test access without cloning
        return new Promise((resolve) => {
            const proc = spawn(this.gitPath, ['ls-remote', '--exit-code', testUrl], {
                windowsHide: true,
                env,
                timeout: 30000, // 30 second timeout
            });

            let errorOutput = '';
            proc.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve({ success: true });
                } else {
                    let error = 'Authentication failed';
                    if (errorOutput.includes('Repository not found')) {
                        error = 'Repository not found';
                    } else if (errorOutput.includes('Authentication failed')) {
                        error = 'Invalid credentials';
                    } else if (errorOutput.includes('Permission denied')) {
                        error = 'SSH key not authorized';
                    }
                    resolve({ success: false, error });
                }
            });

            proc.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * Add a progress listener
     * @param {function} callback - Progress callback
     * @returns {function} Cleanup function
     */
    onProgress(callback) {
        this.progressListeners.add(callback);
        return () => this.progressListeners.delete(callback);
    }

    /**
     * Emit progress to all listeners
     * @param {Object} progress - Progress data
     */
    emitProgress(progress) {
        for (const listener of this.progressListeners) {
            try {
                listener(progress);
            } catch (err) {
                // Ignore listener errors
            }
        }
    }
}

module.exports = { GitManager };
