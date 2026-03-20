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
        kill: vi.fn(),
        killed: false,
        on: vi.fn((event, cb) => {
            // we won't auto-trigger exit/close so processes appear "running"
        }),
        unref: vi.fn()
    };
    return {
        spawn: vi.fn(() => mockProcess),
        exec: vi.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' })),
        execFile: vi.fn((file, args, cb) => cb(null, { stdout: '', stderr: '' })),
        execSync: vi.fn(() => 'Syntax OK')
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
    emptyDir: vi.fn().mockResolvedValue(),
    readdir: vi.fn().mockResolvedValue([]),
    pathExists: vi.fn().mockResolvedValue(true),
    pathExistsSync: vi.fn().mockReturnValue(true),
    readFile: vi.fn().mockResolvedValue('user=root\npassword=root'),
    readFileSync: vi.fn().mockReturnValue(''),
    writeFile: vi.fn().mockResolvedValue(),
    writeFileSync: vi.fn(),
    copy: vi.fn().mockResolvedValue(),
    move: vi.fn().mockResolvedValue(),
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
            },
            project: {
                regenerateAllNginxVhosts: vi.fn().mockResolvedValue(),
                regenerateAllApacheVhosts: vi.fn().mockResolvedValue(),
                runningProjects: new Map(),
            },
            log: {
                systemInfo: vi.fn(),
                systemWarn: vi.fn(),
                systemError: vi.fn(),
                service: vi.fn()
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

        it('keeps a bounded process output snippet for system-log diagnostics', () => {
            const first = mgr.appendProcessOutputSnippet('', 'first line');
            const second = mgr.appendProcessOutputSnippet(first, 'second line', 30);
            const third = mgr.appendProcessOutputSnippet(second, 'third line that is longer', 30);

            expect(first).toBe('first line');
            expect(second).toContain('first line');
            expect(second).toContain('second line');
            expect(third.length).toBeLessThanOrEqual(30);
            expect(third).toContain('third line');
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

        it('quotes file paths in generated nginx config', async () => {
            configStore.getDataPath = vi.fn(() => 'C:/DevBox Pro/data');
            mgr.getNginxPath = vi.fn(() => 'C:/DevBox Pro/resources-user/nginx/1.28/win');
            const writeFileSpy = vi.spyOn(require('fs-extra'), 'writeFile');

            await mgr.createNginxConfig('C:/DevBox Pro/data/nginx/1.28/nginx.conf', 'C:/DevBox Pro/data/nginx/1.28/logs', 80, 443, '1.28');

            expect(writeFileSpy).toHaveBeenCalled();
            const [, config] = writeFileSpy.mock.calls.at(-1);
            expect(config).toContain('include       "C:/DevBox Pro/resources-user/nginx/1.28/win/conf/mime.types";');
            expect(config).toContain('include "C:/DevBox Pro/data/nginx/1.28/sites/*.conf";');
            expect(config).toContain('root "C:/DevBox Pro/data/www";');
        });

        it('quotes file paths in generated MySQL config', async () => {
            mgr.getMySQLPath = vi.fn(() => 'C:/DevBox Pro/resources-user/mysql/8.4/win');
            configStore.get.mockImplementation((key, def) => {
                if (key === 'settings') return { serverTimezone: 'UTC' };
                return def;
            });
            fs.writeFile.mockResolvedValue();

            await mgr.createMySQLConfig(
                'C:/DevBox Pro/data/mysql/8.4/my.cnf',
                'C:/DevBox Pro/data/mysql/8.4/data',
                3306,
                '8.4',
                'C:/DevBox Pro/data/mysql/8.4/credentials_init.sql'
            );

            expect(fs.writeFile).toHaveBeenCalled();
            const [, config] = fs.writeFile.mock.calls.at(-1);
            expect(config).toContain('basedir="C:/DevBox Pro/resources-user/mysql/8.4/win"');
            expect(config).toContain('datadir="C:/DevBox Pro/data/mysql/8.4/data"');
            expect(config).toContain('init-file="C:/DevBox Pro/data/mysql/8.4/credentials_init.sql"');
            expect(config).toContain('pid-file="C:/DevBox Pro/data/mysql/8.4/data/mysql.pid"');
            expect(config).toContain('log-error="C:/DevBox Pro/data/mysql/8.4/data/error.log"');
        });

        it('fails early when MySQL share assets are missing during initialization', async () => {
            vi.spyOn(require('fs-extra'), 'pathExists').mockResolvedValue(false);

            await expect(
                mgr.initializeMySQLData(
                    'C:/DevBox Pro/resources-user/mysql/8.4/win',
                    'C:/DevBox Pro/data/mysql/8.4/data',
                    '8.4'
                )
            ).rejects.toThrow('missing share/messages_to_error_log.txt');
        });

        it('adopts legacy MySQL data from the old userData path when current data is empty', async () => {
            const legacyDataDir = mgr.getLegacyMySQLDataDir('8.4');
            const currentDataDir = 'C:/DevBox Pro/data/mysql/8.4/data';
            const currentMysqlDir = path.join(currentDataDir, 'mysql');
            const legacyMysqlDir = path.join(legacyDataDir, 'mysql');
            const fsExtra = require('fs-extra');

            vi.spyOn(fsExtra, 'pathExists').mockImplementation(async (targetPath) => {
                if (targetPath === currentMysqlDir) return false;
                if (targetPath === legacyMysqlDir) return true;
                return true;
            });
            vi.spyOn(fsExtra, 'readdir').mockResolvedValue([]);
            vi.spyOn(fsExtra, 'copy').mockResolvedValue();

            const adopted = await mgr.maybeAdoptLegacyMySQLData('8.4', currentDataDir);

            expect(adopted).toBe(true);
            expect(fs.copy).toHaveBeenCalledWith(legacyDataDir, currentDataDir, {
                overwrite: false,
                errorOnExist: false,
            });
            expect(managers.log.systemInfo).toHaveBeenCalledWith(
                'Adopted legacy MySQL 8.4 data directory',
                expect.objectContaining({ from: legacyDataDir, to: currentDataDir })
            );
        });

        it('detects recoverable MySQL redo corruption from the error log', async () => {
            const fsExtra = require('fs-extra');

            vi.spyOn(fsExtra, 'pathExists').mockResolvedValue(true);
            vi.spyOn(fsExtra, 'readFile').mockResolvedValue([
                '2026-03-19T07:45:56.897977Z 1 [ERROR] [MY-013882] [InnoDB] Missing redo log file .\\#innodb_redo\\#ib_redo6 (with start_lsn = 19656704).',
                '2026-03-19T07:45:56.898594Z 1 [ERROR] [MY-012930] [InnoDB] Plugin initialization aborted with error Generic error.',
            ].join('\n'));

            await expect(mgr.hasRecoverableMySQLRedoCorruption('C:/DevBox Pro/data/mysql/8.4/data')).resolves.toBe(true);
        });

        it('archives corrupt MySQL redo logs before retrying startup', async () => {
            const fsExtra = require('fs-extra');

            vi.spyOn(fsExtra, 'pathExists').mockResolvedValue(true);
            vi.spyOn(fsExtra, 'move').mockResolvedValue();

            const recovered = await mgr.recoverCorruptMySQLRedoLogs('8.4', 'C:/DevBox Pro/data/mysql/8.4/data');

            expect(recovered).toBe(true);
            const [sourcePath, backupPath, moveOptions] = fsExtra.move.mock.calls.at(-1);
            expect(sourcePath.replace(/\\/g, '/')).toBe('C:/DevBox Pro/data/mysql/8.4/data/#innodb_redo');
            expect(backupPath.replace(/\\/g, '/')).toContain('C:/DevBox Pro/data/mysql/8.4/data/#innodb_redo.corrupt-');
            expect(moveOptions).toEqual({ overwrite: false });
            const [, warningDetails] = managers.log.systemWarn.mock.calls.at(-1);
            expect(managers.log.systemWarn).toHaveBeenCalledWith(
                'Recovered corrupt MySQL 8.4 redo logs',
                expect.any(Object)
            );
            expect(warningDetails.redoDir.replace(/\\/g, '/')).toBe('C:/DevBox Pro/data/mysql/8.4/data/#innodb_redo');
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

            expect(mgr.stopService).toHaveBeenCalledWith('mysql', null);
            expect(mgr.startService).toHaveBeenCalledWith('mysql', null);
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
            // serviceConfigs now includes mysql, mariadb, redis, nginx, apache, mailpit, phpmyadmin,
            // postgresql, mongodb, memcached, minio = 11 services
            expect(mgr.stopService).toHaveBeenCalledTimes(11);
        }, 15000);
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

    describe('createApacheConfig', () => {
        it('only includes extra Listen directives for running Apache projects', async () => {
            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects') {
                    return [
                        { id: 'apache-running', webServer: 'apache', networkAccess: true, port: 8001 },
                        { id: 'apache-stopped', webServer: 'apache', networkAccess: true, port: 8003 },
                        { id: 'nginx-running', webServer: 'nginx', networkAccess: true, port: 8004 },
                    ];
                }

                return def;
            });

            managers.project = {
                networkPort80Owner: null,
                runningProjects: new Map([
                    ['apache-running', { startedAt: new Date() }],
                    ['nginx-running', { startedAt: new Date() }],
                ]),
            };

            const confPath = path.join(process.cwd(), 'test-results', 'service-manager-httpd.conf');

            await mgr.createApacheConfig('/apache', confPath, '/logs', 8084, 8446, [8005]);

            expect(fs.writeFile).toHaveBeenCalled();
            const [, config] = fs.writeFile.mock.calls.at(-1);

            expect(config).toContain('Listen 0.0.0.0:8084');
            expect(config).toContain('Listen 0.0.0.0:8446');
            expect(config).toContain('Listen 0.0.0.0:8001');
            expect(config).toContain('Listen 0.0.0.0:8005');
            expect(config).not.toContain('Listen 0.0.0.0:8003');
            expect(config).not.toContain('Listen 0.0.0.0:8004');
        });
    });

    describe('front-door vhost regeneration', () => {
        it('regenerates nginx vhosts before start so running apache projects get proxy entries', async () => {
            const childProcess = require('child_process');
            mgr.startNginx.mockRestore();
            mgr.getNginxPath = vi.fn(() => '/resources/nginx/1.28/win');
            vi.spyOn(mgr, 'checkPortOpen').mockResolvedValue(true);
            vi.spyOn(childProcess, 'execSync').mockReturnValue('Syntax OK');

            managers.project.runningProjects = new Map([
                ['apache-project', { startedAt: new Date() }],
            ]);
            mgr.serviceStatus.set('apache', { status: 'stopped' });

            await mgr.startNginx('1.28');

            expect(managers.project.regenerateAllNginxVhosts).toHaveBeenCalledWith(null, '1.28');
        });

        it('regenerates apache vhosts before start so running nginx projects get proxy entries', async () => {
            const childProcess = require('child_process');
            mgr.getApachePath = vi.fn(() => '/resources/apache/2.4/win');
            vi.spyOn(mgr, 'waitForService').mockResolvedValue();
            vi.spyOn(childProcess, 'execSync').mockReturnValue('Syntax OK');

            managers.project.runningProjects = new Map([
                ['nginx-project', { startedAt: new Date() }],
            ]);
            mgr.serviceStatus.set('nginx', { status: 'stopped' });

            await mgr.startApache('2.4');

            expect(managers.project.regenerateAllApacheVhosts).toHaveBeenCalledWith(null, '2.4');
        });
    });
});
