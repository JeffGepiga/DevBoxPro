const net = require('net');

/**
 * Check if a port is available
 * @param {number} port - The port to check
 * @param {string} host - The host to check (default: '127.0.0.1')
 * @returns {Promise<boolean>} - True if port is available
 */
async function isPortAvailable(port, host = '127.0.0.1') {
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

/**
 * Find an available port starting from a given port
 * @param {number} startPort - The port to start searching from
 * @param {number} maxAttempts - Maximum number of ports to try (default: 100)
 * @param {string} host - The host to check (default: '127.0.0.1')
 * @returns {Promise<number|null>} - The first available port, or null if none found
 */
async function findAvailablePort(startPort, maxAttempts = 100, host = '127.0.0.1') {
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
 * @param {string} host - The host to check
 * @returns {Promise<number[]>} - Array of available ports
 */
async function findAvailablePorts(startPort, count, maxAttempts = 100, host = '127.0.0.1') {
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
  const { exec } = require('child_process');
  
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        
        const lines = stdout.trim().split('\n');
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 5) {
            const localAddress = parts[1];
            if (localAddress.endsWith(`:${port}`)) {
              const pid = parseInt(parts[4], 10);
              if (!isNaN(pid)) {
                resolve({ pid, address: localAddress });
                return;
              }
            }
          }
        }
        resolve(null);
      });
    } else {
      exec(`lsof -i :${port} -t`, (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        
        const pid = parseInt(stdout.trim(), 10);
        if (!isNaN(pid)) {
          resolve({ pid });
        } else {
          resolve(null);
        }
      });
    }
  });
}

module.exports = {
  isPortAvailable,
  findAvailablePort,
  findAvailablePorts,
  getProcessOnPort,
};
