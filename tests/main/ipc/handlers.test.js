/**
 * Tests for src/main/ipc/handlers.js
 *
 * Phase 4 – IPC Handler tests.
 * Verifies that setupIpcHandlers registers the expected channels
 * and that handlers route to the correct manager methods.
 *
 * Strategy: pass a mock ipcMain that captures all registered handlers,
 * then call each handler and verify it delegates to the correct manager.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../helpers/mockElectronCjs');
const { setupIpcHandlers } = require('../../../src/main/ipc/handlers');

describe('IPC Handlers', () => {
    let handlers;
    let mockIpcMain;
    let mockManagers;
    let mockMainWindow;
    const fakeEvent = {};

    beforeEach(() => {
        // Capture every ipcMain.handle(channel, fn) call
        handlers = {};
        mockIpcMain = {
            handle: vi.fn((channel, fn) => {
                handlers[channel] = fn;
            }),
        };

        mockMainWindow = {
            webContents: { send: vi.fn() },
            isDestroyed: () => false,
        };

        // Stub managers with spy methods
        mockManagers = {
            config: {
                get: vi.fn((key, def) => def),
                set: vi.fn(),
                getAll: vi.fn(() => ({ settings: {} })),
                reset: vi.fn(),
                getAppCachePath: vi.fn(() => '/app-cache'),
                getResourcesPath: vi.fn(() => '/app-cache/resources'),
                getDataPath: vi.fn(() => '/runtime-data'),
            },
            project: {
                getAllProjects: vi.fn(async () => []),
                getProject: vi.fn((id) => ({ id, path: '/test', domain: 'test.test', phpVersion: '8.3', webServer: 'nginx' })),
                createProject: vi.fn(async (cfg) => ({ id: 'new-1', ...cfg })),
                updateProject: vi.fn(async () => ({ success: true })),
                deleteProject: vi.fn(async () => ({ success: true })),
                startProject: vi.fn(async () => ({ success: true })),
                stopProject: vi.fn(async () => ({ success: true })),
                getProjectStatus: vi.fn(async () => ({ running: false })),
                scanUnregisteredProjects: vi.fn(async () => []),
                registerExistingProject: vi.fn(async () => ({})),
                detectProjectTypeFromPath: vi.fn(async () => 'laravel'),
                readEnvFile: vi.fn(async () => ''),
                exportProjectConfig: vi.fn(async () => ({})),
                moveProject: vi.fn(async () => ({ success: true })),
                switchWebServer: vi.fn(async () => ({ success: true })),
                createVirtualHost: vi.fn(async () => { }),
                getProjectLocalAccessPorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
                getProjectServiceVersions: vi.fn(async () => ({})),
                updateProjectServiceVersions: vi.fn(async () => ({})),
                checkCompatibility: vi.fn(async () => ({ warnings: [] })),
                getCompatibilityRules: vi.fn(async () => []),
                checkCompatibilityUpdates: vi.fn(async () => ({})),
                applyCompatibilityUpdates: vi.fn(async () => ({})),
                getCompatibilityConfigInfo: vi.fn(async () => ({})),
            },
            php: {
                getAvailableVersions: vi.fn(() => []),
                getExtensions: vi.fn(() => []),
                toggleExtension: vi.fn(async () => ({ success: true })),
                runCommand: vi.fn(async () => ({ success: true, output: '' })),
                runArtisan: vi.fn(async () => ({ success: true, output: '' })),
            },
            service: {
                getAllServicesStatus: vi.fn(async () => ({})),
                startService: vi.fn(async () => ({ success: true })),
                stopService: vi.fn(async () => ({ success: true })),
                restartService: vi.fn(async () => ({ success: true })),
                startAllServices: vi.fn(async () => ({ success: true })),
                stopAllServices: vi.fn(async () => ({ success: true })),
                getResourceUsage: vi.fn(async () => ({ total: { cpu: 0, memory: 0 } })),
                getServicePorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
                getRunningVersions: vi.fn(() => new Map()),
                getAllRunningVersions: vi.fn(() => new Map()),
                isVersionRunning: vi.fn(() => false),
                syncCredentialsToAllVersions: vi.fn(async () => ({ success: true })),
            },
            database: {
                getConnections: vi.fn(async () => []),
                listDatabases: vi.fn(async () => []),
                createDatabase: vi.fn(async () => ({ success: true })),
                deleteDatabase: vi.fn(async () => ({ success: true })),
                importDatabase: vi.fn(async () => ({ success: true })),
                exportDatabase: vi.fn(async () => ({ success: true })),
                runQuery: vi.fn(async () => ({ rows: [] })),
                getPhpMyAdminUrl: vi.fn(async () => 'http://localhost/phpmyadmin'),
                getActiveDatabaseType: vi.fn(async () => 'mysql'),
                setActiveDatabaseType: vi.fn(async () => ({ success: true })),
                getDatabaseInfo: vi.fn(async () => ({})),
                resetCredentials: vi.fn(async () => ({ success: true })),
                cancelOperation: vi.fn(async () => ({ success: true })),
                getRunningOperations: vi.fn(async () => []),
            },
            ssl: {
                listCertificates: vi.fn(async () => ({})),
                createCertificate: vi.fn(async () => ({ success: true })),
                deleteCertificate: vi.fn(async () => ({ success: true })),
                trustCertificate: vi.fn(async () => ({ success: true })),
                promptTrustRootCA: vi.fn(async () => ({ success: true })),
            },
            supervisor: {
                getProcesses: vi.fn(async () => []),
                addProcess: vi.fn(async () => ({ success: true })),
                removeProcess: vi.fn(async () => ({ success: true })),
                startProcess: vi.fn(async () => ({ success: true })),
                stopProcess: vi.fn(async () => ({ success: true })),
                restartProcess: vi.fn(async () => ({ success: true })),
                getWorkerLogs: vi.fn(async () => []),
                clearWorkerLogs: vi.fn(async () => ({ success: true })),
                getAllWorkerLogsForProject: vi.fn(async () => []),
            },
            log: {
                getProjectLogs: vi.fn(async () => []),
                getServiceLogs: vi.fn(async () => []),
                clearProjectLogs: vi.fn(async () => ({ success: true })),
                clearServiceLogs: vi.fn(async () => ({ success: true })),
                streamLogs: vi.fn(),
                getSystemLogs: vi.fn(async () => []),
                clearSystemLogs: vi.fn(async () => ({ success: true })),
                systemInfo: vi.fn(),
                systemError: vi.fn(),
            },
            update: {
                checkForUpdates: vi.fn(async () => ({ success: true, updateAvailable: false })),
                downloadUpdate: vi.fn(async () => ({ success: true })),
                quitAndInstall: vi.fn(),
                getStatus: vi.fn(() => ({ currentVersion: '1.0.0' })),
            },
            binaryDownload: {
                getInstalledBinaries: vi.fn(async () => ({})),
                getActiveDownloads: vi.fn(async () => ({})),
                checkForUpdates: vi.fn(async () => ({ success: true })),
                checkForServiceUpdates: vi.fn(async () => ({ composer: { updateAvailable: false }, phpmyadmin: { updateAvailable: false } })),
                applyUpdates: vi.fn(async () => ({ success: true })),
                getVersionMeta: vi.fn(() => ({})),
                getDownloadUrls: vi.fn(() => ({})),
                downloadPhp: vi.fn(async () => ({ success: true })),
                downloadMysql: vi.fn(async () => ({ success: true })),
                downloadMariadb: vi.fn(async () => ({ success: true })),
                downloadRedis: vi.fn(async () => ({ success: true })),
                downloadMailpit: vi.fn(async () => ({ success: true })),
                downloadPhpMyAdmin: vi.fn(async () => ({ success: true })),
                downloadNginx: vi.fn(async () => ({ success: true })),
                downloadApache: vi.fn(async () => ({ success: true })),
                importApache: vi.fn(async () => ({ success: true })),
                importBinary: vi.fn(async () => ({ success: true })),
                downloadNodejs: vi.fn(async () => ({ success: true })),
                downloadComposer: vi.fn(async () => ({ success: true })),
                downloadGit: vi.fn(async () => ({ success: true })),
                downloadPostgresql: vi.fn(async () => ({ success: true })),
                downloadPython: vi.fn(async () => ({ success: true })),
                downloadMongodb: vi.fn(async () => ({ success: true })),
                downloadSqlite: vi.fn(async () => ({ success: true })),
                downloadMinio: vi.fn(async () => ({ success: true })),
                downloadMemcached: vi.fn(async () => ({ success: true })),
                downloadCloudflared: vi.fn(async () => ({ success: true })),
                downloadZrok: vi.fn(async () => ({ success: true })),
                runPip: vi.fn(async () => ({ success: true })),
                cancelDownload: vi.fn(async () => ({ success: true })),
                runComposer: vi.fn(async () => ({ success: true })),
                runNpm: vi.fn(async () => ({ success: true })),
                getRunningConflicts: vi.fn(async () => ({ hasConflicts: false, items: [] })),
                removeBinary: vi.fn(async () => ({ success: true })),
                scanCustomVersions: vi.fn(async () => ({})),
                addProgressListener: vi.fn(),
                resourcesPath: '/app-cache/resources',
            },
            tunnel: {
                setStatusEmitter: vi.fn(),
                startTunnel: vi.fn(async () => ({ status: 'running', publicUrl: 'https://example.trycloudflare.com' })),
                stopTunnel: vi.fn(async () => ({ success: true })),
                getTunnelStatus: vi.fn(() => null),
                getAllTunnelStatuses: vi.fn(() => ({})),
                enableZrok: vi.fn(async () => ({ success: true })),
                getZrokStatus: vi.fn(async () => ({ enabled: true, configuredAt: '2026-04-01T10:00:00.000Z' })),
            },
        };

        setupIpcHandlers(mockIpcMain, mockManagers, mockMainWindow);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Handler Registration
    // ═══════════════════════════════════════════════════════════════════

    describe('Handler Registration', () => {
        it('registers all project handlers', () => {
            const projectChannels = [
                'projects:getAll', 'projects:getById', 'projects:create',
                'projects:update', 'projects:delete', 'projects:start',
                'projects:stop', 'projects:restart', 'projects:getStatus',
                'projects:openInEditor', 'projects:openInBrowser', 'projects:openFolder',
                'projects:scanUnregistered', 'projects:registerExisting',
                'projects:detectType', 'projects:readEnv', 'projects:exportConfig',
                'projects:move', 'projects:switchWebServer',
                'projects:checkCompatibility',
            ];
            for (const channel of projectChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers all service handlers', () => {
            const serviceChannels = [
                'services:getStatus', 'services:start', 'services:stop',
                'services:restart', 'services:startAll', 'services:stopAll',
                'services:getResourceUsage', 'services:getWebServerPorts',
                'services:getProjectLocalAccessPorts', 'services:getProjectNetworkPort', 'services:getRunningVersions',
                'services:isVersionRunning',
            ];
            for (const channel of serviceChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers all database handlers', () => {
            const dbChannels = [
                'database:getConnections', 'database:getDatabases',
                'database:createDatabase', 'database:deleteDatabase',
                'database:importDatabase', 'database:exportDatabase',
                'database:runQuery', 'database:getPhpMyAdminUrl',
                'database:getActiveDatabaseType', 'database:setActiveDatabaseType',
                'database:getDatabaseInfo', 'database:resetCredentials',
                'database:syncCredentialsToAllVersions', 'database:cancelOperation',
                'database:getRunningOperations',
            ];
            for (const channel of dbChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers SSL handlers', () => {
            const sslChannels = [
                'ssl:getCertificates', 'ssl:createCertificate',
                'ssl:deleteCertificate', 'ssl:trustCertificate',
                'ssl:trustRootCA', 'ssl:getRootCAPath',
            ];
            for (const channel of sslChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers supervisor handlers', () => {
            const supervisorChannels = [
                'supervisor:getProcesses', 'supervisor:addProcess',
                'supervisor:removeProcess', 'supervisor:startProcess',
                'supervisor:stopProcess', 'supervisor:restartProcess',
                'supervisor:getWorkerLogs', 'supervisor:clearWorkerLogs',
                'supervisor:getAllWorkerLogs',
            ];
            for (const channel of supervisorChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers log handlers', () => {
            const logChannels = [
                'logs:getProjectLogs', 'logs:getServiceLogs',
                'logs:clearProjectLogs', 'logs:clearServiceLogs',
                'logs:streamLogs', 'logs:getSystemLogs', 'logs:clearSystemLogs',
            ];
            for (const channel of logChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers settings handlers', () => {
            const settingsChannels = [
                'settings:get', 'settings:set', 'settings:getAll', 'settings:reset',
            ];
            for (const channel of settingsChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers system handlers', () => {
            const systemChannels = [
                'system:selectDirectory', 'system:selectFile', 'system:saveFile',
                'system:openExternal', 'system:openPath', 'system:getAppDataPath',
                'system:getAppVersion', 'system:getPlatform',
            ];
            for (const channel of systemChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers update handlers', () => {
            const updateChannels = [
                'update:checkForUpdates', 'update:downloadUpdate',
                'update:quitAndInstall', 'update:getStatus',
            ];
            for (const channel of updateChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers compatibility handlers', () => {
            const compatChannels = [
                'compatibility:checkForUpdates', 'compatibility:applyUpdates',
                'compatibility:getConfigInfo',
            ];
            for (const channel of compatChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers binary handlers including Composer download', () => {
            const binaryChannels = [
                'binaries:getInstalled', 'binaries:getDownloadUrls',
                'binaries:downloadPhp', 'binaries:downloadPhpMyAdmin',
                'binaries:downloadNodejs', 'binaries:downloadComposer',
                'binaries:downloadCloudflared', 'binaries:downloadZrok',
                'binaries:downloadGit', 'binaries:runComposer',
                'binaries:getRunningConflicts', 'binaries:remove',
            ];
            for (const channel of binaryChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

        it('registers tunnel handlers', () => {
            const tunnelChannels = [
                'tunnel:start', 'tunnel:stop', 'tunnel:getStatus',
                'tunnel:getAllStatuses', 'tunnel:zrokEnable', 'tunnel:zrokStatus',
            ];

            for (const channel of tunnelChannels) {
                expect(handlers[channel], `Missing handler: ${channel}`).toBeDefined();
            }
        });

    });

    // ═══════════════════════════════════════════════════════════════════
    // Project Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('Project handler routing', () => {
        it('projects:getAll routes to project.getAllProjects', async () => {
            await handlers['projects:getAll'](fakeEvent);
            expect(mockManagers.project.getAllProjects).toHaveBeenCalled();
        });

        it('projects:getById routes to project.getProject', async () => {
            await handlers['projects:getById'](fakeEvent, 'proj-1');
            expect(mockManagers.project.getProject).toHaveBeenCalledWith('proj-1');
        });

        it('projects:create routes to project.createProject and sends IPC', async () => {
            const cfg = { name: 'Test' };
            await handlers['projects:create'](fakeEvent, cfg);
            expect(mockManagers.project.createProject).toHaveBeenCalledWith(cfg, mockMainWindow);
            expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
                'project:statusChanged',
                expect.objectContaining({ status: 'created' }),
            );
        });

        it('projects:delete routes to project.deleteProject', async () => {
            await handlers['projects:delete'](fakeEvent, 'proj-1', true);
            expect(mockManagers.project.deleteProject).toHaveBeenCalledWith('proj-1', true);
        });

        it('projects:start sends statusChanged event', async () => {
            await handlers['projects:start'](fakeEvent, 'proj-1');
            expect(mockManagers.project.startProject).toHaveBeenCalledWith('proj-1');
            expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
                'project:statusChanged',
                expect.objectContaining({ id: 'proj-1', status: 'running' }),
            );
        });

        it('projects:stop sends statusChanged event', async () => {
            await handlers['projects:stop'](fakeEvent, 'proj-1');
            expect(mockManagers.project.stopProject).toHaveBeenCalledWith('proj-1');
            expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
                'project:statusChanged',
                expect.objectContaining({ status: 'stopped' }),
            );
        });

        it('projects:restart calls stop then start', async () => {
            await handlers['projects:restart'](fakeEvent, 'proj-1');
            expect(mockManagers.project.stopProject).toHaveBeenCalledWith('proj-1');
            expect(mockManagers.project.startProject).toHaveBeenCalledWith('proj-1');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Service Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('Service handler routing', () => {
        it('services:getStatus routes to service.getAllServicesStatus', async () => {
            await handlers['services:getStatus'](fakeEvent);
            expect(mockManagers.service.getAllServicesStatus).toHaveBeenCalled();
        });

        it('services:start sends statusChanged event', async () => {
            await handlers['services:start'](fakeEvent, 'mysql', '8.4');
            expect(mockManagers.service.startService).toHaveBeenCalledWith('mysql', '8.4');
            expect(mockMainWindow.webContents.send).toHaveBeenCalledWith(
                'service:statusChanged',
                expect.objectContaining({ service: 'mysql', status: 'running' }),
            );
        });

        it('services:stop sends statusChanged event', async () => {
            await handlers['services:stop'](fakeEvent, 'nginx');
            expect(mockManagers.service.stopService).toHaveBeenCalledWith('nginx', null);
        });

        it('services:startAll routes correctly', async () => {
            await handlers['services:startAll'](fakeEvent);
            expect(mockManagers.service.startAllServices).toHaveBeenCalled();
        });

        it('services:stopAll routes correctly', async () => {
            await handlers['services:stopAll'](fakeEvent);
            expect(mockManagers.service.stopAllServices).toHaveBeenCalled();
        });

        it('services:getProjectLocalAccessPorts routes to project.getProjectLocalAccessPorts', async () => {
            await handlers['services:getProjectLocalAccessPorts'](fakeEvent, 'proj-1');

            expect(mockManagers.project.getProject).toHaveBeenCalledWith('proj-1');
            expect(mockManagers.project.getProjectLocalAccessPorts).toHaveBeenCalledWith(
                expect.objectContaining({ id: 'proj-1' })
            );
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Database Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('Database handler routing', () => {
        it('database:getDatabases routes to database.listDatabases', async () => {
            await handlers['database:getDatabases'](fakeEvent);
            expect(mockManagers.database.listDatabases).toHaveBeenCalled();
        });

        it('database:createDatabase passes name', async () => {
            await handlers['database:createDatabase'](fakeEvent, 'mydb');
            expect(mockManagers.database.createDatabase).toHaveBeenCalledWith('mydb');
        });

        it('database:runQuery passes database name and query', async () => {
            await handlers['database:runQuery'](fakeEvent, 'testdb', 'SELECT 1');
            expect(mockManagers.database.runQuery).toHaveBeenCalledWith('testdb', 'SELECT 1');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // SSL Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('SSL handler routing', () => {
        it('ssl:getCertificates routes to ssl.listCertificates', async () => {
            await handlers['ssl:getCertificates'](fakeEvent);
            expect(mockManagers.ssl.listCertificates).toHaveBeenCalled();
        });

        it('ssl:createCertificate passes domains', async () => {
            await handlers['ssl:createCertificate'](fakeEvent, ['test.test']);
            expect(mockManagers.ssl.createCertificate).toHaveBeenCalledWith(['test.test']);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Log Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('Log handler routing', () => {
        it('logs:getProjectLogs passes projectId and lines', async () => {
            await handlers['logs:getProjectLogs'](fakeEvent, 'proj-1', 50);
            expect(mockManagers.log.getProjectLogs).toHaveBeenCalledWith('proj-1', 50);
        });

        it('logs:clearSystemLogs routes correctly', async () => {
            await handlers['logs:clearSystemLogs'](fakeEvent);
            expect(mockManagers.log.clearSystemLogs).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Settings Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('Settings handler routing', () => {
        it('settings:getAll routes to config.getAll', async () => {
            await handlers['settings:getAll'](fakeEvent);
            expect(mockManagers.config.getAll).toHaveBeenCalled();
        });

        it('settings:get routes to config.get', async () => {
            await handlers['settings:get'](fakeEvent, 'theme');
            expect(mockManagers.config.get).toHaveBeenCalledWith('theme');
        });

        it('settings:set routes to config.set', async () => {
            await handlers['settings:set'](fakeEvent, 'theme', 'dark');
            expect(mockManagers.config.set).toHaveBeenCalledWith('theme', 'dark');
        });

        it('settings:reset routes to config.reset', async () => {
            await handlers['settings:reset'](fakeEvent);
            expect(mockManagers.config.reset).toHaveBeenCalled();
        });
    });

    describe('System handler routing', () => {
        it('system:getAppDataPath routes to config.getAppCachePath', async () => {
            const result = await handlers['system:getAppDataPath'](fakeEvent);

            expect(mockManagers.config.getAppCachePath).toHaveBeenCalled();
            expect(result).toBe('/app-cache');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Update Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('Update handler routing', () => {
        it('update:checkForUpdates routes to update.checkForUpdates', async () => {
            await handlers['update:checkForUpdates'](fakeEvent);
            expect(mockManagers.update.checkForUpdates).toHaveBeenCalled();
        });

        it('update:getStatus routes to update.getStatus', async () => {
            await handlers['update:getStatus'](fakeEvent);
            expect(mockManagers.update.getStatus).toHaveBeenCalled();
        });

        it('update:quitAndInstall calls manager.quitAndInstall', async () => {
            await handlers['update:quitAndInstall'](fakeEvent);
            expect(mockManagers.update.quitAndInstall).toHaveBeenCalled();
        });

        it('update:checkForUpdates returns error when manager missing', async () => {
            // Re-setup without update manager
            const noUpdateManagers = { ...mockManagers, update: undefined };
            const handlers2 = {};
            mockIpcMain.handle.mockImplementation((ch, fn) => { handlers2[ch] = fn; });
            setupIpcHandlers(mockIpcMain, noUpdateManagers, mockMainWindow);
            const result = await handlers2['update:checkForUpdates'](fakeEvent);
            expect(result.success).toBe(false);
            expect(result.error).toContain('not initialized');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // System Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('System handler routing', () => {
        it('system:getAppVersion returns version', async () => {
            const version = await handlers['system:getAppVersion'](fakeEvent);
            expect(typeof version).toBe('string');
        });

        it('system:getPlatform returns process.platform', async () => {
            const platform = await handlers['system:getPlatform'](fakeEvent);
            expect(platform).toBe(process.platform);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // PHP Handler Routing
    // ═══════════════════════════════════════════════════════════════════

    describe('PHP handler routing', () => {
        it('php:getVersions routes to php.getAvailableVersions', async () => {
            await handlers['php:getVersions'](fakeEvent);
            expect(mockManagers.php.getAvailableVersions).toHaveBeenCalled();
        });

        it('php:toggleExtension passes version, extension, enabled', async () => {
            await handlers['php:toggleExtension'](fakeEvent, '8.3', 'curl', true);
            expect(mockManagers.php.toggleExtension).toHaveBeenCalledWith('8.3', 'curl', true);
        });

        it('php:runCommand resolves project and runs command', async () => {
            await handlers['php:runCommand'](fakeEvent, 'proj-1', 'echo "hi";');
            expect(mockManagers.project.getProject).toHaveBeenCalledWith('proj-1');
            expect(mockManagers.php.runCommand).toHaveBeenCalledWith('8.3', '/test', 'echo "hi";');
        });
    });

    describe('Compatibility handler routing', () => {
        it('compatibility:checkForUpdates routes to project.checkCompatibilityUpdates', async () => {
            await handlers['compatibility:checkForUpdates'](fakeEvent);
            expect(mockManagers.project.checkCompatibilityUpdates).toHaveBeenCalled();
        });

        it('compatibility:getConfigInfo routes to project.getCompatibilityConfigInfo', async () => {
            await handlers['compatibility:getConfigInfo'](fakeEvent);
            expect(mockManagers.project.getCompatibilityConfigInfo).toHaveBeenCalled();
        });
    });

    describe('Binary handler routing', () => {
        it('binaries:downloadComposer routes to binaryDownload.downloadComposer', async () => {
            await handlers['binaries:downloadComposer'](fakeEvent);
            expect(mockManagers.binaryDownload.downloadComposer).toHaveBeenCalled();
        });

        it('binaries:downloadCloudflared routes to binaryDownload.downloadCloudflared', async () => {
            await handlers['binaries:downloadCloudflared'](fakeEvent);
            expect(mockManagers.binaryDownload.downloadCloudflared).toHaveBeenCalled();
        });

        it('binaries:downloadZrok routes to binaryDownload.downloadZrok', async () => {
            await handlers['binaries:downloadZrok'](fakeEvent);
            expect(mockManagers.binaryDownload.downloadZrok).toHaveBeenCalled();
        });

        it('binaries:remove routes to binaryDownload.removeBinary', async () => {
            await handlers['binaries:remove'](fakeEvent, 'php', '8.3', false);
            expect(mockManagers.binaryDownload.removeBinary).toHaveBeenCalledWith('php', '8.3', false);
        });
    });

    describe('Tunnel handler routing', () => {
        it('tunnel:start routes to tunnel.startTunnel', async () => {
            await handlers['tunnel:start'](fakeEvent, 'proj-1', 'cloudflared');
            expect(mockManagers.tunnel.startTunnel).toHaveBeenCalledWith('proj-1', 'cloudflared');
        });

        it('tunnel:zrokEnable routes to tunnel.enableZrok', async () => {
            await handlers['tunnel:zrokEnable'](fakeEvent, 'token-123');
            expect(mockManagers.tunnel.enableZrok).toHaveBeenCalledWith('token-123');
        });
    });
});
