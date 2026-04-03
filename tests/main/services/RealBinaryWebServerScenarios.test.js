import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import os from 'os';
import path from 'path';
import http from 'http';
import net from 'net';
import { randomUUID } from 'crypto';
import fs from 'fs-extra';

let currentUserDataPath = path.join(os.tmpdir(), 'devboxpro-real-binary-tests', 'default');
let currentProjectRootPath = path.join(os.tmpdir(), 'devboxpro-real-binary-projects');
let currentAppDataPath = path.join(os.tmpdir(), 'devboxpro-real-binary-appdata', 'default');
let activeScenario = null;

const mockApp = {
    getPath: (name) => {
        const paths = {
            userData: currentUserDataPath,
            home: os.homedir(),
            appData: currentAppDataPath,
            temp: os.tmpdir(),
        };

        return paths[name] || path.join(os.tmpdir(), `devboxpro-real-binary-${name}`);
    },
    getVersion: () => '1.0.0-test',
    isPackaged: false,
    quit: () => { },
    isQuitting: false,
    on: () => { },
};

function clearMainModuleCache() {
    const modulePaths = [
        '../../../src/main/services/CompatibilityManager',
        '../../../src/main/services/ProjectManager',
        '../../../src/main/services/ServiceManager',
        '../../../src/main/utils/PortUtils',
    ];

    for (const modulePath of modulePaths) {
        delete require.cache[require.resolve(modulePath)];
    }
}

require('module')._cache[require.resolve('electron')] = {
    id: require.resolve('electron'),
    filename: require.resolve('electron'),
    loaded: true,
    exports: {
        app: mockApp,
        ipcMain: { handle: () => { }, on: () => { }, removeHandler: () => { } },
        dialog: {},
        shell: { openExternal: async () => { }, openPath: async () => '' },
        BrowserWindow: function () { return { webContents: { send: () => { } } }; },
        nativeImage: { createFromPath: () => ({}) },
        nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
        Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => { } },
        Tray: function () { return { setToolTip: () => { }, setContextMenu: () => { }, on: () => { }, destroy: () => { } }; },
    },
};

clearMainModuleCache();

const { ServiceManager } = require('../../../src/main/services/ServiceManager');
const { ProjectManager } = require('../../../src/main/services/ProjectManager');
const { isPortAvailable } = require('../../../src/main/utils/PortUtils');

const resourcesRoot = process.env.DEVBOX_REAL_RESOURCES_PATH
    || (process.platform === 'win32' && process.env.APPDATA
        ? path.join(process.env.APPDATA, 'devbox-pro', 'resources')
        : path.join(os.homedir(), '.devbox-pro', 'resources'));

const platform = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux';

function resolveInstalledPhpVersion() {
    const candidates = ['8.5', '8.4', '8.3', '8.2', '8.1'];
    for (const version of candidates) {
        const phpCgi = process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi';
        if (fs.existsSync(path.join(resourcesRoot, 'php', version, platform, phpCgi))) {
            return version;
        }
    }

    return null;
}

const installedPhpVersion = resolveInstalledPhpVersion();
const apacheBinaryPath = process.platform === 'win32'
    ? path.join(resourcesRoot, 'apache', '2.4', platform, 'bin', 'httpd.exe')
    : path.join(resourcesRoot, 'apache', '2.4', platform, 'bin', 'httpd');
const nginx128BinaryPath = process.platform === 'win32'
    ? path.join(resourcesRoot, 'nginx', '1.28', platform, 'nginx.exe')
    : path.join(resourcesRoot, 'nginx', '1.28', platform, 'nginx');
const nginx126BinaryPath = process.platform === 'win32'
    ? path.join(resourcesRoot, 'nginx', '1.26', platform, 'nginx.exe')
    : path.join(resourcesRoot, 'nginx', '1.26', platform, 'nginx');
const requiredBinaryPaths = [
    apacheBinaryPath,
    nginx128BinaryPath,
    nginx126BinaryPath,
];

if (installedPhpVersion) {
    requiredBinaryPaths.push(path.join(resourcesRoot, 'php', installedPhpVersion, platform, process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi'));
}

const hasRequiredBinaries = process.platform === 'win32'
    && installedPhpVersion !== null
    && requiredBinaryPaths.every((binaryPath) => fs.existsSync(binaryPath));

const describeIfBinariesInstalled = hasRequiredBinaries ? describe : describe.skip;

function createConfigStore(initialProjects = []) {
    const store = {
        projects: initialProjects,
        settings: { portRangeStart: 20000 },
        resourcePath: resourcesRoot,
    };

    return {
        get: (key, defaultValue) => {
            if (key === 'projects') return store.projects;
            if (key === 'settings') return store.settings;
            if (key === 'resourcePath') return store.resourcePath;
            return key in store ? store[key] : defaultValue;
        },
        set: (key, value) => {
            store[key] = value;
            if (key === 'projects') {
                store.projects = value;
            }
            if (key === 'settings') {
                store.settings = value;
            }
        },
        delete: (key) => {
            delete store[key];
        },
    };
}

function createManagers() {
    const log = {
        project: () => { },
        service: () => { },
        systemInfo: () => { },
        systemWarn: () => { },
        systemError: () => { },
        info: () => { },
        error: () => { },
    };

    return {
        log,
        ssl: { createCertificate: async () => { } },
        cli: null,
        php: null,
        database: null,
    };
}

async function findFreePortPlan() {
    for (let base = 18080; base < 26000; base += 50) {
        const candidatePorts = [
            base,
            base + 10,
            base + 11,
            base + 20,
            base + 100,
            base + 110,
            base + 111,
            base + 120,
        ];

        let allFree = true;
        for (const port of candidatePorts) {
            if (!await isPortAvailable(port)) {
                allFree = false;
                break;
            }
        }

        if (allFree) {
            return {
                standardHttp: base,
                standardHttps: base + 100,
                nginxAltHttp: base + 10,
                nginxAltHttps: base + 110,
                apacheAltHttp: base + 20,
                apacheAltHttps: base + 120,
            };
        }
    }

    throw new Error('Could not find a free port block for real binary tests');
}

function applyWebServerPorts(serviceManager, portPlan) {
    serviceManager.webServerPorts.standard = {
        http: portPlan.standardHttp,
        https: portPlan.standardHttps,
    };
    serviceManager.webServerPorts.alternate = {
        http: portPlan.nginxAltHttp,
        https: portPlan.nginxAltHttps,
    };

    serviceManager.serviceConfigs.nginx.defaultPort = portPlan.standardHttp;
    serviceManager.serviceConfigs.nginx.sslPort = portPlan.standardHttps;
    serviceManager.serviceConfigs.nginx.alternatePort = portPlan.nginxAltHttp;
    serviceManager.serviceConfigs.nginx.alternateSslPort = portPlan.nginxAltHttps;

    serviceManager.serviceConfigs.apache.defaultPort = portPlan.standardHttp;
    serviceManager.serviceConfigs.apache.sslPort = portPlan.standardHttps;
    serviceManager.serviceConfigs.apache.alternatePort = portPlan.apacheAltHttp;
    serviceManager.serviceConfigs.apache.alternateSslPort = portPlan.apacheAltHttps;
}

async function waitForResponse(port, hostHeader, expectedText, timeoutMs = 30000) {
    const start = Date.now();
    let lastError = null;

    while (Date.now() - start < timeoutMs) {
        try {
            const result = await new Promise((resolve, reject) => {
                const request = http.request({
                    host: '127.0.0.1',
                    port,
                    path: '/',
                    headers: { Host: hostHeader },
                }, (response) => {
                    let body = '';
                    response.setEncoding('utf8');
                    response.on('data', (chunk) => {
                        body += chunk;
                    });
                    response.on('end', () => resolve({ statusCode: response.statusCode, body }));
                });

                request.on('error', reject);
                request.end();
            });

            if (result.statusCode === 200 && result.body.includes(expectedText)) {
                return result;
            }

            lastError = new Error(`Unexpected response from ${hostHeader}:${port} -> ${result.statusCode}`);
        } catch (error) {
            lastError = error;
        }

        await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw lastError || new Error(`Timed out waiting for ${hostHeader}:${port}`);
}

function listenOnPort(port) {
    const server = net.createServer((socket) => {
        socket.end('occupied\n');
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, '0.0.0.0', () => resolve(server));
    });
}

async function createStaticProject(projectRoot, project) {
    await fs.ensureDir(projectRoot);
    await fs.writeFile(path.join(projectRoot, 'index.html'), `${project.name} integration test`);
}

async function prepareScenarioPaths(scenarioId = randomUUID()) {
    currentUserDataPath = path.join(os.tmpdir(), 'devboxpro-real-binary-tests', scenarioId, 'userData');
    currentProjectRootPath = path.join(os.tmpdir(), 'devboxpro-real-binary-projects', scenarioId);
    currentAppDataPath = path.join(os.tmpdir(), 'devboxpro-real-binary-appdata', scenarioId);

    await fs.remove(currentUserDataPath);
    await fs.remove(currentProjectRootPath);
    await fs.remove(currentAppDataPath);

    await fs.ensureDir(currentUserDataPath);
    await fs.ensureDir(currentProjectRootPath);
    await fs.ensureDir(currentAppDataPath);

    return scenarioId;
}

async function createScenario(projects) {
    const configStore = createConfigStore(projects);
    const managers = createManagers();
    const serviceManager = new ServiceManager(resourcesRoot, configStore, managers);
    await serviceManager.initialize();

    const projectManager = new ProjectManager(configStore, {
        ...managers,
        service: serviceManager,
    });

    projectManager.updateHostsFile = async () => { };
    projectManager.validateProjectBinaries = async () => [];
    projectManager.startSupervisorProcesses = async () => { };

    serviceManager.managers = { ...managers, project: projectManager };
    projectManager.managers = { ...managers, service: serviceManager };

    activeScenario = { configStore, serviceManager, projectManager };

    return activeScenario;
}

async function readFileTail(filePath, maxLines = 40) {
    try {
        if (!await fs.pathExists(filePath)) {
            return '[missing]';
        }

        const content = await fs.readFile(filePath, 'utf8');
        const lines = content.split(/\r?\n/);
        const tail = lines.slice(-maxLines).join('\n').trim();
        return tail || '[empty]';
    } catch (error) {
        return `[error reading file: ${error.message}]`;
    }
}

async function dumpScenarioDiagnostics(label, scenario, extra = {}) {
    if (!scenario?.serviceManager) {
        return;
    }

    const dataPath = scenario.serviceManager.getDataPath();
    const apacheHttpPort = scenario.serviceManager.getServicePorts('apache', '2.4')?.httpPort;
    const apacheSslPort = scenario.serviceManager.getServicePorts('apache', '2.4')?.sslPort;
    const nginx128HttpPort = scenario.serviceManager.getServicePorts('nginx', '1.28')?.httpPort;
    const nginx126HttpPort = scenario.serviceManager.getServicePorts('nginx', '1.26')?.httpPort;

    const diagnostics = {
        label,
        currentUserDataPath,
        currentProjectRootPath,
        currentAppDataPath,
        dataPath,
        standardPortOwner: scenario.serviceManager.standardPortOwner,
        standardPortOwnerVersion: scenario.serviceManager.standardPortOwnerVersion,
        apacheStatus: scenario.serviceManager.serviceStatus.get('apache'),
        nginxStatus: scenario.serviceManager.serviceStatus.get('nginx'),
        runningProjects: Array.from(scenario.projectManager?.runningProjects?.keys?.() || []),
        apachePorts: { http: apacheHttpPort, https: apacheSslPort },
        nginxPorts: {
            '1.28': nginx128HttpPort,
            '1.26': nginx126HttpPort,
        },
        extra,
        apacheConfigTail: await readFileTail(path.join(dataPath, 'apache', 'httpd.conf')),
        apacheLogTail: await readFileTail(path.join(dataPath, 'apache', 'logs', 'error.log')),
        apacheVhosts: await readFileTail(path.join(dataPath, 'apache', 'vhosts', 'apache-fallback-project.conf')),
        nginx128ConfigTail: await readFileTail(path.join(dataPath, 'nginx', '1.28', 'nginx.conf')),
        nginx128LogTail: await readFileTail(path.join(dataPath, 'nginx', '1.28', 'logs', 'error.log')),
        nginx126ConfigTail: await readFileTail(path.join(dataPath, 'nginx', '1.26', 'nginx.conf')),
        nginx126LogTail: await readFileTail(path.join(dataPath, 'nginx', '1.26', 'logs', 'error.log')),
    };

    console.error('=== Real Binary Scenario Diagnostics ===');
    console.error(JSON.stringify(diagnostics, null, 2));
}

async function stopProjectIfRunning(projectManager, projectId) {
    if (!projectManager.runningProjects.has(projectId)) {
        return;
    }

    await projectManager.stopProject(projectId);
}

describeIfBinariesInstalled('Real Binary Web Server Scenarios', () => {
    beforeAll(() => {
        if (!hasRequiredBinaries) {
            console.warn(`Skipping real binary web server tests. Missing binaries under ${resourcesRoot}`);
        }
    });

    afterEach(async () => {
        if (activeScenario?.serviceManager) {
            try {
                await activeScenario.serviceManager.stopAllServices();
            } catch {
                // Best-effort cleanup for partially started real services.
            }
        }

        activeScenario = null;

        if (process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
            return;
        }

        if (currentUserDataPath && await fs.pathExists(currentUserDataPath)) {
            await fs.remove(currentUserDataPath);
        }
        if (currentProjectRootPath && await fs.pathExists(currentProjectRootPath)) {
            await fs.remove(currentProjectRootPath);
        }
        if (currentAppDataPath && await fs.pathExists(currentAppDataPath)) {
            await fs.remove(currentAppDataPath);
        }
    }, 30000);

    it('falls back to alternate Apache ports when the standard port is occupied', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;
        const project = {
            id: 'apache-fallback-project',
            name: 'ApacheFallback',
            path: path.join(currentProjectRootPath, scenarioId, 'apache-fallback'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-fallback.test',
            domains: ['apache-fallback.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.apacheAltHttp,
        };

        await createStaticProject(project.path, project);
        const { serviceManager, projectManager } = await createScenario([project]);
        applyWebServerPorts(serviceManager, portPlan);

        const occupied = await listenOnPort(portPlan.standardHttp);

        try {
            await projectManager.startProject(project.id);

            const apachePorts = serviceManager.getServicePorts('apache', '2.4');
            expect(apachePorts.httpPort).toBe(portPlan.apacheAltHttp);
            await waitForResponse(apachePorts.httpPort, project.domain, project.name);
            testPassed = true;
        } catch (error) {
            await dumpScenarioDiagnostics('apache-fallback-failure', activeScenario, {
                error: error.message,
                projectId: project.id,
                expectedHttpPort: portPlan.apacheAltHttp,
                occupiedPort: portPlan.standardHttp,
            });
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            await stopProjectIfRunning(projectManager, project.id);
            await new Promise((resolve) => occupied.close(resolve));
        }
    }, 180000);

    it('keeps both nginx 1.28 projects reachable after adding nginx 1.26 and a second nginx 1.28 project', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;

        const apacheProject = {
            id: 'apache-seed-project',
            name: 'ApacheSeed',
            path: path.join(currentProjectRootPath, scenarioId, 'apache-seed'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-seed.test',
            domains: ['apache-seed.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.apacheAltHttp,
        };
        const nginx128ProjectA = {
            id: 'nginx-128-project-a',
            name: 'Nginx128A',
            path: path.join(currentProjectRootPath, scenarioId, 'nginx-128-a'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-128-a.test',
            domains: ['nginx-128-a.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.nginxAltHttp,
        };
        const nginx126Project = {
            id: 'nginx-126-project',
            name: 'Nginx126',
            path: path.join(currentProjectRootPath, scenarioId, 'nginx-126'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'nginx',
            webServerVersion: '1.26',
            domain: 'nginx-126.test',
            domains: ['nginx-126.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.nginxAltHttp + 1,
        };
        const nginx128ProjectB = {
            id: 'nginx-128-project-b',
            name: 'Nginx128B',
            path: path.join(currentProjectRootPath, scenarioId, 'nginx-128-b'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-128-b.test',
            domains: ['nginx-128-b.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.nginxAltHttp + 2,
        };

        const allProjects = [apacheProject, nginx128ProjectA, nginx126Project, nginx128ProjectB];
        for (const project of allProjects) {
            await createStaticProject(project.path, project);
        }

        const { serviceManager, projectManager } = await createScenario(allProjects);
        applyWebServerPorts(serviceManager, portPlan);

        try {
            await projectManager.startProject(apacheProject.id);
            await projectManager.startProject(nginx128ProjectA.id);
            await waitForResponse(serviceManager.getServicePorts('nginx', '1.28').httpPort, nginx128ProjectA.domain, nginx128ProjectA.name);

            await projectManager.startProject(nginx126Project.id);
            await waitForResponse(serviceManager.getServicePorts('nginx', '1.26').httpPort, nginx126Project.domain, nginx126Project.name);

            await projectManager.startProject(nginx128ProjectB.id);

            const nginx128Port = serviceManager.getServicePorts('nginx', '1.28').httpPort;
            const nginx126Port = serviceManager.getServicePorts('nginx', '1.26').httpPort;

            await waitForResponse(nginx128Port, nginx128ProjectA.domain, nginx128ProjectA.name);
            await waitForResponse(nginx128Port, nginx128ProjectB.domain, nginx128ProjectB.name);
            await waitForResponse(nginx126Port, nginx126Project.domain, nginx126Project.name);
            testPassed = true;
        } catch (error) {
            await dumpScenarioDiagnostics('multi-nginx-failure', activeScenario, {
                error: error.message,
                apacheProjectId: apacheProject.id,
                nginx128ProjectAId: nginx128ProjectA.id,
                nginx126ProjectId: nginx126Project.id,
                nginx128ProjectBId: nginx128ProjectB.id,
            });
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            for (const project of [nginx128ProjectB, nginx126Project, nginx128ProjectA, apacheProject]) {
                await stopProjectIfRunning(projectManager, project.id);
            }
        }
    }, 240000);
});