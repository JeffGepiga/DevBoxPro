/**
 * Tests for src/main/services/SupervisorManager.js
 *
 * Phase 3.8 – Tests for process management, status tracking, log helpers,
 * and queue/schedule/horizon worker factories.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

// ── Mock child_process ────────────────────────────────────────────────────────
vi.mock('child_process', () => {
    const stdout = { on: vi.fn() };
    const stderr = { on: vi.fn() };
    const mockProcess = { pid: 999, stdout, stderr, on: vi.fn(), unref: vi.fn() };
    return { spawn: vi.fn(() => mockProcess) };
});

vi.mock('tree-kill', () => ({
    default: vi.fn((_pid, _signal, cb) => cb && cb()),
}));

const fs = require('fs-extra');
require('../../helpers/mockElectronCjs');
const { SupervisorManager } = require('../../../src/main/services/SupervisorManager');

// ─────────────────────────────────────────────────────────────────────────────

function makeProject(id, processes = []) {
    return {
        id,
        name: 'Test Project',
        path: '/projects/test',
        phpVersion: '8.3',
        environment: {},
        supervisor: { processes },
    };
}

function makeConfigStore(projects = []) {
    let store = { projects };
    return {
        get: vi.fn((key, def) => key in store ? store[key] : def),
        set: vi.fn((key, val) => { store[key] = val; }),
        _getStore: () => store,
    };
}

describe('SupervisorManager', () => {
    let mgr, configStore, tmpDir;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `sv-test-${Date.now()}`);
        await fs.ensureDir(tmpDir);
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await fs.remove(tmpDir).catch(() => { });
    });

    function createMgr(projects = []) {
        configStore = makeConfigStore(projects);
        const m = new SupervisorManager('/resources', configStore, {});
        m.logsPath = tmpDir; // set manually so initialize() is not needed
        return m;
    }

    // ═══════════════════════════════════════════════════════════════════
    // constructor
    // ═══════════════════════════════════════════════════════════════════

    describe('constructor', () => {
        it('sets up empty processes Map', () => {
            mgr = createMgr();
            expect(mgr.processes.size).toBe(0);
        });

        it('logsPath is null initially before initialize()', () => {
            configStore = makeConfigStore();
            const m = new SupervisorManager('/resources', configStore, {});
            expect(m.logsPath).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // setMainWindow()
    // ═══════════════════════════════════════════════════════════════════

    describe('setMainWindow()', () => {
        it('stores the main window reference', () => {
            mgr = createMgr();
            const win = { webContents: { send: vi.fn() } };
            mgr.setMainWindow(win);
            expect(mgr.mainWindow).toBe(win);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getProject()
    // ═══════════════════════════════════════════════════════════════════

    describe('getProject()', () => {
        it('returns project by id', () => {
            const proj = makeProject('p1');
            mgr = createMgr([proj]);
            expect(mgr.getProject('p1')).toMatchObject({ id: 'p1' });
        });

        it('returns undefined when not found', () => {
            mgr = createMgr([]);
            expect(mgr.getProject('nonexistent')).toBeUndefined();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // addProcess()
    // ═══════════════════════════════════════════════════════════════════

    describe('addProcess()', () => {
        it('adds process config to project', async () => {
            const proj = makeProject('p1');
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            const result = await mgr.addProcess('p1', {
                name: 'queue-worker',
                command: 'php artisan queue:work',
            });

            expect(result.name).toBe('queue-worker');
            expect(result.status).toBe('stopped');
        });

        it('throws when project not found', async () => {
            mgr = createMgr([]);
            await expect(mgr.addProcess('nonexistent', { name: 'worker', command: 'cmd' }))
                .rejects.toThrow('Project not found');
        });

        it('updates existing process with same name', async () => {
            const existingProcess = { name: 'worker', command: 'old-cmd', status: 'stopped', pid: null, startedAt: null };
            const proj = makeProject('p1', [existingProcess]);
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            await mgr.addProcess('p1', { name: 'worker', command: 'new-cmd' });

            expect(configStore.set).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // stopProcess() / stopAllProcesses()
    // ═══════════════════════════════════════════════════════════════════

    describe('stopProcess()', () => {
        it('returns wasRunning: false when project has no processes', async () => {
            mgr = createMgr([]);
            const result = await mgr.stopProcess('p1', 'worker');
            expect(result.wasRunning).toBe(false);
        });

        it('returns wasRunning: false when process not in map', async () => {
            mgr = createMgr([]);
            mgr.processes.set('p1', new Map());
            const result = await mgr.stopProcess('p1', 'nonexistent');
            expect(result.wasRunning).toBe(false);
        });

        it('kills process instances and removes from map', async () => {
            const treeKill = require('tree-kill').default;
            const proj = makeProject('p1', [{ name: 'worker', command: 'cmd', status: 'running', pid: 999, startedAt: null }]);
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            mgr.processes.set('p1', new Map([
                ['worker', {
                    config: { name: 'worker', autorestart: false },
                    instances: [{ pid: 999, process: {}, name: 'worker' }],
                    startedAt: new Date(),
                }],
            ]));

            const result = await mgr.stopProcess('p1', 'worker');
            expect(result.wasRunning).toBe(true);
            expect(treeKill).toHaveBeenCalledWith(999, 'SIGTERM', expect.any(Function));
        });
    });

    describe('stopAllProcesses()', () => {
        it('returns success true with zero count when nothing running', async () => {
            mgr = createMgr([]);
            const result = await mgr.stopAllProcesses('p1');
            expect(result.success).toBe(true);
        });

        it('stops all processes for a project', async () => {
            const proj = makeProject('p1', [
                { name: 'w1', command: 'cmd', status: 'stopped', pid: null, startedAt: null },
                { name: 'w2', command: 'cmd', status: 'stopped', pid: null, startedAt: null },
            ]);
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            mgr.processes.set('p1', new Map([
                ['w1', { config: { name: 'w1', autorestart: false }, instances: [], startedAt: new Date() }],
                ['w2', { config: { name: 'w2', autorestart: false }, instances: [], startedAt: new Date() }],
            ]));

            const result = await mgr.stopAllProcesses('p1');
            expect(result.stopped).toBe(2);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getProcessStatus()
    // ═══════════════════════════════════════════════════════════════════

    describe('getProcessStatus()', () => {
        it('returns stopped status when no processes', () => {
            mgr = createMgr([]);
            const result = mgr.getProcessStatus('p1', 'worker');
            expect(result).toEqual({ status: 'stopped', isRunning: false });
        });

        it('returns running status with instances and uptime', () => {
            mgr = createMgr([]);
            mgr.processes.set('p1', new Map([
                ['worker', {
                    config: { name: 'worker' },
                    instances: [{ pid: 100, name: 'worker', process: {} }],
                    startedAt: new Date(Date.now() - 5000),
                }],
            ]));

            const result = mgr.getProcessStatus('p1', 'worker');
            expect(result.status).toBe('running');
            expect(result.isRunning).toBe(true);
            expect(result.instances).toBe(1);
            expect(result.uptime).toBeGreaterThan(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getProcesses()
    // ═══════════════════════════════════════════════════════════════════

    describe('getProcesses()', () => {
        it('returns empty array when project not found', () => {
            mgr = createMgr([]);
            expect(mgr.getProcesses('nonexistent')).toEqual([]);
        });

        it('returns process list with isRunning flags', () => {
            const pConfig = { name: 'worker', command: 'cmd', status: 'stopped', autorestart: true };
            const proj = makeProject('p1', [pConfig]);
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            // Mark process as running
            mgr.processes.set('p1', new Map([
                ['worker', { config: pConfig, instances: [{ pid: 50 }], startedAt: new Date() }],
            ]));

            const processes = mgr.getProcesses('p1');
            expect(processes).toHaveLength(1);
            expect(processes[0].isRunning).toBe(true);
            expect(processes[0].instances).toBe(1);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // logOutput() / getWorkerLogs() / clearWorkerLogs()
    // ═══════════════════════════════════════════════════════════════════

    describe('logOutput()', () => {
        it('writes output to log file', () => {
            mgr = createMgr([]);
            mgr.logOutput('p1', 'worker', 'Hello from worker\n', 'stdout');
            const logFile = path.join(tmpDir, 'p1-worker.log');
            const content = require('fs').readFileSync(logFile, 'utf-8');
            expect(content).toContain('[OUT]');
            expect(content).toContain('Hello from worker');
        });

        it('sends to mainWindow if set', () => {
            mgr = createMgr([]);
            const send = vi.fn();
            mgr.mainWindow = { webContents: { send } };
            mgr.logOutput('p1', 'worker', 'output\n', 'stdout');
            expect(send).toHaveBeenCalledWith('supervisor:output', expect.objectContaining({
                projectId: 'p1',
                processName: 'worker',
            }));
        });

        it('does not crash when logsPath is null', () => {
            mgr = createMgr([]);
            mgr.logsPath = null;
            expect(() => mgr.logOutput('p1', 'worker', 'test\n', 'stdout')).not.toThrow();
        });
    });

    describe('getWorkerLogs()', () => {
        it('returns empty array when logsPath is null', async () => {
            mgr = createMgr([]);
            mgr.logsPath = null;
            const result = await mgr.getWorkerLogs('p1', 'worker');
            expect(result).toEqual([]);
        });

        it('returns empty array when log file does not exist', async () => {
            mgr = createMgr([]);
            const result = await mgr.getWorkerLogs('p1', 'nonexistent-worker');
            expect(result).toEqual([]);
        });

        it('returns last N lines of log file', async () => {
            mgr = createMgr([]);
            const logFile = path.join(tmpDir, 'p1-worker.log');
            const lines = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n');
            await fs.writeFile(logFile, lines);

            const result = await mgr.getWorkerLogs('p1', 'worker', 3);
            expect(result).toHaveLength(3);
            expect(result[result.length - 1]).toContain('Line 9');
        });
    });

    describe('clearWorkerLogs()', () => {
        it('returns error when logsPath is null', async () => {
            mgr = createMgr([]);
            mgr.logsPath = null;
            const result = await mgr.clearWorkerLogs('p1', 'worker');
            expect(result.success).toBe(false);
        });

        it('deletes log file if it exists', async () => {
            mgr = createMgr([]);
            const logFile = path.join(tmpDir, 'p1-worker.log');
            await fs.writeFile(logFile, 'some logs');

            const result = await mgr.clearWorkerLogs('p1', 'worker');
            expect(result.success).toBe(true);
            expect(await fs.pathExists(logFile)).toBe(false);
        });

        it('succeeds even if log file does not exist', async () => {
            mgr = createMgr([]);
            const result = await mgr.clearWorkerLogs('p1', 'nonexistent');
            expect(result.success).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Queue worker helpers
    // ═══════════════════════════════════════════════════════════════════

    describe('createQueueWorker()', () => {
        it('creates process config with queue:work command', async () => {
            const proj = makeProject('p1');
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            const result = await mgr.createQueueWorker('p1', { name: 'queue-worker' });
            expect(result.command).toContain('queue:work');
        });

        it('uses default name queue-worker', async () => {
            const proj = makeProject('p1');
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            const result = await mgr.createQueueWorker('p1', {});
            expect(result.name).toBe('queue-worker');
        });
    });

    describe('createScheduleWorker()', () => {
        it('creates process config with schedule:work command', async () => {
            const proj = makeProject('p1');
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            const result = await mgr.createScheduleWorker('p1');
            expect(result.name).toBe('schedule-runner');
            expect(result.command).toContain('schedule:work');
        });
    });

    describe('createHorizonWorker()', () => {
        it('creates process config with horizon command', async () => {
            const proj = makeProject('p1');
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            const result = await mgr.createHorizonWorker('p1');
            expect(result.name).toBe('horizon');
            expect(result.command).toContain('horizon');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getAllWorkerLogsForProject()
    // ═══════════════════════════════════════════════════════════════════

    describe('getAllWorkerLogsForProject()', () => {
        it('returns empty object when project not found', async () => {
            mgr = createMgr([]);
            const result = await mgr.getAllWorkerLogsForProject('nonexistent');
            expect(result).toEqual({});
        });

        it('returns log map for each process', async () => {
            const p1 = { name: 'w1', command: 'cmd', status: 'stopped', pid: null, startedAt: null };
            const proj = makeProject('p1', [p1]);
            mgr = createMgr([proj]);
            configStore.get.mockReturnValue([proj]);

            // Write a log
            await fs.writeFile(path.join(tmpDir, 'p1-w1.log'), 'Line 1\nLine 2\n');

            const result = await mgr.getAllWorkerLogsForProject('p1');
            expect(result).toHaveProperty('w1');
            expect(result['w1'].length).toBeGreaterThan(0);
        });
    });
});
