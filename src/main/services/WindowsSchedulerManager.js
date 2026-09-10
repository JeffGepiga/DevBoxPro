const path = require('path');
const fs = require('fs-extra');
const childProcess = require('child_process');

class WindowsSchedulerManager {
  constructor(resourcePath, configStore, managers = {}) {
    this.resourcePath = resourcePath;
    this.configStore = configStore;
    this.managers = managers;
  }

  isWindows() {
    return process.platform === 'win32';
  }

  sanitizeId(id) {
    return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  getTaskName(projectId) {
    return `DevBoxPro_Schedule_${this.sanitizeId(projectId)}`;
  }

  async getSchedulerDir() {
    const dataPath = this.configStore?.getDataPath ? this.configStore.getDataPath() : path.join(process.cwd(), '.devbox');
    const dir = path.join(dataPath, 'scheduler');
    await fs.ensureDir(dir);
    return dir;
  }

  getPhpPath(project) {
    const phpVersion = project?.phpVersion || '8.3';
    const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';
    const phpExe = process.platform === 'win32' ? 'php.exe' : 'php';
    return path.join(this.resourcePath, 'php', phpVersion, platform, phpExe);
  }

  async getRunnerScriptPath(projectId) {
    const dir = await this.getSchedulerDir();
    return path.join(dir, `${this.sanitizeId(projectId)}-cron.vbs`);
  }

  async getLogFilePath(projectId) {
    const dir = await this.getSchedulerDir();
    return path.join(dir, `${this.sanitizeId(projectId)}-cron.log`);
  }

  /**
   * Generates a silent VBScript runner that launches `php artisan schedule:run`
   * with a hidden window so no command prompt flashes on screen.
   */
  async generateRunnerScript(project) {
    const runnerPath = await this.getRunnerScriptPath(project.id);
    const logPath = await this.getLogFilePath(project.id);
    const phpPath = this.getPhpPath(project);
    const projectPath = project.path;

    // Sanitize quotes for VBScript strings (in VBScript, double quote inside literal is escaped as "")
    const cleanProject = String(projectPath).replace(/"/g, '""');
    const cleanPhp = String(phpPath).replace(/"/g, '""');
    const cleanLog = String(logPath).replace(/"/g, '""');

    // In VBScript, concatenate double quote character """ & path & """
    // to produce: cmd.exe /c "C:\path\php.exe" artisan schedule:run >> "C:\path\cron.log" 2>&1
    const vbsContent = [
      'On Error Resume Next',
      'Set WshShell = CreateObject("WScript.Shell")',
      `WshShell.CurrentDirectory = "${cleanProject}"`,
      `cmd = "cmd.exe /c """ & "${cleanPhp}" & """ artisan schedule:run >> """ & "${cleanLog}" & """ 2>&1"`,
      'WshShell.Run cmd, 0, False',
      'Set WshShell = Nothing',
    ].join('\r\n');

    await fs.writeFile(runnerPath, vbsContent, 'utf8');
    return runnerPath;
  }

  /**
   * Register a scheduled task in Windows Task Scheduler running every 1 minute.
   */
  async registerScheduleTask(project) {
    if (!this.isWindows()) {
      return { success: false, reason: 'Windows Task Scheduler is only supported on Windows' };
    }

    if (!project || !project.id || !project.path) {
      throw new Error('Project with valid id and path is required');
    }

    const phpPath = this.getPhpPath(project);
    if (!await fs.pathExists(phpPath)) {
      throw new Error(`PHP executable not found for PHP ${project.phpVersion} at ${phpPath}`);
    }

    const artisanPath = path.join(project.path, 'artisan');
    if (!await fs.pathExists(artisanPath)) {
      throw new Error(`Laravel artisan file not found at ${artisanPath}`);
    }

    const runnerPath = await this.generateRunnerScript(project);
    const taskName = this.getTaskName(project.id);

    return new Promise((resolve, reject) => {
      // /sc minute /mo 1 runs every 1 minute; /f forces overwrite if exists
      childProcess.execFile('schtasks.exe', [
        '/create',
        '/tn', taskName,
        '/tr', `wscript.exe "${runnerPath}"`,
        '/sc', 'minute',
        '/mo', '1',
        '/f',
      ], (error, stdout, stderr) => {
        if (error) {
          this.managers.log?.systemError(`Failed to register Windows scheduled task for ${project.name}`, {
            error: error.message,
            stderr,
          });
          return reject(new Error(`Failed to create Windows Scheduled Task: ${stderr || error.message}`));
        }

        this.managers.log?.systemInfo(`Registered Windows Scheduled Task "${taskName}" for ${project.name}`);
        resolve({ success: true, taskName });
      });
    });
  }

  /**
   * Unregister / delete the scheduled task from Windows Task Scheduler.
   */
  async unregisterScheduleTask(projectId) {
    if (!this.isWindows()) {
      return { success: true };
    }

    const taskName = this.getTaskName(projectId);
    const runnerPath = await this.getRunnerScriptPath(projectId);

    return new Promise((resolve) => {
      childProcess.execFile('schtasks.exe', ['/delete', '/tn', taskName, '/f'], async (error) => {
        // Clean up runner script
        try {
          if (await fs.pathExists(runnerPath)) {
            await fs.remove(runnerPath);
          }
        } catch {
          // ignore cleanup errors
        }

        if (error) {
          // Task might not exist, which is fine
          return resolve({ success: true, wasDeleted: false });
        }

        this.managers.log?.systemInfo(`Deleted Windows Scheduled Task "${taskName}"`);
        resolve({ success: true, wasDeleted: true });
      });
    });
  }

  /**
   * Trigger immediate execution of the scheduled task.
   */
  async runScheduleTaskNow(projectId) {
    if (!this.isWindows()) {
      return { success: false, reason: 'Only supported on Windows' };
    }

    const taskName = this.getTaskName(projectId);
    return new Promise((resolve, reject) => {
      childProcess.execFile('schtasks.exe', ['/run', '/tn', taskName], (error, stdout, stderr) => {
        if (error) {
          return reject(new Error(`Failed to run scheduled task: ${stderr || error.message}`));
        }
        resolve({ success: true, output: stdout });
      });
    });
  }

  /**
   * Query status, last run time, next run time, and last result from Windows Task Scheduler.
   */
  async getScheduleTaskStatus(projectId) {
    if (!this.isWindows()) {
      return { exists: false, isWindows: false };
    }

    const taskName = this.getTaskName(projectId);
    const logPath = await this.getLogFilePath(projectId);

    return new Promise((resolve) => {
      childProcess.execFile('schtasks.exe', ['/query', '/tn', taskName, '/fo', 'CSV', '/v'], async (error, stdout) => {
        let logLines = [];
        try {
          if (await fs.pathExists(logPath)) {
            const content = await fs.readFile(logPath, 'utf8');
            logLines = content.split('\n').filter((l) => l.trim()).slice(-50);
          }
        } catch {
          // ignore
        }

        if (error) {
          return resolve({
            exists: false,
            taskName,
            isWindows: true,
            status: 'Not Configured',
            logLines,
          });
        }

        try {
          // Parse CSV
          const lines = stdout.trim().split(/\r?\n/);
          if (lines.length >= 2) {
            const parseCSVLine = (line) => {
              const entries = [];
              let current = '';
              let inQuote = false;
              for (let i = 0; i < line.length; i++) {
                const c = line[i];
                if (c === '"') {
                  inQuote = !inQuote;
                } else if (c === ',' && !inQuote) {
                  entries.push(current.trim());
                  current = '';
                } else {
                  current += c;
                }
              }
              entries.push(current.trim());
              return entries;
            };

            const headers = parseCSVLine(lines[0]);
            const values = parseCSVLine(lines[1]);
            const record = {};
            headers.forEach((h, idx) => {
              record[h] = values[idx] || '';
            });

            return resolve({
              exists: true,
              isWindows: true,
              taskName,
              status: record['Status'] || record['Scheduled Task State'] || 'Ready',
              nextRunTime: record['Next Run Time'] || 'N/A',
              lastRunTime: record['Last Run Time'] || 'N/A',
              lastResult: record['Last Result'] || '0',
              author: record['Author'] || '',
              logLines,
            });
          }
        } catch (parseErr) {
          // fallback
        }

        resolve({
          exists: true,
          isWindows: true,
          taskName,
          status: 'Active',
          nextRunTime: 'Every 1 minute',
          lastRunTime: 'N/A',
          lastResult: '0',
          logLines,
        });
      });
    });
  }

  /**
   * Clear cron logs for a project.
   */
  async clearScheduleLogs(projectId) {
    const logPath = await this.getLogFilePath(projectId);
    try {
      if (await fs.pathExists(logPath)) {
        await fs.writeFile(logPath, '', 'utf8');
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
}

module.exports = { WindowsSchedulerManager };
