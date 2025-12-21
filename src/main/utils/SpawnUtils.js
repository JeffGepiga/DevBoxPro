/**
 * Spawn utilities to replace exec/execSync for Electron production builds
 * Avoids CMD window flash and buffer size limits
 */
const { spawn, spawnSync } = require('child_process');

/**
 * Run a command synchronously using spawn (no CMD window flash)
 * @param {string} command - The command to run
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 * @returns {object} - { stdout, stderr, status, error }
 */
function spawnSyncSafe(command, args = [], options = {}) {
    const defaultOptions = {
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 10000,
        ...options,
    };

    try {
        const result = spawnSync(command, args, defaultOptions);
        return {
            stdout: result.stdout ? result.stdout.toString() : '',
            stderr: result.stderr ? result.stderr.toString() : '',
            status: result.status,
            error: result.error,
        };
    } catch (error) {
        return {
            stdout: '',
            stderr: '',
            status: -1,
            error,
        };
    }
}

/**
 * Run a command asynchronously using spawn (no CMD window flash)
 * @param {string} command - The command to run
 * @param {string[]} args - Command arguments
 * @param {object} options - Spawn options
 * @returns {Promise<object>} - { stdout, stderr, code }
 */
function spawnAsync(command, args = [], options = {}) {
    return new Promise((resolve) => {
        const defaultOptions = {
            windowsHide: true,
            shell: false,
            stdio: ['pipe', 'pipe', 'pipe'],
            ...options,
        };

        const proc = spawn(command, args, defaultOptions);
        let stdout = '';
        let stderr = '';

        proc.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        proc.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        proc.on('error', (error) => {
            resolve({ stdout, stderr, code: -1, error });
        });

        proc.on('close', (code) => {
            resolve({ stdout, stderr, code });
        });

        // Timeout handling
        if (options.timeout) {
            setTimeout(() => {
                try {
                    proc.kill('SIGKILL');
                } catch (e) { }
                resolve({ stdout, stderr, code: -1, error: new Error('Timeout') });
            }, options.timeout);
        }
    });
}

/**
 * Check if a command exists in PATH (replaces `where` / `which`)
 * @param {string} command - Command name to check
 * @returns {boolean} - True if command exists
 */
function commandExists(command) {
    const isWindows = process.platform === 'win32';

    if (isWindows) {
        // On Windows, use 'where' with shell to properly search PATH
        const result = spawnSync('where', [command], {
            windowsHide: true,
            shell: true, // Required for 'where' to work properly
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: 5000,
        });
        return result.status === 0;
    } else {
        // On Unix, use 'which'
        const result = spawnSyncSafe('which', [command], {
            timeout: 5000,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        return result.status === 0;
    }
}

/**
 * Kill a process by name (Windows only)
 * @param {string} processName - Name of process to kill (e.g., 'nginx.exe')
 * @param {boolean} force - Use /F flag for force kill
 * @returns {Promise<void>}
 */
async function killProcessByName(processName, force = true) {
    if (process.platform !== 'win32') return;

    const args = force
        ? ['/F', '/IM', processName, '/T']
        : ['/IM', processName];

    await spawnAsync('taskkill.exe', args, {
        timeout: 5000,
        stdio: 'ignore',
    });
}

/**
 * Kill a process by PID
 * @param {number} pid - Process ID to kill
 * @param {boolean} force - Use /F flag for force kill
 * @returns {Promise<void>}
 */
async function killProcessByPid(pid, force = true) {
    if (process.platform !== 'win32') return;

    const args = force
        ? ['/F', '/PID', String(pid)]
        : ['/PID', String(pid)];

    await spawnAsync('taskkill.exe', args, {
        timeout: 5000,
        stdio: 'ignore',
    });
}

/**
 * Check if a process is running by name
 * @param {string} processName - Name of process to check
 * @returns {boolean}
 */
function isProcessRunning(processName) {
    if (process.platform !== 'win32') return false;

    const result = spawnSyncSafe('tasklist.exe', ['/FI', `IMAGENAME eq ${processName}`, '/NH'], {
        timeout: 5000,
    });

    return result.stdout.toLowerCase().includes(processName.toLowerCase());
}

/**
 * Get PIDs of processes matching criteria using WMIC
 * @param {string} processName - Process name (e.g., 'php.exe')
 * @param {string} pathFilter - Filter by command line containing this path
 * @returns {number[]} - Array of PIDs
 */
function getProcessPidsByPath(processName, pathFilter) {
    if (process.platform !== 'win32') return [];

    const escapedPath = pathFilter.replace(/\\/g, '\\\\');
    const result = spawnSyncSafe('wmic.exe', [
        'process',
        'where',
        `name='${processName}' and commandline like '%${escapedPath}%'`,
        'get',
        'processid'
    ], {
        timeout: 5000,
    });

    if (result.status !== 0) return [];

    return result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => /^\d+$/.test(line))
        .map(line => parseInt(line, 10));
}

/**
 * Kill processes by path filter
 * @param {string} processName - Process name
 * @param {string} pathFilter - Filter by command line containing this path
 * @returns {Promise<void>}
 */
async function killProcessesByPath(processName, pathFilter) {
    const pids = getProcessPidsByPath(processName, pathFilter);
    for (const pid of pids) {
        await killProcessByPid(pid, true);
    }
}

module.exports = {
    spawnSyncSafe,
    spawnAsync,
    commandExists,
    killProcessByName,
    killProcessByPid,
    isProcessRunning,
    getProcessPidsByPath,
    killProcessesByPath,
};
