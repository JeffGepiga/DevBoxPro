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

async function waitForPortAvailable(port, timeoutMs = 5000) {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (await isPortAvailable(port)) {
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return await isPortAvailable(port);
}

module.exports = {
  // Redis
  async startRedis(version = '7.4') {
    const redisPath = this.getRedisPath(version);
    const redisServerPath = path.join(
      redisPath,
      process.platform === 'win32' ? 'redis-server.exe' : 'redis-server'
    );

    if (!await fs.pathExists(redisServerPath)) {
      this.managers.log?.systemError(`Redis ${version} binary not found. Please download Redis from the Binary Manager.`);
      const status = this.serviceStatus.get('redis');
      status.status = 'not_installed';
      status.error = `Redis ${version} binary not found. Please download from Binary Manager.`;
      return;
    }

    const dataPath = this.getDataPath();
    const dataDir = path.join(dataPath, 'redis', version, 'data');

    await fs.ensureDir(dataDir);

    const defaultPort = this.getVersionPort('redis', version, this.serviceConfigs.redis.defaultPort);
    let port = defaultPort;

    if (!await isPortAvailable(port)) {
      const released = await waitForPortAvailable(defaultPort, 5000);
      if (released) {
        port = defaultPort;
      } else {
        port = await findAvailablePort(defaultPort, 100);
        if (!port) {
          throw new Error(`Could not find available port for Redis starting from ${defaultPort}`);
        }
      }
    }

    this.serviceConfigs.redis.actualPort = port;

    const configPath = path.join(dataPath, 'redis', version, 'redis.conf');
    await this.createRedisConfig(configPath, dataDir, port, version);

    const configDir = path.dirname(configPath);
    const configFilename = path.basename(configPath);

    let proc;
    if (process.platform === 'win32') {
      proc = spawnHidden(redisServerPath, [configFilename], {
        cwd: configDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      proc.stdout?.on('data', (data) => {
        this.managers.log?.service('redis', data.toString());
      });

      proc.stderr?.on('data', (data) => {
        this.managers.log?.service('redis', data.toString(), 'error');
      });
    } else {
      proc = spawn(redisServerPath, [configPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });

      proc.stdout.on('data', (data) => {
        this.managers.log?.service('redis', data.toString());
      });

      proc.stderr.on('data', (data) => {
        this.managers.log?.service('redis', data.toString(), 'error');
      });
    }

    this.processes.set(this.getProcessKey('redis', version), proc);
    const status = this.serviceStatus.get('redis');
    status.port = port;
    status.version = version;

    this.runningVersions.get('redis').set(version, { port, startedAt: new Date() });

    try {
      await this.waitForService('redis', 10000);
      status.status = 'running';
      status.startedAt = Date.now();
    } catch (error) {
      this.managers.log?.systemError(`Redis ${version} failed to become ready`, { error: error.message });
      status.status = 'error';
      status.error = `Redis ${version} failed to start properly: ${error.message}`;
      this.runningVersions.get('redis').delete(version);
      throw error;
    }
  },

  async createRedisConfig(configPath, dataDir, port, version = '7.4') {
    await fs.ensureDir(path.dirname(configPath));
    await fs.ensureDir(dataDir);

    const config = `
port ${port}
bind 127.0.0.1
daemonize no
dir ./data
appendonly yes
appendfilename "appendonly.aof"
dbfilename dump_${version.replace(/\./g, '')}.rdb
`;
    await fs.writeFile(configPath, config);
  },
};
