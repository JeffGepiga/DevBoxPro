const net = require('net');

/**
 * Check if a port is available
 * @param {number} port - The port to check
 * @param {string|null} host - Specific host to check. When omitted, checks whether the port is free on any interface.
 * @returns {Promise<boolean>} - True if port is available
 */
async function canBindPort(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        // Other errors - assume port is available
        resolve(true);
      }
    });

    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });

    server.listen(port, host);
  });
}

async function isPortAvailable(port, host = null) {
  if (host) {
    return canBindPort(port, host);
  }

  const hostsToCheck = process.platform === 'win32'
    ? ['0.0.0.0', '127.0.0.1']
    : ['0.0.0.0', '127.0.0.1', '::'];

  for (const candidateHost of hostsToCheck) {
    const available = await canBindPort(port, candidateHost);
    if (!available) {
      return false;
    }
  }

  return true;
}

/**
 * Find an available port starting from a given port
 * @param {number} startPort - The port to start searching from
 * @param {number} maxAttempts - Maximum number of ports to try (default: 100)
 * @param {string|null} host - Specific host to check. When omitted, checks whether the port is free on any interface.
 * @returns {Promise<number|null>} - The first available port, or null if none found
 */
async function findAvailablePort(startPort, maxAttempts = 100, host = null) {
  for (let i = 0; i < maxAttempts; i++) {
    const port = startPort + i;
    if (await isPortAvailable(port, host)) {
      return port;
    }
  }
  return null;
}

/**
 * Find multiple available ports starting from a given port
 * @param {number} startPort - The port to start searching from
 * @param {number} count - Number of ports needed
 * @param {number} maxAttempts - Maximum number of ports to try per port needed
 * @param {string|null} host - Specific host to check. When omitted, checks whether the port is free on any interface.
 * @returns {Promise<number[]>} - Array of available ports
 */
async function findAvailablePorts(startPort, count, maxAttempts = 100, host = null) {
  const ports = [];
  let currentPort = startPort;

  for (let i = 0; i < count && currentPort < startPort + maxAttempts * count; i++) {
    const port = await findAvailablePort(currentPort, maxAttempts, host);
    if (port === null) {
      throw new Error(`Could not find ${count} available ports starting from ${startPort}`);
    }
    ports.push(port);
    currentPort = port + 1;
  }

  return ports;
}

/**
 * Get the process using a specific port (Windows only for now)
 * @param {number} port - The port to check
 * @returns {Promise<{pid: number, process: string}|null>} - Process info or null
 */
async function getProcessOnPort(port) {
  const { spawnAsync } = require('./SpawnUtils');

  if (process.platform === 'win32') {
    const result = await spawnAsync('netstat.exe', ['-ano'], {
      timeout: 5000,
    });

    if (result.code !== 0 || !result.stdout) {
      return null;
    }

    const lines = result.stdout.trim().split('\n');
    for (const line of lines) {
      if (line.includes(`:${port}`)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 5) {
          const localAddress = parts[1];
          const state = parts[3];
          if (localAddress.endsWith(`:${port}`) && state === 'LISTENING') {
            const pid = parseInt(parts[4], 10);
            if (!isNaN(pid)) {
              return { pid, address: localAddress };
            }
          }
        }
      }
    }
    return null;
  } else {
    const result = await spawnAsync('lsof', ['-i', `:${port}`, '-t'], {
      timeout: 5000,
    });

    if (result.code !== 0 || !result.stdout) {
      return null;
    }

    const pid = parseInt(result.stdout.trim(), 10);
    if (!isNaN(pid)) {
      return { pid };
    }
    return null;
  }
}

module.exports = {
  isPortAvailable,
  findAvailablePort,
  findAvailablePorts,
  getProcessOnPort,
};
