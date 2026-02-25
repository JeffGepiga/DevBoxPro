/**
 * Tests for src/main/services/ServiceManager.js
 *
 * Phase 3.10 – Tests for service execution, multi-version tracking,
 * port mapping, process lifecycle, and orchestration (start/stop all).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

vi.mock('child_process', () => {
    const stdout = { on: vi.fn() };
    const stderr = { on: vi.fn() };
    const mockProcess = {
        pid: 1234,
        stdout,
        stderr,
        on: vi.fn((event, cb) => {
            // we won't auto-trigger exit/close so processes appear "running"
        }),
        unref: vi.fn()
    };
    return {
        spawn: vi.fn(() => mockProcess),
        exec: vi.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' })),
        execFile: vi.fn((file, args, cb) => cb(null, { stdout: '', stderr: '' }))
    };
});

const mockTreeKill = vi.fn((_pid, _signal, cb) => cb && cb());
require('module')._cache[require.resolve('tree-kill')] = {
    id: require.resolve('tree-kill'),
    filename: require.resolve('tree-kill'),
    loaded: true,
    exports: mockTreeKill
};

const fs = require('fs-extra');
vi.mock('fs-extra', () => ({
    ensureDir: vi.fn().mockResolvedValue(),
    ensureDirSync: vi.fn(),
    pathExists: vi.fn().mockResolvedValue(true),
    pathExistsSync: vi.fn().mockReturnValue(true),
    readFile: vi.fn().mockResolvedValue('user=root\npassword=root'),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFile: vi.fn().mockResolvedValue(),
    writeFileSync: vi.fn(),
    copy: vi.fn().mockResolvedValue(),
    remove: vi.fn().mockResolvedValue()
}));

vi.mock('../../../src/main/utils/PortUtils', () => ({
    isPortAvailable: vi.fn().mockResolvedValue(true),
    findAvailablePort: vi.fn().mockResolvedValue(9999)
}));

require('../../helpers/mockElectronCjs');
const { ServiceManager } = require('../../../src/main/services/ServiceManager');

function makeConfigStore() {
    let store = {
        'services.mysql.version': '8.4',
        'services.mysql.port': 3306,
        'services.nginx.version': '1.28',
        'services.nginx.port': 80,
    };
    return {
        get: vi.fn((key, def) => key in store ? store[key] : def),
        set: vi.fn((key, val) => { store[key] = val; }),
        _getStore: () => store,
    };
}

describe('ServiceManager', () => {
    let mgr, configStore, managers;

    beforeEach(() => {
        vi.clearAllMocks();
        configStore = makeConfigStore();

        // Mock sub-managers that ServiceManager needs
        managers = {
            phpManager: {
                getAvailableVersions: vi.fn().mockReturnValue(['8.3', '8.2']),
                getDefaultVersion: vi.fn().mockReturnValue('8.3'),
                getPhpBinaryPath: vi.fn().mockReturnValue('/path/to/php')
            }
        };

        mgr = new ServiceManager('/resources', configStore, managers);

        // Manually initialize Maps that constructor leaves empty but initialize() fills
        const services = ['nginx', 'apache', 'mysql', 'mariadb', 'redis', 'mailpit', 'phpmyadmin'];
        for (const s of services) {
            mgr.serviceStatus.set(s, { status: 'stopped' });
            mgr.runningVersions.set(s, new Map());
        }

        // We override some complex internal methods for testing orchestration
        vi.spyOn(mgr, 'startMySQL').mockResolvedValue(true);
        vi.spyOn(mgr, 'startMariaDB').mockResolvedValue(true);
        vi.spyOn(mgr, 'startRedis').mockResolvedValue(true);
        vi.spyOn(mgr, 'startNginx').mockResolvedValue(true);
        vi.spyOn(mgr, 'startApache').mockResolvedValue(true);
        vi.spyOn(mgr, 'startMailpit').mockResolvedValue(true);
        vi.spyOn(mgr, 'startPhpMyAdmin').mockResolvedValue(true);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Core Methods
    // ═══════════════════════════════════════════════════════════════════

    describe('getProcessKey', () => {
        it('creates a composite key for service state tracking', () => {
            expect(mgr.getProcessKey('mysql', '8.4')).toBe('mysql-8.4');
            expect(mgr.getProcessKey('redis', '7.4')).toBe('redis-7.4');
            // When no version is provided, it uses default string logic
            expect(mgr.getProcessKey('mailpit', null)).toBe('mailpit');
        });
    });

    describe('startService', () => {
        it('calls the corresponding specific start method for MySQL', async () => {
            await mgr.startService('mysql', '8.4');
            expect(mgr.startMySQL).toHaveBeenCalledWith('8.4');
        });

        it('dispatches to Nginx', async () => {
            await mgr.startService('nginx', '1.26');
            expect(mgr.startNginx).toHaveBeenCalledWith('1.26');
        });

        it('throws an error for unknown service', async () => {
            await expect(mgr.startService('unknownservice')).rejects.toThrow('Unknown service');
        });
    });

    describe('stopService', () => {
        it('kills the tracked process and tree using tree-kill', async () => {
            // Manually inject a fake tracked process
            mgr.processes.set('mysql-8.4', { pid: 9999 });

            await mgr.stopService('mysql', '8.4');

            expect(mockTreeKill).toHaveBeenCalled();
            expect(mockTreeKill.mock.calls[0][0]).toBe(9999); // PID
            expect(mgr.processes.has('mysql-8.4')).toBe(false);
        });

        it('does nothing if service is not running', async () => {
            // Not tracked
            await mgr.stopService('mysql', '8.4');
            expect(mockTreeKill).not.toHaveBeenCalled();
        });
    });

    describe('restartService', () => {
        it('stops and then starts the service', async () => {
            vi.spyOn(mgr, 'stopService').mockResolvedValue(true);
            vi.spyOn(mgr, 'startService').mockResolvedValue(true);

            // We mock the status to contain version 8.4 so restart knows what to restart
            mgr.serviceStatus.set('mysql', { status: 'running', version: '8.4' });

            await mgr.restartService('mysql');

            expect(mgr.stopService).toHaveBeenCalledWith('mysql');
            expect(mgr.startService).toHaveBeenCalledWith('mysql');
        });
    });

    describe('startAllServices', () => {
        it('starts web server, db server, and helper services from config', async () => {
            vi.spyOn(mgr, 'startService').mockResolvedValue(true);

            // Assume the user has configured nginx and mysql, plus mailpit and phpMyAdmin
            configStore.get.mockImplementation((key, def) => {
                if (key === 'services.webserver') return 'nginx';
                if (key === 'services.database') return 'mysql';
                return def;
            });

            await mgr.startAllServices();

            // Should start Nginx (webserver)
            expect(mgr.startService).toHaveBeenCalledWith('nginx');
            // Should start MySQL (database)
            expect(mgr.startService).toHaveBeenCalledWith('mysql');
            // Should start built-in helpers
            expect(mgr.startService).toHaveBeenCalledWith('mailpit');
            expect(mgr.startService).toHaveBeenCalledWith('phpmyadmin');
        });
    });

    describe('stopAllServices', () => {
        it('stops every active process in the tracker Map', async () => {
            vi.spyOn(mgr, 'stopService').mockResolvedValue(true);

            // Mock running processes natively
            mgr.processes.set('mysql-8.4', { pid: 100 });
            mgr.processes.set('nginx-1.28', { pid: 101 });
            mgr.processes.set('mailpit-null', { pid: 102 });

            await mgr.stopAllServices();

            // stopAllServices loops through all Object.keys(this.serviceConfigs)
            expect(mgr.stopService).toHaveBeenCalledWith('mysql');
            expect(mgr.stopService).toHaveBeenCalledWith('nginx');
            expect(mgr.stopService).toHaveBeenCalledWith('mailpit');
            // Wait, there are 7 services, so 7 calls total
            expect(mgr.stopService).toHaveBeenCalledTimes(7);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // State Querying
    // ═══════════════════════════════════════════════════════════════════

    describe('Status Tracking', () => {
        it('can retrieve getRunningVersions correctly', () => {
            mgr.runningVersions.get('mysql').set('8.4', { port: 3306, startedAt: Date.now() });
            mgr.runningVersions.get('mysql').set('5.7', { port: 3308, startedAt: Date.now() });

            const running = mgr.getRunningVersions('mysql');
            expect(running.has('8.4')).toBe(true);
            expect(running.has('5.7')).toBe(true);
            expect(running.get('8.4').port).toBe(3306);
        });

        it('isVersionRunning returns boolean true if tracked', () => {
            mgr.runningVersions.get('redis').set('7.4', { pid: 200 });
            expect(mgr.isVersionRunning('redis', '7.4')).toBe(true);
            expect(mgr.isVersionRunning('redis', '6.0')).toBe(false);
        });

        it('getAllRunningVersions maps across all service namespaces', () => {
            mgr.runningVersions.get('mysql').set('8.4', { port: 3306 });
            mgr.runningVersions.get('nginx').set('1.28', { port: 80 });

            const all = mgr.getAllRunningVersions();
            expect(all.has('mysql')).toBe(true);
            expect(all.get('mysql').has('8.4')).toBe(true);
            expect(all.has('nginx')).toBe(true);
            expect(all.get('nginx').has('1.28')).toBe(true);
        });
    });
});
