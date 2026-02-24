/**
 * Tests for src/main/services/LogManager.js
 *
 * Phase 3 – LogManager tests using temp directories.
 * Bypasses Electron's app.getPath by manually setting logsPath.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

const fs = require('fs-extra');
require('../../helpers/mockElectronCjs');
const { LogManager } = require('../../../src/main/services/LogManager');

describe('LogManager', () => {
    let logManager;
    let tmpDir;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `logmgr-test-${Date.now()}`);
        await fs.ensureDir(tmpDir);

        // Create LogManager with a mock configStore, then manually set logsPath
        logManager = new LogManager({});
        logManager.logsPath = tmpDir;
        await fs.ensureDir(path.join(tmpDir, 'projects'));
        await fs.ensureDir(path.join(tmpDir, 'services'));
    });

    afterEach(async () => {
        // Stop any watchers
        for (const [id] of logManager.watchers) {
            logManager.stopStreaming(id);
        }
        await fs.remove(tmpDir).catch(() => { });
    });

    // ═══════════════════════════════════════════════════════════════════
    // formatLogEntry()
    // ═══════════════════════════════════════════════════════════════════

    describe('formatLogEntry()', () => {
        it('includes timestamp, level, and message', () => {
            const entry = logManager.formatLogEntry('info', 'Server started');
            expect(entry).toMatch(/^\[.+\] \[INFO\] Server started$/);
        });

        it('serializes object data as JSON', () => {
            const entry = logManager.formatLogEntry('error', 'Failed', { code: 500 });
            expect(entry).toContain('[ERROR]');
            expect(entry).toContain('Failed');
            expect(entry).toContain('{"code":500}');
        });

        it('appends string data directly', () => {
            const entry = logManager.formatLogEntry('warn', 'Issue', 'extra info');
            expect(entry).toContain('[WARN]');
            expect(entry).toContain('extra info');
        });

        it('handles null data (no extra output)', () => {
            const entry = logManager.formatLogEntry('debug', 'Trace', null);
            expect(entry).toMatch(/\[DEBUG\] Trace$/);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // parseLogEntry()
    // ═══════════════════════════════════════════════════════════════════

    describe('parseLogEntry()', () => {
        it('parses valid log line', () => {
            const parsed = logManager.parseLogEntry(
                '[2025-01-15T10:30:00.000Z] [ERROR] Something went wrong'
            );
            expect(parsed.timestamp).toBe('2025-01-15T10:30:00.000Z');
            expect(parsed.level).toBe('error');
            expect(parsed.message).toBe('Something went wrong');
        });

        it('handles malformed line (returns as info)', () => {
            const parsed = logManager.parseLogEntry('just some text');
            expect(parsed.level).toBe('info');
            expect(parsed.message).toBe('just some text');
        });

        it('handles empty string', () => {
            const parsed = logManager.parseLogEntry('');
            expect(parsed.level).toBe('info');
            expect(parsed.message).toBe('');
        });

        it('handles line with special characters', () => {
            const parsed = logManager.parseLogEntry(
                '[2025-01-15T10:30:00Z] [WARN] Path C:\\Users\\test has spaces & symbols!'
            );
            expect(parsed.level).toBe('warn');
            expect(parsed.message).toContain('C:\\Users\\test');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // writeLog() + appendToLog()
    // ═══════════════════════════════════════════════════════════════════

    describe('writeLog()', () => {
        it('writes to app.log for app category', async () => {
            logManager.writeLog('app', 'info', 'Test message', null);
            // Wait for async file write
            await new Promise((r) => setTimeout(r, 100));
            const logFile = path.join(tmpDir, 'app.log');
            const content = await fs.readFile(logFile, 'utf-8');
            expect(content).toContain('[INFO]');
            expect(content).toContain('Test message');
        });

        it('writes to system.log for system category', async () => {
            logManager.writeLog('system', 'error', 'Critical failure', null);
            await new Promise((r) => setTimeout(r, 100));
            const logFile = path.join(tmpDir, 'system.log');
            const content = await fs.readFile(logFile, 'utf-8');
            expect(content).toContain('[ERROR]');
            expect(content).toContain('Critical failure');
        });

        it('emits log event', async () => {
            const listener = vi.fn();
            logManager.on('log', listener);
            logManager.writeLog('app', 'info', 'Event test', null);
            await new Promise((r) => setTimeout(r, 50));
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'app',
                    level: 'info',
                    message: 'Event test',
                })
            );
        });

        it('falls back to console when logsPath is null', () => {
            logManager.logsPath = null;
            const spy = vi.spyOn(console, 'log').mockImplementation(() => { });
            logManager.writeLog('app', 'info', 'Console fallback', null);
            expect(spy).toHaveBeenCalled();
            spy.mockRestore();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Log convenience methods
    // ═══════════════════════════════════════════════════════════════════

    describe('convenience log methods', () => {
        it('info() writes with level info', async () => {
            logManager.info('Info message');
            await new Promise((r) => setTimeout(r, 100));
            const content = await fs.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
            expect(content).toContain('[INFO]');
        });

        it('warn() writes with level warn', async () => {
            logManager.warn('Warn message');
            await new Promise((r) => setTimeout(r, 100));
            const content = await fs.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
            expect(content).toContain('[WARN]');
        });

        it('error() writes with level error', async () => {
            logManager.error('Error message');
            await new Promise((r) => setTimeout(r, 100));
            const content = await fs.readFile(path.join(tmpDir, 'app.log'), 'utf-8');
            expect(content).toContain('[ERROR]');
        });

        it('systemError() writes to system category', async () => {
            logManager.systemError('System critical');
            await new Promise((r) => setTimeout(r, 100));
            const content = await fs.readFile(path.join(tmpDir, 'system.log'), 'utf-8');
            expect(content).toContain('[ERROR]');
            expect(content).toContain('System critical');
        });

        it('systemInfo() writes to system category', async () => {
            logManager.systemInfo('System info');
            await new Promise((r) => setTimeout(r, 100));
            const content = await fs.readFile(path.join(tmpDir, 'system.log'), 'utf-8');
            expect(content).toContain('[INFO]');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // project() and service()
    // ═══════════════════════════════════════════════════════════════════

    describe('project()', () => {
        it('writes to per-project log file', async () => {
            logManager.project('my-project', 'Started');
            await new Promise((r) => setTimeout(r, 100));
            const logFile = path.join(tmpDir, 'projects', 'my-project.log');
            expect(await fs.pathExists(logFile)).toBe(true);
            const content = await fs.readFile(logFile, 'utf-8');
            expect(content).toContain('Started');
        });

        it('emits log event with project type', () => {
            const listener = vi.fn();
            logManager.on('log', listener);
            logManager.project('proj-1', 'Test', 'warn');
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'project',
                    projectId: 'proj-1',
                    level: 'warn',
                })
            );
        });
    });

    describe('service()', () => {
        it('writes to per-service log file', async () => {
            logManager.service('nginx', 'Restarted');
            await new Promise((r) => setTimeout(r, 100));
            const logFile = path.join(tmpDir, 'services', 'nginx.log');
            expect(await fs.pathExists(logFile)).toBe(true);
        });

        it('emits log event with service type', () => {
            const listener = vi.fn();
            logManager.on('log', listener);
            logManager.service('mysql', 'Stopped', 'error');
            expect(listener).toHaveBeenCalledWith(
                expect.objectContaining({
                    type: 'service',
                    service: 'mysql',
                    level: 'error',
                })
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // readLastLines()
    // ═══════════════════════════════════════════════════════════════════

    describe('readLastLines()', () => {
        it('returns last N lines from file', async () => {
            const logFile = path.join(tmpDir, 'test.log');
            const lines = Array.from({ length: 20 }, (_, i) => `Line ${i + 1}`);
            await fs.writeFile(logFile, lines.join('\n'));

            const result = await logManager.readLastLines(logFile, 5);
            expect(result).toHaveLength(5);
            expect(result[0]).toBe('Line 16');
            expect(result[4]).toBe('Line 20');
        });

        it('returns empty array when file does not exist', async () => {
            const result = await logManager.readLastLines('/nonexistent/file.log', 10);
            expect(result).toEqual([]);
        });

        it('returns all lines when file has fewer than requested', async () => {
            const logFile = path.join(tmpDir, 'small.log');
            await fs.writeFile(logFile, 'Line 1\nLine 2');
            const result = await logManager.readLastLines(logFile, 100);
            expect(result).toHaveLength(2);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getProjectLogs / getServiceLogs / getAppLogs / getSystemLogs
    // ═══════════════════════════════════════════════════════════════════

    describe('log retrieval methods', () => {
        it('getProjectLogs() reads from correct file', async () => {
            const logFile = path.join(tmpDir, 'projects', 'proj-1.log');
            await fs.writeFile(logFile, '[ts] [INFO] test\n');
            const lines = await logManager.getProjectLogs('proj-1');
            expect(lines.length).toBeGreaterThan(0);
        });

        it('getServiceLogs() reads from correct file', async () => {
            const logFile = path.join(tmpDir, 'services', 'mysql.log');
            await fs.writeFile(logFile, '[ts] [INFO] started\n');
            const lines = await logManager.getServiceLogs('mysql');
            expect(lines.length).toBeGreaterThan(0);
        });

        it('getAppLogs() reads from app.log', async () => {
            await fs.writeFile(path.join(tmpDir, 'app.log'), '[ts] [INFO] boot\n');
            const lines = await logManager.getAppLogs();
            expect(lines.length).toBeGreaterThan(0);
        });

        it('getSystemLogs() reads from system.log', async () => {
            await fs.writeFile(path.join(tmpDir, 'system.log'), '[ts] [ERROR] crash\n');
            const lines = await logManager.getSystemLogs();
            expect(lines.length).toBeGreaterThan(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // clearProjectLogs / clearServiceLogs / clearSystemLogs
    // ═══════════════════════════════════════════════════════════════════

    describe('clear logs', () => {
        it('clearProjectLogs() empties the file', async () => {
            const logFile = path.join(tmpDir, 'projects', 'proj-1.log');
            await fs.writeFile(logFile, 'some content');
            const result = await logManager.clearProjectLogs('proj-1');
            expect(result).toEqual({ success: true });
            const content = await fs.readFile(logFile, 'utf-8');
            expect(content).toBe('');
        });

        it('clearServiceLogs() empties the file', async () => {
            const logFile = path.join(tmpDir, 'services', 'nginx.log');
            await fs.writeFile(logFile, 'data');
            const result = await logManager.clearServiceLogs('nginx');
            expect(result).toEqual({ success: true });
            expect(await fs.readFile(logFile, 'utf-8')).toBe('');
        });

        it('clearSystemLogs() empties the file', async () => {
            const logFile = path.join(tmpDir, 'system.log');
            await fs.writeFile(logFile, 'data');
            const result = await logManager.clearSystemLogs();
            expect(result).toEqual({ success: true });
            expect(await fs.readFile(logFile, 'utf-8')).toBe('');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // rotateLogIfNeeded()
    // ═══════════════════════════════════════════════════════════════════

    describe('rotateLogIfNeeded()', () => {
        it('does not rotate when file is small', async () => {
            const logFile = path.join(tmpDir, 'small.log');
            await fs.writeFile(logFile, 'small content');
            await logManager.rotateLogIfNeeded(logFile);
            // Original should still exist
            expect(await fs.pathExists(logFile)).toBe(true);
            expect(await fs.pathExists(`${logFile}.1`)).toBe(false);
        });

        it('rotates when file exceeds maxLogSize', async () => {
            logManager.maxLogSize = 100; // Lower threshold for testing
            const logFile = path.join(tmpDir, 'big.log');
            await fs.writeFile(logFile, 'x'.repeat(200));
            await logManager.rotateLogIfNeeded(logFile);
            expect(await fs.pathExists(`${logFile}.1`)).toBe(true);
        });

        it('handles non-existent file gracefully', async () => {
            await expect(
                logManager.rotateLogIfNeeded('/nonexistent/file.log')
            ).resolves.toBeUndefined();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getAllLogs()
    // ═══════════════════════════════════════════════════════════════════

    describe('getAllLogs()', () => {
        it('combines project and service logs', async () => {
            await fs.writeFile(
                path.join(tmpDir, 'projects', 'proj-1.log'),
                '[2025-01-01T00:00:00Z] [INFO] Project log\n'
            );
            await fs.writeFile(
                path.join(tmpDir, 'services', 'mysql.log'),
                '[2025-01-01T00:01:00Z] [WARN] Service log\n'
            );
            const all = await logManager.getAllLogs();
            expect(all.length).toBe(2);
            expect(all.some((l) => l.type === 'project')).toBe(true);
            expect(all.some((l) => l.type === 'service')).toBe(true);
        });

        it('filters by level', async () => {
            await fs.writeFile(
                path.join(tmpDir, 'projects', 'p.log'),
                '[2025-01-01T00:00:00Z] [INFO] info\n[2025-01-01T00:00:01Z] [ERROR] error\n'
            );
            const errors = await logManager.getAllLogs({ level: 'error' });
            expect(errors.every((l) => l.level === 'error')).toBe(true);
        });

        it('respects limit', async () => {
            const lines = Array.from({ length: 10 }, (_, i) =>
                `[2025-01-${String(i + 1).padStart(2, '0')}T00:00:00Z] [INFO] Line ${i}`
            );
            await fs.writeFile(
                path.join(tmpDir, 'projects', 'many.log'),
                lines.join('\n') + '\n'
            );
            const result = await logManager.getAllLogs({ limit: 3 });
            expect(result.length).toBeLessThanOrEqual(3);
        });

        it('returns empty when no logs exist', async () => {
            // Remove the dirs and recreate empty
            await fs.remove(path.join(tmpDir, 'projects'));
            await fs.remove(path.join(tmpDir, 'services'));
            const result = await logManager.getAllLogs();
            expect(result).toEqual([]);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // stopStreaming()
    // ═══════════════════════════════════════════════════════════════════

    describe('stopStreaming()', () => {
        it('does nothing when no watcher exists', () => {
            expect(() => logManager.stopStreaming('nonexistent')).not.toThrow();
        });
    });
});
