const path = require('path');
const fs = require('fs-extra');
const { EventEmitter } = require('events');

class LogManager extends EventEmitter {
  constructor(configStore) {
    super();
    this.configStore = configStore;
    this.logsPath = null;
    this.maxLogSize = 10 * 1024 * 1024; // 10MB per log file
    this.maxLogFiles = 5;
    this.streams = new Map();
    this.watchers = new Map();
  }

  async initialize() {
    console.log('Initializing LogManager...');

    const dataPath = this.configStore.get('dataPath');
    this.logsPath = path.join(dataPath, 'logs');

    await fs.ensureDir(this.logsPath);
    await fs.ensureDir(path.join(this.logsPath, 'projects'));
    await fs.ensureDir(path.join(this.logsPath, 'services'));

    console.log('LogManager initialized');
  }

  // Log methods
  info(message, data = null) {
    this.writeLog('app', 'info', message, data);
  }

  warn(message, data = null) {
    this.writeLog('app', 'warn', message, data);
  }

  error(message, data = null) {
    this.writeLog('app', 'error', message, data);
  }

  debug(message, data = null) {
    this.writeLog('app', 'debug', message, data);
  }

  project(projectId, message, level = 'info') {
    const logFile = path.join(this.logsPath, 'projects', `${projectId}.log`);
    this.appendToLog(logFile, level, message);
    this.emit('log', { type: 'project', projectId, level, message });
  }

  service(serviceName, message, level = 'info') {
    const logFile = path.join(this.logsPath, 'services', `${serviceName}.log`);
    this.appendToLog(logFile, level, message);
    this.emit('log', { type: 'service', service: serviceName, level, message });
  }

  writeLog(category, level, message, data) {
    const logFile = path.join(this.logsPath, `${category}.log`);
    const logEntry = this.formatLogEntry(level, message, data);
    this.appendToLog(logFile, level, logEntry);
    this.emit('log', { type: category, level, message, data });
  }

  formatLogEntry(level, message, data) {
    const timestamp = new Date().toISOString();
    let entry = `[${timestamp}] [${level.toUpperCase()}] ${message}`;

    if (data) {
      if (typeof data === 'object') {
        entry += ` ${JSON.stringify(data)}`;
      } else {
        entry += ` ${data}`;
      }
    }

    return entry;
  }

  async appendToLog(logFile, level, message) {
    try {
      // Ensure directory exists
      await fs.ensureDir(path.dirname(logFile));

      // Check file size and rotate if needed
      await this.rotateLogIfNeeded(logFile);

      // Append to log file
      const timestamp = new Date().toISOString();
      const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}\n`;
      await fs.appendFile(logFile, logLine);
    } catch (error) {
      console.error('Error writing to log:', error);
    }
  }

  async rotateLogIfNeeded(logFile) {
    try {
      const stats = await fs.stat(logFile).catch(() => null);

      if (stats && stats.size >= this.maxLogSize) {
        // Rotate log files
        for (let i = this.maxLogFiles - 1; i >= 0; i--) {
          const oldFile = i === 0 ? logFile : `${logFile}.${i}`;
          const newFile = `${logFile}.${i + 1}`;

          if (await fs.pathExists(oldFile)) {
            if (i === this.maxLogFiles - 1) {
              await fs.unlink(oldFile);
            } else {
              await fs.move(oldFile, newFile, { overwrite: true });
            }
          }
        }
      }
    } catch (error) {
      console.error('Error rotating log:', error);
    }
  }

  // Get logs
  async getProjectLogs(projectId, lines = 100) {
    const logFile = path.join(this.logsPath, 'projects', `${projectId}.log`);
    return this.readLastLines(logFile, lines);
  }

  async getServiceLogs(serviceName, lines = 100) {
    const logFile = path.join(this.logsPath, 'services', `${serviceName}.log`);
    return this.readLastLines(logFile, lines);
  }

  async getAppLogs(lines = 100) {
    const logFile = path.join(this.logsPath, 'app.log');
    return this.readLastLines(logFile, lines);
  }

  async readLastLines(filePath, numLines) {
    try {
      if (!(await fs.pathExists(filePath))) {
        return [];
      }

      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      return lines.slice(-numLines);
    } catch (error) {
      console.error('Error reading log file:', error);
      return [];
    }
  }

  // Clear logs
  async clearProjectLogs(projectId) {
    const logFile = path.join(this.logsPath, 'projects', `${projectId}.log`);
    try {
      await fs.writeFile(logFile, '');
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to clear logs: ${error.message}`);
    }
  }

  async clearServiceLogs(serviceName) {
    const logFile = path.join(this.logsPath, 'services', `${serviceName}.log`);
    try {
      await fs.writeFile(logFile, '');
      return { success: true };
    } catch (error) {
      throw new Error(`Failed to clear logs: ${error.message}`);
    }
  }

  // Real-time log streaming
  streamLogs(projectId, callback) {
    const logFile = path.join(this.logsPath, 'projects', `${projectId}.log`);

    // Stop any existing watcher
    this.stopStreaming(projectId);

    // Watch for file changes
    const watcher = fs.watch(logFile, async (eventType) => {
      if (eventType === 'change') {
        const lines = await this.readLastLines(logFile, 10);
        lines.forEach((line) => callback(line));
      }
    });

    this.watchers.set(projectId, watcher);

    // Return the latest logs immediately
    this.readLastLines(logFile, 50).then((lines) => {
      lines.forEach((line) => callback(line));
    });
  }

  stopStreaming(projectId) {
    const watcher = this.watchers.get(projectId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectId);
    }
  }

  // Parse log entries
  parseLogEntry(line) {
    const match = line.match(/^\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.*)$/);

    if (match) {
      return {
        timestamp: match[1],
        level: match[2].toLowerCase(),
        message: match[3],
      };
    }

    return {
      timestamp: new Date().toISOString(),
      level: 'info',
      message: line,
    };
  }

  // Get all logs combined
  async getAllLogs(filter = {}) {
    const logs = [];

    // Get project logs
    const projectsDir = path.join(this.logsPath, 'projects');
    if (await fs.pathExists(projectsDir)) {
      const files = await fs.readdir(projectsDir);

      for (const file of files) {
        if (file.endsWith('.log')) {
          const projectId = file.replace('.log', '');
          const logLines = await this.readLastLines(
            path.join(projectsDir, file),
            filter.limit || 50
          );

          logLines.forEach((line) => {
            const parsed = this.parseLogEntry(line);
            logs.push({
              type: 'project',
              projectId,
              ...parsed,
            });
          });
        }
      }
    }

    // Get service logs
    const servicesDir = path.join(this.logsPath, 'services');
    if (await fs.pathExists(servicesDir)) {
      const files = await fs.readdir(servicesDir);

      for (const file of files) {
        if (file.endsWith('.log')) {
          const serviceName = file.replace('.log', '');
          const logLines = await this.readLastLines(
            path.join(servicesDir, file),
            filter.limit || 50
          );

          logLines.forEach((line) => {
            const parsed = this.parseLogEntry(line);
            logs.push({
              type: 'service',
              service: serviceName,
              ...parsed,
            });
          });
        }
      }
    }

    // Sort by timestamp
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // Apply level filter
    if (filter.level) {
      return logs.filter((log) => log.level === filter.level);
    }

    return logs.slice(0, filter.limit || 100);
  }
}

module.exports = { LogManager };
