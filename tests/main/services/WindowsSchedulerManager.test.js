import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';
import childProcess from 'child_process';

const { WindowsSchedulerManager } = require('../../../src/main/services/WindowsSchedulerManager');

describe('WindowsSchedulerManager', () => {
  let mgr, configStore, tmpDir, execFileSpy;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sched-test-${Date.now()}`);
    await fs.ensureDir(tmpDir);
    vi.clearAllMocks();

    configStore = {
      getDataPath: () => tmpDir,
      get: vi.fn(),
      set: vi.fn(),
    };

    mgr = new WindowsSchedulerManager(tmpDir, configStore, {
      log: {
        systemInfo: vi.fn(),
        systemError: vi.fn(),
        systemWarn: vi.fn(),
      },
    });

    execFileSpy = vi.spyOn(childProcess, 'execFile');
  });

  afterEach(async () => {
    execFileSpy.mockRestore();
    await fs.remove(tmpDir).catch(() => {});
  });

  describe('task name & paths', () => {
    it('generates a clean sanitized task name', () => {
      expect(mgr.getTaskName('my-laravel-app')).toBe('DevBoxPro_Schedule_my-laravel-app');
      expect(mgr.getTaskName('proj@123!#')).toBe('DevBoxPro_Schedule_proj_123__');
    });

    it('resolves scheduler dir inside dataPath', async () => {
      const dir = await mgr.getSchedulerDir();
      expect(dir).toBe(path.join(tmpDir, 'scheduler'));
      expect(await fs.pathExists(dir)).toBe(true);
    });

    it('resolves PHP path based on project phpVersion', () => {
      const phpPath = mgr.getPhpPath({ phpVersion: '8.4' });
      expect(phpPath).toContain('8.4');
      if (process.platform === 'win32') {
        expect(phpPath).toContain('php.exe');
      }
    });
  });

  describe('generateRunnerScript', () => {
    it('generates a valid VBScript runner with hidden execution', async () => {
      const project = {
        id: 'proj-1',
        name: 'Laravel App',
        path: path.join(tmpDir, 'project'),
        phpVersion: '8.3',
      };
      await fs.ensureDir(project.path);

      const runnerPath = await mgr.generateRunnerScript(project);
      expect(await fs.pathExists(runnerPath)).toBe(true);

      const content = await fs.readFile(runnerPath, 'utf8');
      expect(content).toContain('WScript.Shell');
      expect(content).toContain('schedule:run');
      expect(content).toContain('0, False'); // Hidden execution
    });
  });

  describe('registerScheduleTask', () => {
    it('throws error when project or paths are missing', async () => {
      if (process.platform !== 'win32') return;

      await expect(mgr.registerScheduleTask(null)).rejects.toThrow();
      await expect(mgr.registerScheduleTask({ id: 'p1' })).rejects.toThrow();
    });

    it('invokes schtasks.exe with correct arguments', async () => {
      if (process.platform !== 'win32') return;

      const project = {
        id: 'proj-reg',
        name: 'Laravel App',
        path: path.join(tmpDir, 'project'),
        phpVersion: '8.3',
      };
      await fs.ensureDir(project.path);
      await fs.writeFile(path.join(project.path, 'artisan'), 'dummy artisan');

      // Create fake php.exe
      const phpPath = mgr.getPhpPath(project);
      await fs.ensureDir(path.dirname(phpPath));
      await fs.writeFile(phpPath, 'dummy php');

      execFileSpy.mockImplementation((cmd, args, cb) => {
        cb(null, 'SUCCESS: The scheduled task has successfully been created.', '');
      });

      const result = await mgr.registerScheduleTask(project);
      expect(result.success).toBe(true);
      expect(execFileSpy).toHaveBeenCalled();

      const [cmd, args] = execFileSpy.mock.calls[0];
      expect(cmd).toBe('schtasks.exe');
      expect(args).toContain('/create');
      expect(args).toContain('/sc');
      expect(args).toContain('minute');
      expect(args).toContain('/mo');
      expect(args).toContain('1');
    });
  });

  describe('unregisterScheduleTask', () => {
    it('invokes schtasks.exe /delete', async () => {
      if (process.platform !== 'win32') return;

      execFileSpy.mockImplementation((cmd, args, cb) => {
        cb(null, 'SUCCESS: deleted', '');
      });

      const result = await mgr.unregisterScheduleTask('proj-reg');
      expect(result.success).toBe(true);

      const [cmd, args] = execFileSpy.mock.calls[0];
      expect(cmd).toBe('schtasks.exe');
      expect(args).toContain('/delete');
      expect(args).toContain('/f');
    });
  });

  describe('getScheduleTaskStatus', () => {
    it('parses CSV output from schtasks /query correctly', async () => {
      if (process.platform !== 'win32') return;

      const mockCsv = `"HostName","TaskName","Next Run Time","Status","Logon Mode","Last Run Time","Last Result","Author"\n"PC","\\DevBoxPro_Schedule_proj1","Sep 11, 2026 2:15:00 AM","Ready","Interactive only","Sep 11, 2026 2:14:00 AM","0","Author"`;

      execFileSpy.mockImplementation((cmd, args, cb) => {
        cb(null, mockCsv, '');
      });

      const status = await mgr.getScheduleTaskStatus('proj1');
      expect(status.exists).toBe(true);
      expect(status.status).toBe('Ready');
      expect(status.nextRunTime).toContain('2:15:00 AM');
      expect(status.lastResult).toBe('0');
    });

    it('returns not configured when query fails', async () => {
      if (process.platform !== 'win32') return;

      execFileSpy.mockImplementation((cmd, args, cb) => {
        cb(new Error('ERROR: The system cannot find the file specified.'), '', 'ERROR');
      });

      const status = await mgr.getScheduleTaskStatus('proj-nonexistent');
      expect(status.exists).toBe(false);
      expect(status.status).toBe('Not Configured');
    });
  });
});
