/**
 * Tests for src/main/services/WebServerManager.js
 *
 * Phase 3.7 – Tests for config generation, path helpers, server type management,
 * cleanup, and stop logic. Process spawning is mocked via child_process.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

// ── Mock child_process ────────────────────────────────────────────────────────
vi.mock('child_process', () => {
    const mockProcess = {
        pid: 1234,
        unref: vi.fn(),
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
    };
    return { spawn: vi.fn(() => mockProcess) };
});

// ── Mock tree-kill ────────────────────────────────────────────────────────────
vi.mock('tree-kill', () => ({
    default: vi.fn((_pid, _signal, cb) => cb && cb()),
}));

const fs = require('fs-extra');
require('../../helpers/mockElectronCjs');
const { WebServerManager } = require('../../../src/main/services/WebServerManager');
const { spawn } = require('child_process');

// ─────────────────────────────────────────────────────────────────────────────

function makeConfigStore(overrides = {}) {
    const store = {
        'settings.webServer': 'nginx',
        projects: [],
        ...overrides,
    };
    return {
        get: vi.fn((key, def) => (key in store ? store[key] : def)),
        set: vi.fn((key, val) => { store[key] = val; }),
    };
}

function makeManager(configStoreOverrides = {}) {
    const configStore = makeConfigStore(configStoreOverrides);
    const mgr = new WebServerManager(configStore, {});
    // Override paths to use temp dir for test isolation
    mgr.dataPath = path.join(os.tmpdir(), `wsm-test-${Date.now()}`);
    mgr.resourcesPath = path.join(os.tmpdir(), `wsm-res-${Date.now()}`);
    return { mgr, configStore };
}

describe('WebServerManager', () => {
    let mgr, configStore, tmpDir;

    beforeEach(async () => {
        ({ mgr, configStore } = makeManager());
        tmpDir = mgr.dataPath;
        await fs.ensureDir(tmpDir);
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await fs.remove(tmpDir).catch(() => { });
    });

    // ═══════════════════════════════════════════════════════════════════
    // constructor / initialize()
    // ═══════════════════════════════════════════════════════════════════

    describe('constructor', () => {
        it('sets default serverType to nginx', () => {
            expect(mgr.serverType).toBe('nginx');
        });

        it('initializes processes as empty Map', () => {
            expect(mgr.processes.size).toBe(0);
        });
    });

    describe('initialize()', () => {
        it('creates required directories', async () => {
            configStore.get.mockImplementation((key, def) => {
                if (key === 'settings.webServer') return 'nginx';
                if (key === 'projects') return [];
                return def;
            });

            await mgr.initialize();

            expect(await fs.pathExists(path.join(tmpDir, 'nginx'))).toBe(true);
            expect(await fs.pathExists(path.join(tmpDir, 'apache'))).toBe(true);
            expect(await fs.pathExists(path.join(tmpDir, 'php-fpm'))).toBe(true);
        });

        it('loads serverType from config', async () => {
            configStore.get.mockImplementation((key, def) => {
                if (key === 'settings.webServer') return 'apache';
                if (key === 'projects') return [];
                return def;
            });

            await mgr.initialize();
            expect(mgr.serverType).toBe('apache');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getPlatform()
    // ═══════════════════════════════════════════════════════════════════

    describe('getPlatform()', () => {
        it('returns "win" on Windows', () => {
            const original = process.platform;
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            expect(mgr.getPlatform()).toBe('win');
            Object.defineProperty(process, 'platform', { value: original, configurable: true });
        });

        it('returns "mac" on Darwin', () => {
            const original = process.platform;
            Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
            expect(mgr.getPlatform()).toBe('mac');
            Object.defineProperty(process, 'platform', { value: original, configurable: true });
        });

        it('returns "linux" on Linux', () => {
            const original = process.platform;
            Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
            expect(mgr.getPlatform()).toBe('linux');
            Object.defineProperty(process, 'platform', { value: original, configurable: true });
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // setServerType() / getServerType()
    // ═══════════════════════════════════════════════════════════════════

    describe('setServerType()', () => {
        it('sets valid type nginx', () => {
            mgr.setServerType('nginx');
            expect(mgr.getServerType()).toBe('nginx');
        });

        it('sets valid type apache', () => {
            mgr.setServerType('apache');
            expect(mgr.getServerType()).toBe('apache');
        });

        it('throws for invalid type', () => {
            expect(() => mgr.setServerType('iis')).toThrow('Invalid server type');
        });

        it('saves type to configStore', () => {
            mgr.setServerType('apache');
            expect(configStore.set).toHaveBeenCalledWith('settings.webServer', 'apache');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Path helpers
    // ═══════════════════════════════════════════════════════════════════

    describe('getNginxPath()', () => {
        it('constructs correct path for given version on win', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const p = mgr.getNginxPath('1.28');
            expect(p).toContain(path.join('nginx', '1.28', 'win', 'nginx.exe'));
            Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
        });

        it('defaults to version 1.28', () => {
            const p = mgr.getNginxPath();
            expect(p).toContain('1.28');
        });
    });

    describe('getApachePath()', () => {
        it('constructs correct path for given version on win', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const p = mgr.getApachePath('2.4');
            expect(p).toContain(path.join('apache', '2.4', 'win', 'bin', 'httpd.exe'));
            Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
        });

        it('defaults to version 2.4', () => {
            const p = mgr.getApachePath();
            expect(p).toContain('2.4');
        });
    });

    describe('getPhpCgiPath()', () => {
        it('uses php-cgi.exe on windows', () => {
            Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
            const p = mgr.getPhpCgiPath('8.3');
            expect(p).toContain('php-cgi.exe');
            Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
        });

        it('defaults to version 8.3', () => {
            const p = mgr.getPhpCgiPath();
            expect(p).toContain('8.3');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getLocalIpAddresses()
    // ═══════════════════════════════════════════════════════════════════

    describe('getLocalIpAddresses()', () => {
        it('returns an array', () => {
            const result = mgr.getLocalIpAddresses();
            expect(Array.isArray(result)).toBe(true);
        });

        it('filters out IPv6 and internal addresses', () => {
            const result = mgr.getLocalIpAddresses();
            for (const addr of result) {
                // All returned addresses must be IPv4 non-loopback
                expect(addr).not.toBe('127.0.0.1');
                expect(addr).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
            }
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // generateNginxConfig()
    // ═══════════════════════════════════════════════════════════════════

    describe('generateNginxConfig()', () => {
        const baseProject = {
            id: 'proj-abcd1234',
            name: 'My Project',
            domain: 'myproject.test',
            path: '/home/user/projects/myproject',
            phpVersion: '8.3',
            port: 8081,
            sslPort: 443,
            ssl: false,
            networkAccess: false,
        };

        beforeEach(async () => {
            // Mock fs.pathExists so doc root fallback works
            vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
            vi.spyOn(fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
            vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(fs, 'readdir').mockResolvedValue([]);
            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects') return [baseProject];
                return def;
            });
        });

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it('generates config with project domain', async () => {
            // Capture the written config
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => {
                capturedConfig = content;
            });

            await mgr.generateNginxConfig(baseProject);
            expect(capturedConfig).toContain('myproject.test');
        });

        it('returns configPath and phpFpmPort', async () => {
            const result = await mgr.generateNginxConfig(baseProject);
            expect(result).toHaveProperty('configPath');
            expect(result).toHaveProperty('phpFpmPort');
            expect(typeof result.phpFpmPort).toBe('number');
        });

        it('adds SSL server block when ssl=true', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => {
                capturedConfig = content;
            });

            await mgr.generateNginxConfig({ ...baseProject, ssl: true });
            expect(capturedConfig).toContain('ssl_certificate');
        });

        it('does not add SSL block when ssl=false', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => {
                capturedConfig = content;
            });

            await mgr.generateNginxConfig(baseProject);
            expect(capturedConfig).not.toContain('ssl_certificate');
        });

        it('saves conf file in correct location', async () => {
            let savedPath = '';
            fs.writeFile.mockImplementation(async (p) => { savedPath = p; });

            await mgr.generateNginxConfig(baseProject);
            expect(savedPath).toContain(path.join('nginx', 'sites'));
            expect(savedPath).toContain('proj-abcd1234.conf');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // generateApacheConfig()
    // ═══════════════════════════════════════════════════════════════════

    describe('generateApacheConfig()', () => {
        const baseProject = {
            id: 'proj-cafe5678',
            name: 'Apache Project',
            domain: 'apache.test',
            path: '/projects/apache',
            phpVersion: '8.2',
            port: 8082,
            sslPort: 443,
            ssl: false,
            networkAccess: false,
        };

        beforeEach(() => {
            vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
            vi.spyOn(fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
            vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects') return [baseProject];
                return def;
            });
        });

        afterEach(() => vi.restoreAllMocks());

        it('generates VirtualHost config', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });
            await mgr.generateApacheConfig(baseProject);
            expect(capturedConfig).toContain('<VirtualHost');
            expect(capturedConfig).toContain('apache.test');
        });

        it('saves conf file in vhosts directory', async () => {
            let savedPath = '';
            fs.writeFile.mockImplementation(async (p) => { savedPath = p; });
            await mgr.generateApacheConfig(baseProject);
            expect(savedPath).toContain(path.join('apache', 'vhosts'));
        });

        it('adds SSL VirtualHost when ssl=true', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });
            await mgr.generateApacheConfig({ ...baseProject, ssl: true });
            expect(capturedConfig).toContain('SSLEngine on');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // createMainNginxConfig()
    // ═══════════════════════════════════════════════════════════════════

    describe('createMainNginxConfig()', () => {
        it('writes nginx.conf with include directive', async () => {
            await fs.ensureDir(tmpDir);
            await mgr.createMainNginxConfig('1.28');
            const confPath = path.join(tmpDir, 'nginx', 'nginx.conf');
            const content = await fs.readFile(confPath, 'utf-8');
            expect(content).toContain('worker_processes');
            expect(content).toContain('include');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // createMainApacheConfig()
    // ═══════════════════════════════════════════════════════════════════

    describe('createMainApacheConfig()', () => {
        it('writes httpd.conf with IncludeOptional directive', async () => {
            await fs.ensureDir(tmpDir);
            await mgr.createMainApacheConfig('2.4');
            const confPath = path.join(tmpDir, 'apache', 'httpd.conf');
            const content = await fs.readFile(confPath, 'utf-8');
            expect(content).toContain('ServerRoot');
            expect(content).toContain('IncludeOptional');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // createPhpFpmConfig()
    // ═══════════════════════════════════════════════════════════════════

    describe('createPhpFpmConfig()', () => {
        it('writes php-fpm config with correct listen port', async () => {
            await fs.ensureDir(tmpDir);
            const project = { id: 'proj-1' };
            const configPath = await mgr.createPhpFpmConfig(project, 9001);
            const content = await fs.readFile(configPath, 'utf-8');
            expect(content).toContain('listen = 127.0.0.1:9001');
            expect(content).toContain('[www]');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // stopProject()
    // ═══════════════════════════════════════════════════════════════════

    describe('stopProject()', () => {
        it('returns success when project is not running', async () => {
            const result = await mgr.stopProject('nonexistent');
            expect(result).toEqual({ success: true, message: 'Project not running' });
        });

        it('kills processes and removes from map when running', async () => {
            vi.spyOn(fs, 'remove').mockResolvedValue(undefined);

            mgr.processes.set('proj-1', {
                phpFpm: { pid: 100 },
                server: { pid: 101 },
                serverType: 'nginx',
            });

            const result = await mgr.stopProject('proj-1');

            expect(result).toEqual({ success: true });
            expect(mgr.processes.has('proj-1')).toBe(false);

            vi.restoreAllMocks();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // stopAll()
    // ═══════════════════════════════════════════════════════════════════

    describe('stopAll()', () => {
        it('stops all tracked projects', async () => {
            vi.spyOn(fs, 'remove').mockResolvedValue(undefined);

            mgr.processes.set('p1', { phpFpm: { pid: 1 }, server: { pid: 2 }, serverType: 'nginx' });
            mgr.processes.set('p2', { phpFpm: { pid: 3 }, server: { pid: 4 }, serverType: 'apache' });

            await mgr.stopAll();

            expect(mgr.processes.size).toBe(0);
            vi.restoreAllMocks();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // cleanupOrphanedConfigs()
    // ═══════════════════════════════════════════════════════════════════

    describe('cleanupOrphanedConfigs()', () => {
        it('removes .conf files not matching any project id', async () => {
            const apacheVhosts = path.join(tmpDir, 'apache', 'vhosts');
            await fs.ensureDir(apacheVhosts);
            // Create orphaned and valid conf files
            await fs.writeFile(path.join(apacheVhosts, 'orphan-id.conf'), '');
            await fs.writeFile(path.join(apacheVhosts, 'valid-id.conf'), '');

            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects') return [{ id: 'valid-id' }];
                return def;
            });

            await mgr.cleanupOrphanedConfigs();

            expect(await fs.pathExists(path.join(apacheVhosts, 'orphan-id.conf'))).toBe(false);
            expect(await fs.pathExists(path.join(apacheVhosts, 'valid-id.conf'))).toBe(true);
        });

        it('skips non-conf files', async () => {
            const nginxSites = path.join(tmpDir, 'nginx', 'sites');
            await fs.ensureDir(nginxSites);
            await fs.writeFile(path.join(nginxSites, 'README.md'), '# readme');

            configStore.get.mockImplementation((key, def) => key === 'projects' ? [] : def);
            await mgr.cleanupOrphanedConfigs();

            expect(await fs.pathExists(path.join(nginxSites, 'README.md'))).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // isServerInstalled()
    // ═══════════════════════════════════════════════════════════════════

    describe('isServerInstalled()', () => {
        it('returns true when binary exists', async () => {
            vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
            const result = await mgr.isServerInstalled('nginx', '1.28');
            expect(result).toBe(true);
            vi.restoreAllMocks();
        });

        it('returns false when binary missing', async () => {
            vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
            const result = await mgr.isServerInstalled('nginx', '1.28');
            expect(result).toBe(false);
            vi.restoreAllMocks();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getRunningProjects() / getStatus()
    // ═══════════════════════════════════════════════════════════════════

    describe('getRunningProjects()', () => {
        it('returns list with running project info objects', () => {
            mgr.processes.set('proj-a', { serverType: 'nginx', phpFpmPort: 9001 });
            mgr.processes.set('proj-b', { serverType: 'apache', phpFpmPort: 9002 });
            const running = mgr.getRunningProjects();
            expect(running.map(r => r.projectId)).toContain('proj-a');
            expect(running.map(r => r.projectId)).toContain('proj-b');
        });

        it('returns empty array when nothing running', () => {
            expect(mgr.getRunningProjects()).toEqual([]);
        });
    });

    describe('getStatus()', () => {
        it('returns status object', async () => {
            vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
            const status = await mgr.getStatus();
            expect(status).toHaveProperty('serverType');
            expect(status).toHaveProperty('runningProjects');
            vi.restoreAllMocks();
        });
    });

    // ═══════════════════════════════════════════════════════════════
    // Node.js project support
    // ═══════════════════════════════════════════════════════════════

    describe('Node.js project support', () => {
        const nodeProject = {
            id: 'node-proj-abcd1234',
            name: 'My Node App',
            domain: 'nodeapp.test',
            path: '/home/user/projects/nodeapp',
            type: 'nodejs',
            nodePort: 3000,
            port: 8085,
            sslPort: 443,
            ssl: false,
            networkAccess: false,
        };

        beforeEach(() => {
            vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
            vi.spyOn(fs, 'stat').mockRejectedValue(new Error('not found'));
            vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
            vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
            vi.spyOn(fs, 'readdir').mockResolvedValue([]);
            configStore.get.mockImplementation((key, def) => {
                if (key === 'projects') return [nodeProject];
                return def;
            });
        });

        afterEach(() => vi.restoreAllMocks());

        // ── Nginx ──────────────────────────────────────────────────

        it('generateNginxConfig() produces proxy_pass block for nodejs project', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });

            await mgr.generateNginxConfig(nodeProject);

            expect(capturedConfig).toContain('proxy_pass http://127.0.0.1:3000');
            expect(capturedConfig).toContain('proxy_http_version 1.1');
        });

        it('generateNginxConfig() omits FastCGI (PHP) block for nodejs project', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });

            await mgr.generateNginxConfig(nodeProject);

            expect(capturedConfig).not.toContain('fastcgi_pass');
            expect(capturedConfig).not.toContain('location ~ \\.php$');
        });

        it('generateNginxConfig() returns phpFpmPort null for nodejs project', async () => {
            const result = await mgr.generateNginxConfig(nodeProject);
            expect(result.phpFpmPort).toBeNull();
        });

        it('generateNginxConfig() adds SSL proxy_pass block when ssl=true (nodejs)', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });

            await mgr.generateNginxConfig({ ...nodeProject, ssl: true });

            // Two proxy_pass occurrences: one for HTTP, one for HTTPS
            const matches = capturedConfig.match(/proxy_pass http:\/\/127\.0\.0\.1:3000/g);
            expect(matches).not.toBeNull();
            expect(matches.length).toBeGreaterThanOrEqual(2);
        });

        // ── Apache ─────────────────────────────────────────────────

        it('generateApacheConfig() produces ProxyPass block for nodejs project', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });

            await mgr.generateApacheConfig(nodeProject);

            expect(capturedConfig).toContain('ProxyPass / http://127.0.0.1:3000/');
            expect(capturedConfig).toContain('ProxyPassReverse / http://127.0.0.1:3000/');
        });

        it('generateApacheConfig() omits FilesMatch PHP handler for nodejs project', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });

            await mgr.generateApacheConfig(nodeProject);

            expect(capturedConfig).not.toContain('FilesMatch');
            expect(capturedConfig).not.toContain('proxy:fcgi://');
        });

        it('generateApacheConfig() returns phpFpmPort null for nodejs project', async () => {
            const result = await mgr.generateApacheConfig(nodeProject);
            expect(result.phpFpmPort).toBeNull();
        });

        it('generateApacheConfig() adds SSL VirtualHost with ProxyPass when ssl=true (nodejs)', async () => {
            let capturedConfig = '';
            fs.writeFile.mockImplementation(async (_p, content) => { capturedConfig = content; });

            await mgr.generateApacheConfig({ ...nodeProject, ssl: true });

            expect(capturedConfig).toContain('SSLEngine on');
            // Two ProxyPass occurrences: one for plain HTTP vhost, one for SSL vhost
            const matches = capturedConfig.match(/ProxyPass \/ http:\/\/127\.0\.0\.1:3000\//g);
            expect(matches).not.toBeNull();
            expect(matches.length).toBeGreaterThanOrEqual(2);
        });
    });
});
