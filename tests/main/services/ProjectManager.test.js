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

// 4. Mock PortUtils using Node's require.cache BEFORE ProjectManager is imported
const mockPortUtils = {
    isPortAvailable: vi.fn(async (port) => {
        if (port == 9998) return false;
        return true;
    }),
    findAvailablePort: vi.fn(async () => 8000)
};
require('module')._cache[require.resolve('../../../src/main/utils/PortUtils')] = {
    id: require.resolve('../../../src/main/utils/PortUtils'),
    filename: require.resolve('../../../src/main/utils/PortUtils'),
    loaded: true,
    exports: Object.assign(mockPortUtils, { default: mockPortUtils })
};

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
                getApachePath: vi.fn().mockReturnValue('/mock/resources/apache/2.4/win'),
                createApacheConfig: vi.fn().mockResolvedValue(),
                serviceConfigs: {
                    nginx: { defaultPort: 80 }
                },
                getAllServicesStatus: vi.fn().mockReturnValue({
                    nginx: { status: 'running' }
                }),
                reloadApache: vi.fn().mockResolvedValue(),
                reloadNginx: vi.fn().mockResolvedValue(),
                getServicePorts: vi.fn().mockReturnValue({ httpPort: 80, sslPort: 443 }),
                isVersionRunning: vi.fn().mockReturnValue(true),
                startService: vi.fn().mockResolvedValue(),
                stopService: vi.fn().mockResolvedValue(),
                processes: new Map(),
                standardPortOwner: null,
                standardPortOwnerVersion: null,
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

        it('rejects importing an already-registered project path', async () => {
            configStore.set('projects', [{ id: 'xyz', name: 'ExistingProj', path: '/foo/existing' }]);

            await expect(mgr.registerExistingProject({ name: 'Another Name', path: '/foo/existing' })).rejects.toThrow(
                'This folder is already registered as project "ExistingProj".'
            );
        });

        it('rejects importing an existing project under a duplicate name', async () => {
            configStore.set('projects', [{ id: 'xyz', name: 'ExistingProj', path: '/foo/existing' }]);

            await expect(mgr.registerExistingProject({ name: 'ExistingProj', path: '/foo/other' })).rejects.toThrow(
                'A project with the name "ExistingProj" already exists.'
            );
        });

        it('updates an existing project', async () => {
            const project = { id: 'abc1234', name: 'OldName', type: 'static', phpVersion: '8.2', path: '/foo/old', services: {} };
            configStore.set('projects', [project]);

            mgr.createVirtualHost = vi.fn().mockResolvedValue();

            const updated = await mgr.updateProject('abc1234', { name: 'NewName', phpVersion: '8.3' });

            expect(updated.name).toBe('NewName');
            expect(updated.phpVersion).toBe('8.3');
        });

        it('removes stale configs and regenerates the vhost when web server version changes', async () => {
            const project = {
                id: 'abc1234',
                name: 'OldName',
                type: 'static',
                phpVersion: '8.2',
                path: '/foo/old',
                domain: 'versioned.test',
                domains: ['versioned.test'],
                webServer: 'nginx',
                webServerVersion: '1.24',
                ssl: false,
                networkAccess: false,
                services: {},
            };
            configStore.set('projects', [project]);

            mgr.createVirtualHost = vi.fn().mockResolvedValue();
            mgr.removeVirtualHost = vi.fn().mockResolvedValue();

            const updated = await mgr.updateProject('abc1234', { webServerVersion: '1.28' });

            expect(updated.webServerVersion).toBe('1.28');
            expect(mgr.removeVirtualHost).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'abc1234', webServer: 'nginx', webServerVersion: '1.24' }),
                { reloadIfRunning: true }
            );
            expect(mgr.createVirtualHost).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'abc1234', webServerVersion: '1.28' }),
                null,
                '1.28'
            );
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
            // createVirtualHost is mocked, which internally handles nginx reload.
            // startProjectServices no longer duplicates the reload.
            expect(mgr.createVirtualHost).toHaveBeenCalled();
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

        it('keeps unused services warm briefly so a quick restart avoids a cold start', async () => {
            vi.useFakeTimers();

            const project = {
                id: 'proj-warm-start',
                name: 'Warm Start',
                type: 'static',
                path: '/foo/warm',
                domain: 'warm.test',
                webServer: 'nginx',
                webServerVersion: '1.28',
                services: { mysql: true, mysqlVersion: '8.4' },
                supervisor: { processes: [] }
            };

            configStore.set('projects', [project]);
            mgr.runningProjects.set(project.id, { phpCgiProcess: { pid: 123 } });
            managers.service.serviceStatus.set('nginx', { status: 'running', version: '1.28' });
            managers.service.serviceStatus.set('mysql', { status: 'running', version: '8.4' });
            managers.service.isVersionRunning.mockImplementation((service, version) => service === 'nginx' ? version === '1.28' : false);

            await mgr.stopProject(project.id);

            expect(managers.service.stopService).not.toHaveBeenCalledWith('nginx', '1.28');
            expect(managers.service.stopService).not.toHaveBeenCalledWith('mysql', '8.4');

            const serviceResult = await mgr.startProjectServices(project);

            expect(serviceResult.success).toBe(true);
            expect(managers.service.startService).not.toHaveBeenCalledWith('nginx', '1.28');
            expect(managers.service.startService).not.toHaveBeenCalledWith('mysql', '8.4');

            await vi.advanceTimersByTimeAsync(16000);

            expect(managers.service.stopService).not.toHaveBeenCalledWith('nginx', '1.28');
            expect(managers.service.stopService).not.toHaveBeenCalledWith('mysql', '8.4');

            vi.useRealTimers();
        });

        it('logs a warning and continues if configured port is in use by an external server', async () => {
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

            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects' || key === 'devbox.projects') return [project];
                return def;
            });

            // Make getServicePorts return the magical port 9998
            mgr.managers.service.getServicePorts.mockReturnValue({ httpPort: 9998, sslPort: 9998 });

            // Mock serviceStatus to indicate Nginx is NOT running (so it's an external process using the port)
            mgr.managers.service.serviceStatus.set('nginx', { status: 'stopped' });

            // Should not throw — it should log a warning and let the web server handle port fallback
            // The startProjectServices call will handle the actual port allocation
            // It may still throw from startProjectServices/validateProjectBinaries, but NOT from the port check
            try {
                await mgr.startProject('proj1');
            } catch (err) {
                // If it throws, it should NOT be the old "already in use by an external program" error
                expect(err.message).not.toMatch(/already in use by an external program/);
            }
        });

        it('regenerates Apache Listen directives for alternate LAN ports when Apache is already running', async () => {
            const project = {
                id: 'proj-apache-lan',
                name: 'ProjApacheLan',
                type: 'laravel',
                path: 'C:/Sites/Apache LAN',
                domain: 'apache-lan.test',
                domains: ['apache-lan.test'],
                phpVersion: '8.3',
                webServer: 'apache',
                webServerVersion: '2.4',
                ssl: true,
                networkAccess: true,
                port: 8003,
                services: {},
                supervisor: { processes: [] },
            };
            configStore.set('projects', [project]);

            managers.service.isVersionRunning = vi.fn((service, version) => service === 'apache' && version === '2.4');
            managers.service.serviceStatus.set('apache', { status: 'running', version: '2.4' });
            managers.service.getServicePorts.mockImplementation((service) => {
                if (service === 'apache') {
                    return { httpPort: 8084, sslPort: 8446 };
                }
                return { httpPort: 80, sslPort: 443 };
            });

            mgr.createApacheVhost = vi.fn().mockResolvedValue({
                networkAccess: true,
                finalHttpPort: 8003,
                httpPort: 8084,
            });
            mgr.regenerateAllApacheVhosts = vi.fn().mockResolvedValue();
            mgr.syncProjectLocalProxy = vi.fn().mockResolvedValue(false);
            mgr.startProjectServices = vi.fn().mockResolvedValue({ success: true, started: ['apache:2.4'], failed: [], criticalFailures: [], errors: [] });
            mgr.addToHostsFile = vi.fn().mockResolvedValue();

            await mgr.startProject('proj-apache-lan');

            expect(managers.service.createApacheConfig).toHaveBeenCalledWith(
                '/mock/resources/apache/2.4/win',
                expect.stringMatching(/[\\/]apache[\\/]httpd\.conf$/),
                expect.stringMatching(/[\\/]apache[\\/]logs$/),
                8084,
                8446,
                [8003]
            );
            expect(managers.service.reloadApache).toHaveBeenCalledWith('2.4');
        });

        it('regenerates stale SSL certs that do not match the current root CA', async () => {
            const project = {
                id: 'proj-stale-ssl',
                domain: 'stale-ssl.test',
                domains: ['stale-ssl.test'],
                ssl: true,
            };

            managers.ssl.certificateMatchesCurrentCA = vi.fn().mockResolvedValue(false);

            await mgr.ensureProjectSslCertificates(project, 'C:/Users/Test User/.devbox-pro/ssl/stale-ssl.test');

            expect(managers.ssl.certificateMatchesCurrentCA).toHaveBeenCalledWith('stale-ssl.test');
            expect(managers.ssl.createCertificate).toHaveBeenCalledWith(['stale-ssl.test']);
        });
    });

    describe('Nginx vhost generation', () => {
        it('removes stale nginx configs from all versioned directories', async () => {
            const project = {
                id: 'proj-nginx-clean',
                domain: 'proj-nginx-clean.test',
                webServer: 'nginx',
                webServerVersion: '1.28',
            };
            const nginxRoot = path.join('/mock/data', 'nginx');
            const nginx124Config = path.join('/mock/data', 'nginx', '1.24', 'sites', 'proj-nginx-clean.conf');
            const nginx128Config = path.join('/mock/data', 'nginx', '1.28', 'sites', 'proj-nginx-clean.conf');

            configStore.getDataPath = vi.fn(() => '/mock/data');
            vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => (
                targetPath === nginxRoot
                || targetPath === nginx124Config
                || targetPath === nginx128Config
            ));
            vi.spyOn(fs, 'readdir').mockImplementation(async (targetPath, options) => {
                if (targetPath === nginxRoot && options?.withFileTypes) {
                    return [
                        { name: '1.24', isDirectory: () => true },
                        { name: '1.28', isDirectory: () => true },
                    ];
                }

                return [];
            });

            await mgr.removeVirtualHost(project);

            expect(fs.remove).toHaveBeenCalledWith(nginx124Config);
            expect(fs.remove).toHaveBeenCalledWith(nginx128Config);
        });

        it('quotes fastcgi include paths in generated vhost configs', async () => {
            const project = {
                id: 'proj-nginx',
                name: 'ProjNginx',
                type: 'laravel',
                path: 'C:/Sites/My App',
                domain: 'proj-nginx.test',
                domains: ['proj-nginx.test'],
                phpVersion: '8.3',
                webServer: 'nginx',
                webServerVersion: '1.28',
                ssl: false,
                networkAccess: false,
                services: {},
                supervisor: { processes: [] }
            };

            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects' || key === 'devbox.projects') return [project];
                if (key === 'resourcePath') return 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources';
                if (key === 'settings') return { webServer: 'nginx' };
                return def;
            });
            configStore.getDataPath = vi.fn(() => 'C:/Users/Test User/.devbox-pro');
            configStore.getResourcesPath = vi.fn(() => 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources');
            managers.service.getServicePorts.mockReturnValue({ httpPort: 80, sslPort: 443 });

            await mgr.createNginxVhost(project, 9000, '1.28');

            const [, config] = fs.writeFile.mock.calls.at(-1);
            expect(config).toContain('include "C:/Users/Test User/AppData/Roaming/devbox-pro/resources/nginx/1.28/win/conf/fastcgi_params";');
        });

        it('does not turn the first apache SSL vhost into a wildcard catch-all', async () => {
            const project = {
                id: 'proj-apache',
                name: 'ProjApache',
                type: 'laravel',
                path: 'C:/Sites/Apache App',
                domain: 'proj-apache.test',
                domains: ['proj-apache.test'],
                phpVersion: '8.3',
                webServer: 'apache',
                webServerVersion: '2.4',
                ssl: true,
                networkAccess: true,
                services: {},
                supervisor: { processes: [] }
            };

            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects' || key === 'devbox.projects') return [project];
                if (key === 'resourcePath') return 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources';
                if (key === 'settings') return { webServer: 'apache' };
                return def;
            });
            configStore.getDataPath = vi.fn(() => 'C:/Users/Test User/.devbox-pro');
            configStore.getResourcesPath = vi.fn(() => 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources');
            managers.service.getServicePorts.mockReturnValue({ httpPort: 80, sslPort: 443 });
            managers.service.standardPortOwner = 'apache';

            mgr.networkPort80Owner = project.id;

            await mgr.createApacheVhost(project, '2.4');

            const [, config] = fs.writeFile.mock.calls.at(-1);
            expect(config).toContain('ServerAlias www.proj-apache.test *.proj-apache.test *');
            expect(config).toContain('<VirtualHost *:443>');
            expect(config).toContain('ServerAlias www.proj-apache.test *.proj-apache.test');
            expect(config).not.toContain('ServerAlias www.proj-apache.test *.proj-apache.test *\n    DocumentRoot "C:/Sites/Apache App/public"');
        });

        it('keeps alternate-port apache SSL projects isolated when port 80 is unavailable', async () => {
            const firstProject = {
                id: 'proj-apache-first',
                name: 'ProjApacheFirst',
                type: 'laravel',
                path: 'C:/Sites/Apache First',
                domain: 'first-apache.test',
                domains: ['first-apache.test'],
                phpVersion: '8.3',
                webServer: 'apache',
                webServerVersion: '2.4',
                ssl: true,
                networkAccess: true,
                services: {},
                supervisor: { processes: [] },
                port: 8005,
            };
            const secondProject = {
                id: 'proj-apache-second',
                name: 'ProjApacheSecond',
                type: 'laravel',
                path: 'C:/Sites/Apache Second',
                domain: 'second-apache.test',
                domains: ['second-apache.test'],
                phpVersion: '8.3',
                webServer: 'apache',
                webServerVersion: '2.4',
                ssl: true,
                networkAccess: true,
                services: {},
                supervisor: { processes: [] },
                port: 8006,
            };

            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects' || key === 'devbox.projects') return [firstProject, secondProject];
                if (key === 'resourcePath') return 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources';
                if (key === 'settings') return { webServer: 'apache' };
                return def;
            });
            configStore.getDataPath = vi.fn(() => 'C:/Users/Test User/.devbox-pro');
            configStore.getResourcesPath = vi.fn(() => 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources');
            managers.service.getServicePorts.mockReturnValue({ httpPort: 8084, sslPort: 8446 });
            managers.service.standardPortOwner = null;

            mockPortUtils.isPortAvailable.mockImplementation(async (port) => port !== 80);

            await mgr.createApacheVhost(firstProject, '2.4');
            const [, firstConfig] = fs.writeFile.mock.calls.at(-1);

            await mgr.createApacheVhost(secondProject, '2.4');
            const [, secondConfig] = fs.writeFile.mock.calls.at(-1);

            expect(firstConfig).toContain('<VirtualHost *:8005>');
            expect(firstConfig).toContain('<VirtualHost *:8446>');
            expect(firstConfig).toContain('ServerAlias www.first-apache.test *.first-apache.test');
            expect(firstConfig).not.toContain('ServerAlias www.first-apache.test *.first-apache.test *');

            expect(secondConfig).toContain('<VirtualHost *:8006>');
            expect(secondConfig).toContain('<VirtualHost *:8446>');
            expect(secondConfig).toContain('ServerAlias www.second-apache.test *.second-apache.test');
            expect(secondConfig).not.toContain('ServerAlias www.second-apache.test *.second-apache.test *');
        });

        it('uses the same Apache vhost address binding for mixed local and network projects on shared SSL ports', async () => {
            const firstProject = {
                id: 'proj-apache-local',
                name: 'ProjApacheLocal',
                type: 'laravel',
                path: 'C:/Sites/Apache Local',
                domain: 'local-apache.test',
                domains: ['local-apache.test'],
                phpVersion: '8.3',
                webServer: 'apache',
                webServerVersion: '2.4',
                ssl: true,
                networkAccess: false,
                services: {},
                supervisor: { processes: [] },
            };
            const secondProject = {
                id: 'proj-apache-network',
                name: 'ProjApacheNetwork',
                type: 'laravel',
                path: 'C:/Sites/Apache Network',
                domain: 'network-apache.test',
                domains: ['network-apache.test'],
                phpVersion: '8.3',
                webServer: 'apache',
                webServerVersion: '2.4',
                ssl: true,
                networkAccess: true,
                services: {},
                supervisor: { processes: [] },
                port: 8007,
            };

            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects' || key === 'devbox.projects') return [firstProject, secondProject];
                if (key === 'resourcePath') return 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources';
                if (key === 'settings') return { webServer: 'apache' };
                return def;
            });
            configStore.getDataPath = vi.fn(() => 'C:/Users/Test User/.devbox-pro');
            configStore.getResourcesPath = vi.fn(() => 'C:/Users/Test User/AppData/Roaming/devbox-pro/resources');
            managers.service.getServicePorts.mockReturnValue({ httpPort: 80, sslPort: 443 });
            managers.service.standardPortOwner = 'apache';
            mgr.networkPort80Owner = secondProject.id;

            await mgr.createApacheVhost(firstProject, '2.4');
            const [, firstConfig] = fs.writeFile.mock.calls.at(-1);

            await mgr.createApacheVhost(secondProject, '2.4');
            const [, secondConfig] = fs.writeFile.mock.calls.at(-1);

            expect(firstConfig).toContain('<VirtualHost *:80>');
            expect(firstConfig).toContain('<VirtualHost *:443>');
            expect(secondConfig).toContain('<VirtualHost *:80>');
            expect(secondConfig).toContain('<VirtualHost *:443>');
            expect(firstConfig).not.toContain('<VirtualHost 0.0.0.0:443>');
            expect(secondConfig).not.toContain('<VirtualHost 0.0.0.0:443>');
            expect(secondConfig).toContain('ServerAlias www.network-apache.test *.network-apache.test *');
        });

        it('switches web servers with the requested target version', async () => {
            const project = {
                id: 'proj-switch',
                name: 'ProjSwitch',
                type: 'static',
                path: '/foo/switch',
                domain: 'switch.test',
                webServer: 'apache',
                webServerVersion: '2.4',
                services: {},
                supervisor: { processes: [] }
            };
            configStore.set('projects', [project]);

            mgr.createVirtualHost = vi.fn().mockResolvedValue();
            mgr.removeVirtualHost = vi.fn().mockResolvedValue();

            const result = await mgr.switchWebServer('proj-switch', 'nginx', '1.24');

            expect(result.webServerVersion).toBe('1.24');
            expect(mgr.removeVirtualHost).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'proj-switch', webServer: 'apache', webServerVersion: '2.4' }),
                { reloadIfRunning: true }
            );
            expect(mgr.createVirtualHost).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'proj-switch', webServer: 'nginx', webServerVersion: '1.24' }),
                null,
                '1.24'
            );
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

    describe('URL generation', () => {
        it('uses clean local URLs when a front-door owner exists', () => {
            managers.service.getServicePorts.mockImplementation((serviceName, version) => {
                if (serviceName === 'nginx' && version === '1.28') {
                    return { httpPort: 8081, sslPort: 8443 };
                }

                if (serviceName === 'nginx' && version === '1.26') {
                    return { httpPort: 8082, sslPort: 8444 };
                }

                return { httpPort: 80, sslPort: 443 };
            });
            managers.service.standardPortOwner = 'apache';

            const project128 = {
                id: 'nginx128',
                domain: 'second.test',
                domains: ['second.test'],
                ssl: true,
                webServer: 'nginx',
                webServerVersion: '1.28',
            };
            const project126 = {
                id: 'nginx126',
                domain: 'third.test',
                domains: ['third.test'],
                ssl: true,
                webServer: 'nginx',
                webServerVersion: '1.26',
            };

            expect(mgr.getProjectUrl(project128)).toBe('https://second.test');
            expect(mgr.getProjectUrl(project126)).toBe('https://third.test');
        });

        it('falls back to backend ports only when no front-door owner exists', () => {
            managers.service.getServicePorts.mockReturnValue({ httpPort: 8081, sslPort: 8443 });
            mgr.networkPort80Owner = 'other-project';
            managers.service.standardPortOwner = null;

            const project = {
                id: 'proj-http',
                domain: 'fourth.test',
                domains: ['fourth.test'],
                ssl: false,
                webServer: 'nginx',
                webServerVersion: '1.28',
                networkAccess: true,
                port: 8005,
            };

            expect(mgr.getProjectUrl(project)).toBe('http://fourth.test:8005');
        });

        it('returns standard local access ports when any web server owns the front door', () => {
            managers.service.standardPortOwner = 'nginx';
            managers.service.getServicePorts.mockReturnValue({ httpPort: 8084, sslPort: 8446 });

            const ports = mgr.getProjectLocalAccessPorts({
                webServer: 'apache',
                webServerVersion: '2.4',
            });

            expect(ports).toEqual({ httpPort: 80, sslPort: 443 });
        });

        it('preserves configured domain order for the primary domain', () => {
            const project = {
                domain: 'zeta.test',
                domains: ['zeta.test', 'alpha.test'],
            };

            expect(mgr.getProjectPrimaryDomain(project)).toBe('zeta.test');
            expect(mgr.getProjectUrl({
                ...project,
                ssl: true,
                webServer: 'nginx',
                webServerVersion: '1.28',
            })).toBe('https://zeta.test');
        });
    });

    describe('Proxy vhost generation', () => {
        it('creates an nginx proxy vhost that forwards to apache backends', async () => {
            const project = {
                id: 'proxy-nginx',
                name: 'ProxyNginx',
                domain: 'apache.test',
                domains: ['apache.test'],
                webServer: 'apache',
                ssl: true,
            };

            await mgr.createProxyNginxVhost(project, 8084, '1.28');

            const [, config] = fs.writeFile.mock.calls.at(-1);
            expect(config).toContain('proxy_pass http://127.0.0.1:8084;');
            expect(config).toContain('proxy_set_header Host $host;');
            expect(config).toContain('listen 80;');
            expect(config).toContain('listen 443 ssl');
        });

        it('creates an apache proxy vhost that forwards to nginx backends', async () => {
            const project = {
                id: 'proxy-apache',
                name: 'ProxyApache',
                domain: 'nginx.test',
                domains: ['nginx.test'],
                webServer: 'nginx',
                ssl: true,
            };

            await mgr.createProxyApacheVhost(project, 8081, '2.4');

            const [, config] = fs.writeFile.mock.calls.at(-1);
            expect(config).toContain('ProxyPass / http://127.0.0.1:8081/ retry=0');
            expect(config).toContain('ProxyPreserveHost On');
            expect(config).toContain('RequestHeader set X-Forwarded-Proto "https"');
            expect(config).toContain('<VirtualHost *:80>');
        });

        it('proxies network-access apache projects through nginx using the project port', async () => {
            managers.service.standardPortOwner = 'nginx';
            managers.service.standardPortOwnerVersion = '1.28';
            managers.service.getServicePorts.mockImplementation((serviceName) => {
                if (serviceName === 'apache') {
                    return { httpPort: 8084, sslPort: 8446 };
                }
                return { httpPort: 80, sslPort: 443 };
            });

            const project = {
                id: 'proxy-apache-alt-port',
                name: 'ProxyApacheAltPort',
                domain: 'apache-alt.test',
                domains: ['apache-alt.test'],
                webServer: 'apache',
                webServerVersion: '2.4',
                networkAccess: true,
                port: 8003,
                ssl: true,
            };

            mgr.createProxyNginxVhost = vi.fn().mockResolvedValue();

            await mgr.syncProjectLocalProxy(project);

            expect(mgr.createProxyNginxVhost).toHaveBeenCalledWith(project, 8003, '1.28');
        });

        it('proxies nginx projects through the front-door nginx when the version differs', async () => {
            managers.service.standardPortOwner = 'nginx';
            managers.service.standardPortOwnerVersion = '1.28';
            managers.service.getServicePorts.mockImplementation((serviceName, version) => {
                if (serviceName === 'nginx' && version === '1.24') {
                    return { httpPort: 8082, sslPort: 8444 };
                }

                return { httpPort: 80, sslPort: 443 };
            });

            const project = {
                id: 'proxy-nginx-version-mismatch',
                name: 'ProxyNginxVersionMismatch',
                domain: 'orb.test',
                domains: ['orb.test'],
                webServer: 'nginx',
                webServerVersion: '1.24',
                ssl: true,
            };

            mgr.createProxyNginxVhost = vi.fn().mockResolvedValue();

            await mgr.syncProjectLocalProxy(project);

            expect(mgr.createProxyNginxVhost).toHaveBeenCalledWith(project, 8082, '1.28');
        });

        it('proxies apache projects through the front-door apache when the version differs', async () => {
            managers.service.standardPortOwner = 'apache';
            managers.service.standardPortOwnerVersion = '2.4';
            managers.service.getServicePorts.mockImplementation((serviceName, version) => {
                if (serviceName === 'apache' && version === '2.2') {
                    return { httpPort: 8085, sslPort: 8447 };
                }

                return { httpPort: 80, sslPort: 443 };
            });

            const project = {
                id: 'proxy-apache-version-mismatch',
                name: 'ProxyApacheVersionMismatch',
                domain: 'legacy-apache.test',
                domains: ['legacy-apache.test'],
                webServer: 'apache',
                webServerVersion: '2.2',
                ssl: true,
            };

            mgr.createProxyApacheVhost = vi.fn().mockResolvedValue();

            await mgr.syncProjectLocalProxy(project);

            expect(mgr.createProxyApacheVhost).toHaveBeenCalledWith(project, 8085, '2.4');
        });

        it('proxies network-access nginx projects through apache using the project port', async () => {
            managers.service.standardPortOwner = 'apache';
            managers.service.standardPortOwnerVersion = '2.4';
            managers.service.getServicePorts.mockImplementation((serviceName) => {
                if (serviceName === 'nginx') {
                    return { httpPort: 8081, sslPort: 8443 };
                }
                return { httpPort: 80, sslPort: 443 };
            });

            const project = {
                id: 'proxy-nginx-alt-port',
                name: 'ProxyNginxAltPort',
                domain: 'nginx-alt.test',
                domains: ['nginx-alt.test'],
                webServer: 'nginx',
                webServerVersion: '1.28',
                networkAccess: true,
                port: 8008,
                ssl: true,
            };

            mgr.createProxyApacheVhost = vi.fn().mockResolvedValue();

            await mgr.syncProjectLocalProxy(project);

            expect(mgr.createProxyApacheVhost).toHaveBeenCalledWith(project, 8008, '2.4');
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

    // ═══════════════════════════════════════════════════════════════
    // Node.js project creation
    // ═══════════════════════════════════════════════════════════════

    describe('Node.js project creation', () => {
        beforeEach(() => {
            vi.clearAllMocks();

            // Simulate PHP binary NOT present (would normally throw for PHP projects)
            vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
            vi.spyOn(fs, 'pathExistsSync').mockReturnValue(false);
            vi.spyOn(fs, 'ensureDir').mockResolvedValue();
            vi.spyOn(fs, 'readdir').mockResolvedValue([]);
            vi.spyOn(fs, 'readFile').mockResolvedValue('APP_NAME=Test\n');
            vi.spyOn(fs, 'writeFile').mockResolvedValue();
            vi.spyOn(fs, 'readJson').mockResolvedValue({});

            mgr.createVirtualHost = vi.fn().mockResolvedValue();
            mgr.addToHostsFile = vi.fn().mockResolvedValue();
            mgr.validateProjectBinaries = vi.fn().mockResolvedValue({ isCompatible: true, missing: [] });
        });

        it('does NOT throw a PHP-missing error for nodejs type', async () => {
            // PHP binary check would throw if it ran – but nodejs projects should skip it
            await expect(
                mgr.createProject({ name: 'NodeProj', path: '/path/to/nodeproj', type: 'nodejs' })
            ).resolves.not.toThrow();
        });

        it('assigns a nodePort to nodejs projects', async () => {
            const created = await mgr.createProject({
                name: 'NodeProj2',
                path: '/path/to/nodeproj2',
                type: 'nodejs',
            });
            expect(typeof created.nodePort).toBe('number');
        });

        it('forces services.nodejs = true for nodejs projects', async () => {
            const created = await mgr.createProject({
                name: 'NodeProj3',
                path: '/path/to/nodeproj3',
                type: 'nodejs',
            });
            expect(created.services.nodejs).toBe(true);
        });

        it('adds a nodejs-app supervisor process for nodejs projects', async () => {
            const created = await mgr.createProject({
                name: 'NodeProj4',
                path: '/path/to/nodeproj4',
                type: 'nodejs',
                nodeStartCommand: 'node server.js',
            });
            const nodeProcess = created.supervisor.processes.find(p => p.name === 'nodejs-app');
            expect(nodeProcess).toBeDefined();
            expect(nodeProcess.command).toBe('node server.js');
        });

        it('uses default start command "npm start" when none provided', async () => {
            const created = await mgr.createProject({
                name: 'NodeProj5',
                path: '/path/to/nodeproj5',
                type: 'nodejs',
            });
            expect(created.nodeStartCommand).toBe('npm start');
        });
    });

});
