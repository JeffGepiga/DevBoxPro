/**
 * Tests for src/main/services/ProjectManager.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

// 1. Mock child_process
const mockSpawnProc = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event, cb) => {
        if (event === 'exit' || event === 'close') cb(0);
    }),
    unref: vi.fn()
};

vi.mock('child_process', () => ({
    spawn: vi.fn(() => mockSpawnProc),
    exec: vi.fn((cmd, cb) => cb(null, { stdout: '', stderr: '' }))
}));

const fs = require('fs-extra');

// 3. Mock tree-kill using Node's require.cache
const mockKillFn = vi.fn((pid, sig, cb) => { if (cb) cb(); });
require('module')._cache[require.resolve('tree-kill')] = {
    id: require.resolve('tree-kill'),
    filename: require.resolve('tree-kill'),
    loaded: true,
    exports: Object.assign(mockKillFn, { default: mockKillFn })
};

// 4. Mock PortUtils
vi.mock('../../../src/main/utils/PortUtils', () => ({
    isPortAvailable: vi.fn().mockResolvedValue(true),
    findAvailablePort: vi.fn().mockResolvedValue(8000)
}));

// 5. Mock CompatibilityManager
vi.mock('../../../src/main/services/CompatibilityManager', () => {
    const mockClass = vi.fn().mockImplementation(() => ({
        initialize: vi.fn().mockResolvedValue(),
        checkCompatibility: vi.fn().mockReturnValue({ isCompatible: true, messages: [] })
    }));
    return { default: mockClass, __esModule: true, CompatibilityManager: mockClass };
});

// 6. Provide Electron mock via helper
require('../../helpers/mockElectronCjs');

// 7. Import module under test
const { ProjectManager } = require('../../../src/main/services/ProjectManager');

function makeConfigStore() {
    let projects = [];
    const store = {
        get: vi.fn((key, def) => {
            if (key === 'projects' || key === 'devbox.projects') return projects;
            if (key === 'resourcePath') return '/mock/resources';
            if (key === 'settings') return { webServer: 'nginx' };
            return def;
        }),
        set: vi.fn((key, val) => {
            if (key === 'projects' || key === 'devbox.projects') {
                projects = Array.isArray(val) ? val : [];
            }
        }),
        delete: vi.fn(),
        _getStore: () => projects,
    };
    return store;
}

describe('ProjectManager', () => {
    let mgr, configStore, managers;

    beforeEach(() => {
        vi.clearAllMocks();
        configStore = makeConfigStore();

        managers = {
            php: {
                getAvailableVersions: vi.fn().mockReturnValue([{ version: '8.3', available: true }]),
                getDefaultVersion: vi.fn().mockReturnValue('8.3'),
                getPhpBinaryPath: vi.fn().mockReturnValue('/php/php.exe'),
                getExtensions: vi.fn().mockResolvedValue({ 'redis': true })
            },
            service: {
                getVersionPort: vi.fn().mockReturnValue(3306),
                serviceConfigs: {
                    nginx: { defaultPort: 80 }
                },
                getAllServicesStatus: vi.fn().mockReturnValue({
                    nginx: { status: 'running' }
                }),
                reloadApache: vi.fn().mockResolvedValue(),
                reloadNginx: vi.fn().mockResolvedValue(),
                getServicePorts: vi.fn().mockReturnValue([]),
                startService: vi.fn().mockResolvedValue(),
                stopService: vi.fn().mockResolvedValue(),
                processes: new Map(),
                serviceStatus: new Map([
                    ['nginx', { status: 'running' }],
                    ['mysql', { status: 'running' }]
                ])
            },
            log: {
                info: vi.fn(),
                error: vi.fn(),
                project: vi.fn(),
                systemError: vi.fn(),
                systemWarn: vi.fn(),
                systemInfo: vi.fn()
            },
            ssl: {
                createCertificate: vi.fn().mockResolvedValue()
            },
            database: {
                createDatabase: vi.fn().mockResolvedValue(),
                setActiveDatabaseType: vi.fn().mockResolvedValue(),
                getDatabaseInfo: vi.fn().mockReturnValue({ type: 'mysql', version: '8.0' })
            },
            cli: {
                checkCliInstalled: vi.fn().mockResolvedValue({ installed: true, inPath: true }),
                installCli: vi.fn().mockResolvedValue(),
                addToPath: vi.fn().mockResolvedValue(),
                syncProjectsFile: vi.fn().mockResolvedValue('/mock/cli/projects.json'),
                getDirectShimsEnabled: vi.fn().mockReturnValue(false)
            }
        };

        mgr = new ProjectManager(configStore, managers);
        mgr.validateProjectBinaries = vi.fn().mockResolvedValue({ isCompatible: true, missing: [] });

        // Reset fs mock states
        vi.spyOn(fs, 'ensureDir').mockResolvedValue();
        vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
        vi.spyOn(fs, 'pathExistsSync').mockReturnValue(true);
        vi.spyOn(fs, 'readFile').mockResolvedValue('APP_NAME=Laravel\nDB_PORT=3306\n');
        vi.spyOn(fs, 'readFileSync').mockReturnValue('');
        vi.spyOn(fs, 'writeFile').mockResolvedValue();
        vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { });
        vi.spyOn(fs, 'copy').mockResolvedValue();
        vi.spyOn(fs, 'remove').mockResolvedValue();
        vi.spyOn(fs, 'readdir').mockResolvedValue(['test-file.txt']);
        vi.spyOn(fs, 'readJson').mockResolvedValue({});
    });

    // ═══════════════════════════════════════════════════════════════════
    // CRUD Operations
    // ═══════════════════════════════════════════════════════════════════

    describe('Project CRUD', () => {
        it('can return empty projects list', () => {
            expect(mgr.getAllProjects()).toEqual([]);
        });

        it('creates a new project and stores it in config', async () => {
            vi.spyOn(mgr, 'detectProjectType').mockResolvedValue('laravel');
            mgr.createVirtualHost = vi.fn().mockResolvedValue();

            const pConfig = {
                name: 'TestProj',
                path: '/path/to/testproj',
                phpVersion: '8.3',
                type: 'laravel'
            };

            const created = await mgr.createProject(pConfig);

            expect(created.id).toBeDefined();
            expect(created.name).toBe('TestProj');
            expect(created.type).toBe('laravel');
            expect(configStore.set).toHaveBeenCalled();

            const fromMgr = mgr.getProject(created.id);
            expect(fromMgr.name).toBe('TestProj');
        });

        it('throws on duplicate project name', async () => {
            configStore.set('projects', [{ id: 'xyz', name: 'ExistingProj', path: '/foo/existing' }]);

            await expect(mgr.createProject({ name: 'ExistingProj', path: '/foo/bar' })).rejects.toThrow('A project with the name "ExistingProj" already exists');
        });

        it('updates an existing project', async () => {
            const project = { id: 'abc1234', name: 'OldName', type: 'static', phpVersion: '8.2', path: '/foo/old', services: {} };
            configStore.set('projects', [project]);

            mgr.createVirtualHost = vi.fn().mockResolvedValue();

            const updated = await mgr.updateProject('abc1234', { name: 'NewName', phpVersion: '8.3' });

            expect(updated.name).toBe('NewName');
            expect(updated.phpVersion).toBe('8.3');
        });

        it('deletes a project and its vhost', async () => {
            const project = { id: 'abc1234', name: 'ToDelete', type: 'static', path: '/foo/delete', domain: 'todelete.test' };
            configStore.set('projects', [project]);

            mgr.getProjectStatus = vi.fn().mockReturnValue('stopped');

            await mgr.deleteProject('abc1234', false); // don't delete files

            expect(configStore.set).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Lifecycle
    // ═══════════════════════════════════════════════════════════════════

    describe('Lifecycle: Start and Stop', () => {
        it('starts a project and marks it running', async () => {
            const project = {
                id: 'proj1',
                name: 'Proj1',
                type: 'static',
                path: '/foo/proj',
                domain: 'proj1.test',
                services: {},
                supervisor: { processes: [] }
            };
            configStore.set('projects', [project]);

            mgr.startPhpCgi = vi.fn().mockResolvedValue({ process: { pid: 999 }, port: 9000 });
            mgr.createVirtualHost = vi.fn().mockResolvedValue();
            mgr.addToHostsFile = vi.fn().mockResolvedValue();

            await mgr.startProject('proj1');

            expect(mgr.runningProjects.has('proj1')).toBe(true);
            expect(managers.service.reloadNginx).toHaveBeenCalled();
        });

        it('stops a project and cleans up resources', async () => {
            const project = {
                id: 'proj1',
                name: 'Proj1',
                type: 'static',
                path: '/foo/proj',
                domain: 'proj1.test',
                supervisor: { processes: [] }
            };
            configStore.set('projects', [project]);

            mgr.runningProjects.set('proj1', { phpCgiProcess: { pid: 999 } });

            await mgr.stopProject('proj1');

            expect(mockKillFn).toHaveBeenCalledWith(999, 'SIGTERM', expect.any(Function));
            expect(mgr.runningProjects.has('proj1')).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Helpers (Env, VHost, Detection)
    // ═══════════════════════════════════════════════════════════════════

    describe('Environment reading and Syncing', () => {
        it('reads an .env file', async () => {
            const project = { id: 'ev1', name: 'Ev1', path: '/env' };
            configStore.set('projects', [project]);

            const env = await mgr.readEnvFile('ev1');
            expect(env.APP_NAME).toBe('Laravel');
            expect(env.DB_PORT).toBe('3306');
        });
    });

    describe('detectProjectType', () => {
        it('identifies laravel when artisan is present', async () => {
            vi.spyOn(fs, 'pathExists').mockImplementation(async (p) => p.endsWith('composer.json'));
            vi.spyOn(fs, 'readJson').mockResolvedValue({ require: { 'laravel/framework': '^10.0' } });
            const type = await mgr.detectProjectType('/some/path');
            expect(type).toBe('laravel');
        });

        it('identifies wordpress when wp-config.php is present', async () => {
            vi.spyOn(fs, 'pathExists').mockImplementation(async (p) => p.endsWith('wp-config.php'));
            const type = await mgr.detectProjectType('/some/path');
            expect(type).toBe('wordpress');
        });

        it('defaults to static when nothing else matches', async () => {
            vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
            const type = await mgr.detectProjectType('/some/path');
            expect(type).toBe('custom');
        });
    });

});
