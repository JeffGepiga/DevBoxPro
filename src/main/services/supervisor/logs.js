const path = require('path');
const fs = require('fs-extra');

module.exports = {
  logOutput(projectId, processName, output, type) {
    if (this.logsPath) {
      const logFile = path.join(this.logsPath, `${projectId}-${processName}.log`);
      const timestamp = new Date().toISOString();
      const prefix = type === 'stderr' ? '[ERR]' : '[OUT]';
      const formattedOutput = output.split('\n')
        .filter((line) => line.trim())
        .map((line) => `[${timestamp}] ${prefix} ${line}`)
        .join('\n');

      if (formattedOutput) {
        fs.appendFileSync(logFile, formattedOutput + '\n');
      }
    }

    if (this.mainWindow) {
      this.mainWindow.webContents.send('supervisor:output', {
        projectId,
        processName,
        output,
        type,
        timestamp: new Date().toISOString(),
      });
    }
  },

  async getWorkerLogs(projectId, processName, lines = 200) {
    if (!this.logsPath) {
      return [];
    }

    const logFile = path.join(this.logsPath, `${projectId}-${processName}.log`);

    if (!await fs.pathExists(logFile)) {
      return [];
    }

    try {
      const content = await fs.readFile(logFile, 'utf8');
      const allLines = content.split('\n').filter((line) => line.trim());
      return allLines.slice(-lines);
    } catch (error) {
      this.managers.log?.systemError('Error reading worker logs', { error: error.message });
      return [];
    }
  },

  async clearWorkerLogs(projectId, processName) {
    if (!this.logsPath) {
      return { success: false, error: 'Logs path not initialized' };
    }

    const logFile = path.join(this.logsPath, `${projectId}-${processName}.log`);

    try {
      if (await fs.pathExists(logFile)) {
        await fs.remove(logFile);
      }
      return { success: true };
    } catch (error) {
      this.managers.log?.systemError('Error clearing worker logs', { error: error.message });
      return { success: false, error: error.message };
    }
  },

  async getAllWorkerLogsForProject(projectId, lines = 100) {
    const project = this.getProject(projectId);
    if (!project || !project.supervisor?.processes) {
      return {};
    }

    const logs = {};
    for (const process of project.supervisor.processes) {
      logs[process.name] = await this.getWorkerLogs(projectId, process.name, lines);
    }
    return logs;
  },
};