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

function resolveInstalledRedisVersion() {
    const candidates = ['7.4', '7.2', '6.2'];
    for (const version of candidates) {
        const redisServer = process.platform === 'win32' ? 'redis-server.exe' : 'redis-server';
        if (fs.existsSync(path.join(resourcesRoot, 'redis', version, platform, redisServer))) {
            return version;
        }
    }

    return null;
}

const installedPhpVersion = resolveInstalledPhpVersion();
const installedRedisVersion = resolveInstalledRedisVersion();
const apacheBinaryPath = process.platform === 'win32'
    ? path.join(resourcesRoot, 'apache', '2.4', platform, 'bin', 'httpd.exe')
    : path.join(resourcesRoot, 'apache', '2.4', platform, 'bin', 'httpd');
const nginx128BinaryPath = process.platform === 'win32'
    ? path.join(resourcesRoot, 'nginx', '1.28', platform, 'nginx.exe')
    : path.join(resourcesRoot, 'nginx', '1.28', platform, 'nginx');
const nginx126BinaryPath = process.platform === 'win32'
    ? path.join(resourcesRoot, 'nginx', '1.26', platform, 'nginx.exe')
    : path.join(resourcesRoot, 'nginx', '1.26', platform, 'nginx');
const nginx124BinaryPath = process.platform === 'win32'
    ? path.join(resourcesRoot, 'nginx', '1.24', platform, 'nginx.exe')
    : path.join(resourcesRoot, 'nginx', '1.24', platform, 'nginx');
const requiredBinaryPaths = [
    apacheBinaryPath,
    nginx128BinaryPath,
];

if (installedPhpVersion) {
    requiredBinaryPaths.push(path.join(resourcesRoot, 'php', installedPhpVersion, platform, process.platform === 'win32' ? 'php-cgi.exe' : 'php-cgi'));
}

const hasRequiredBinaries = process.platform === 'win32'
    && installedPhpVersion !== null
    && requiredBinaryPaths.every((binaryPath) => fs.existsSync(binaryPath));
const hasNginx126Binary = fs.existsSync(nginx126BinaryPath);
const hasNginx124Binary = fs.existsSync(nginx124BinaryPath);
const hasRedisBinary = installedRedisVersion !== null;

const describeIfBinariesInstalled = hasRequiredBinaries ? describe : describe.skip;
const itIfNginx126Installed = hasNginx126Binary ? it : it.skip;
const itIfNginx124Installed = hasNginx124Binary ? it : it.skip;
const itIfRedisInstalled = hasRedisBinary ? it : it.skip;

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

async function waitForPortState(checkPortOpen, port, expectedOpen, timeoutMs = 15000) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        if (await checkPortOpen(port) === expectedOpen) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for port ${port} to become ${expectedOpen ? 'open' : 'closed'}`);
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

function createCustomProject(scenarioId, {
    id,
    name,
    webServer,
    webServerVersion,
    domain,
    port,
    subdir = id,
}) {
    return {
        id,
        name,
        path: path.join(currentProjectRootPath, scenarioId, subdir),
        type: 'custom',
        phpVersion: installedPhpVersion,
        webServer,
        webServerVersion,
        domain,
        domains: [domain],
        ssl: false,
        autoStart: false,
        networkAccess: false,
        services: {},
        supervisor: { processes: [] },
        port,
    };
}

function getFrontDoorInfo(serviceManager) {
    const webServer = serviceManager.standardPortOwner;
    const version = serviceManager.standardPortOwnerVersion;

    if (!webServer || !version) {
        return null;
    }

    const ports = serviceManager.getServicePorts(webServer, version);
    return {
        webServer,
        version,
        httpPort: ports?.httpPort,
        sslPort: ports?.sslPort,
    };
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

    it('keeps two apache 2.4 projects and two nginx 1.28 projects reachable when started back-to-back', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;

        const apacheProjectA = createCustomProject(scenarioId, {
            id: 'apache-24-project-a',
            name: 'Apache24A',
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-24-a.test',
            port: portPlan.apacheAltHttp,
        });
        const apacheProjectB = createCustomProject(scenarioId, {
            id: 'apache-24-project-b',
            name: 'Apache24B',
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-24-b.test',
            port: portPlan.apacheAltHttp + 1,
        });
        const nginxProjectA = createCustomProject(scenarioId, {
            id: 'nginx-128-project-c',
            name: 'Nginx128C',
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-128-c.test',
            port: portPlan.nginxAltHttp,
        });
        const nginxProjectB = createCustomProject(scenarioId, {
            id: 'nginx-128-project-d',
            name: 'Nginx128D',
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-128-d.test',
            port: portPlan.nginxAltHttp + 1,
        });

        const allProjects = [apacheProjectA, apacheProjectB, nginxProjectA, nginxProjectB];
        for (const project of allProjects) {
            await createStaticProject(project.path, project);
        }

        const { serviceManager, projectManager } = await createScenario(allProjects);
        applyWebServerPorts(serviceManager, portPlan);

        try {
            await Promise.all([
                projectManager.startProject(apacheProjectA.id),
                projectManager.startProject(nginxProjectA.id),
                projectManager.startProject(apacheProjectB.id),
                projectManager.startProject(nginxProjectB.id),
            ]);

            const frontDoor = getFrontDoorInfo(serviceManager);
            expect(frontDoor).toBeTruthy();
            expect(frontDoor.httpPort).toBe(portPlan.standardHttp);

            const apachePort = serviceManager.getServicePorts('apache', '2.4').httpPort;
            const nginxPort = serviceManager.getServicePorts('nginx', '1.28').httpPort;

            await waitForResponse(frontDoor.httpPort, apacheProjectA.domain, apacheProjectA.name);
            await waitForResponse(frontDoor.httpPort, apacheProjectB.domain, apacheProjectB.name);
            await waitForResponse(frontDoor.httpPort, nginxProjectA.domain, nginxProjectA.name);
            await waitForResponse(frontDoor.httpPort, nginxProjectB.domain, nginxProjectB.name);

            await waitForResponse(apachePort, apacheProjectA.domain, apacheProjectA.name);
            await waitForResponse(apachePort, apacheProjectB.domain, apacheProjectB.name);
            await waitForResponse(nginxPort, nginxProjectA.domain, nginxProjectA.name);
            await waitForResponse(nginxPort, nginxProjectB.domain, nginxProjectB.name);
            testPassed = true;
        } catch (error) {
            await dumpScenarioDiagnostics('rapid-multi-project-same-version-failure', activeScenario, {
                error: error.message,
                projectIds: allProjects.map((project) => project.id),
            });
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            for (const project of [nginxProjectB, nginxProjectA, apacheProjectB, apacheProjectA]) {
                await stopProjectIfRunning(projectManager, project.id);
            }
        }
    }, 240000);

    it('reclaims the standard port after rapid apache and nginx stop-start toggles', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;

        const apacheProject = createCustomProject(scenarioId, {
            id: 'apache-toggle-project',
            name: 'ApacheToggle',
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-toggle.test',
            port: portPlan.apacheAltHttp,
        });
        const nginxProject = createCustomProject(scenarioId, {
            id: 'nginx-toggle-project',
            name: 'NginxToggle',
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-toggle.test',
            port: portPlan.nginxAltHttp,
        });

        const allProjects = [apacheProject, nginxProject];
        for (const project of allProjects) {
            await createStaticProject(project.path, project);
        }

        const { serviceManager, projectManager } = await createScenario(allProjects);
        applyWebServerPorts(serviceManager, portPlan);

        try {
            await projectManager.startProject(nginxProject.id);
            await projectManager.startProject(apacheProject.id);

            let frontDoor = getFrontDoorInfo(serviceManager);
            expect(frontDoor).toBeTruthy();
            expect(frontDoor.httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(frontDoor.httpPort, nginxProject.domain, nginxProject.name);
            await waitForResponse(frontDoor.httpPort, apacheProject.domain, apacheProject.name);

            await Promise.all([
                projectManager.stopProject(nginxProject.id),
                projectManager.stopProject(apacheProject.id),
            ]);

            await projectManager.startProject(apacheProject.id);
            expect(serviceManager.getServicePorts('apache', '2.4').httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(serviceManager.getServicePorts('apache', '2.4').httpPort, apacheProject.domain, apacheProject.name);

            await projectManager.startProject(nginxProject.id);
            frontDoor = getFrontDoorInfo(serviceManager);
            expect(frontDoor).toBeTruthy();
            expect(frontDoor.httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(frontDoor.httpPort, apacheProject.domain, apacheProject.name);
            await waitForResponse(frontDoor.httpPort, nginxProject.domain, nginxProject.name);

            await Promise.all([
                projectManager.stopProject(apacheProject.id),
                projectManager.stopProject(nginxProject.id),
            ]);

            await projectManager.startProject(nginxProject.id);
            expect(serviceManager.getServicePorts('nginx', '1.28').httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(serviceManager.getServicePorts('nginx', '1.28').httpPort, nginxProject.domain, nginxProject.name);
            testPassed = true;
        } catch (error) {
            if (process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                await dumpScenarioDiagnostics('rapid-toggle-standard-port-failure', activeScenario, {
                    error: error.message,
                    apacheProjectId: apacheProject.id,
                    nginxProjectId: nginxProject.id,
                });
            }
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            for (const project of [nginxProject, apacheProject]) {
                await stopProjectIfRunning(projectManager, project.id);
            }
        }
    }, 240000);

    it('keeps the second mixed web-server project portless after restarting both projects in the same order', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;

        const nginxProject = createCustomProject(scenarioId, {
            id: 'nginx-same-order-restart-project',
            name: 'NginxSameOrderRestart',
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-same-order-restart.test',
            port: portPlan.nginxAltHttp,
        });
        const apacheProject = createCustomProject(scenarioId, {
            id: 'apache-same-order-restart-project',
            name: 'ApacheSameOrderRestart',
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-same-order-restart.test',
            port: portPlan.apacheAltHttp,
        });

        const allProjects = [nginxProject, apacheProject];
        for (const project of allProjects) {
            await createStaticProject(project.path, project);
        }

        const { serviceManager, projectManager } = await createScenario(allProjects);
        applyWebServerPorts(serviceManager, portPlan);

        try {
            await projectManager.startProject(nginxProject.id);
            await projectManager.startProject(apacheProject.id);

            let frontDoor = getFrontDoorInfo(serviceManager);
            expect(frontDoor).toBeTruthy();
            expect(frontDoor.httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(frontDoor.httpPort, nginxProject.domain, nginxProject.name);
            await waitForResponse(frontDoor.httpPort, apacheProject.domain, apacheProject.name);

            await Promise.all([
                projectManager.stopProject(nginxProject.id),
                projectManager.stopProject(apacheProject.id),
            ]);

            await projectManager.startProject(nginxProject.id);
            await projectManager.startProject(apacheProject.id);

            frontDoor = getFrontDoorInfo(serviceManager);
            expect(frontDoor).toBeTruthy();
            expect(frontDoor.httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(frontDoor.httpPort, nginxProject.domain, nginxProject.name);
            await waitForResponse(frontDoor.httpPort, apacheProject.domain, apacheProject.name);
            await waitForResponse(serviceManager.getServicePorts('apache', '2.4').httpPort, apacheProject.domain, apacheProject.name);
            testPassed = true;
        } catch (error) {
            await dumpScenarioDiagnostics('same-order-mixed-project-restart-failure', activeScenario, {
                error: error.message,
                nginxProjectId: nginxProject.id,
                apacheProjectId: apacheProject.id,
            });
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            for (const project of [apacheProject, nginxProject]) {
                await stopProjectIfRunning(projectManager, project.id);
            }
        }
    }, 240000);

    it('keeps front-door domains portless after manually stopping and starting nginx and apache services', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;

        const nginxProject = createCustomProject(scenarioId, {
            id: 'nginx-manual-service-restart-project',
            name: 'NginxManualServiceRestart',
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-manual-restart.test',
            port: portPlan.nginxAltHttp,
        });
        const apacheProject = createCustomProject(scenarioId, {
            id: 'apache-manual-service-restart-project',
            name: 'ApacheManualServiceRestart',
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-manual-restart.test',
            port: portPlan.apacheAltHttp,
        });

        const allProjects = [nginxProject, apacheProject];
        for (const project of allProjects) {
            await createStaticProject(project.path, project);
        }

        const { serviceManager, projectManager } = await createScenario(allProjects);
        applyWebServerPorts(serviceManager, portPlan);

        try {
            await projectManager.startProject(nginxProject.id);
            await projectManager.startProject(apacheProject.id);

            let frontDoor = getFrontDoorInfo(serviceManager);
            expect(frontDoor).toBeTruthy();
            expect(frontDoor.httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(frontDoor.httpPort, nginxProject.domain, nginxProject.name);
            await waitForResponse(frontDoor.httpPort, apacheProject.domain, apacheProject.name);

            await serviceManager.stopService('apache', '2.4');
            await serviceManager.stopService('nginx', '1.28');

            await serviceManager.startService('nginx', '1.28');
            expect(serviceManager.getServicePorts('nginx', '1.28').httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(portPlan.standardHttp, nginxProject.domain, nginxProject.name);

            await serviceManager.startService('apache', '2.4');
            frontDoor = getFrontDoorInfo(serviceManager);
            expect(frontDoor).toBeTruthy();
            expect(frontDoor.httpPort).toBe(portPlan.standardHttp);
            await waitForResponse(serviceManager.getServicePorts('apache', '2.4').httpPort, apacheProject.domain, apacheProject.name);
            await waitForResponse(frontDoor.httpPort, nginxProject.domain, nginxProject.name);
            await waitForResponse(frontDoor.httpPort, apacheProject.domain, apacheProject.name);

            testPassed = true;
        } catch (error) {
            if (process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                await dumpScenarioDiagnostics('manual-service-restart-front-door-failure', activeScenario, {
                    error: error.message,
                    nginxProjectId: nginxProject.id,
                    apacheProjectId: apacheProject.id,
                });
            }
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            for (const project of [apacheProject, nginxProject]) {
                await stopProjectIfRunning(projectManager, project.id);
            }
        }
    }, 240000);

    itIfRedisInstalled('keeps a redis-backed project stable across rapid start and stop toggles', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;

        const redisProject = createCustomProject(scenarioId, {
            id: 'nginx-redis-toggle-project',
            name: 'NginxRedisToggle',
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-redis-toggle.test',
            port: portPlan.nginxAltHttp,
        });
        redisProject.services = {
            redis: true,
            redisVersion: installedRedisVersion,
        };

        await createStaticProject(redisProject.path, redisProject);

        const { serviceManager, projectManager } = await createScenario([redisProject]);
        applyWebServerPorts(serviceManager, portPlan);

        try {
            let lastRedisPort = null;
            for (let attempt = 0; attempt < 5; attempt += 1) {
                await projectManager.startProject(redisProject.id);

                const frontDoorPort = serviceManager.getServicePorts('nginx', '1.28').httpPort;
                const redisPort = serviceManager.serviceStatus.get('redis')?.port;

                expect(redisPort).toBeTruthy();
                await waitForResponse(frontDoorPort, redisProject.domain, redisProject.name);
                await waitForPortState((port) => serviceManager.checkPortOpen(port), redisPort, true);

                 if (lastRedisPort !== null) {
                    expect(redisPort).toBe(lastRedisPort);
                }
                lastRedisPort = redisPort;

                await projectManager.stopProject(redisProject.id);
                await waitForPortState((port) => serviceManager.checkPortOpen(port), redisPort, false);
            }

            testPassed = true;
        } catch (error) {
            await dumpScenarioDiagnostics('redis-rapid-toggle-failure', activeScenario, {
                error: error.message,
                redisProjectId: redisProject.id,
                redisVersion: installedRedisVersion,
            });
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            await stopProjectIfRunning(projectManager, redisProject.id);
        }
    }, 240000);

    itIfNginx124Installed('keeps nginx 1.28 and apache front-door routes reachable after adding an nginx 1.24 project', async () => {
        const portPlan = await findFreePortPlan();
        const scenarioId = await prepareScenarioPaths();
        let testPassed = false;

        const nginx128Project = {
            id: 'nginx-128-front-door-project',
            name: 'Nginx128FrontDoor',
            path: path.join(currentProjectRootPath, scenarioId, 'nginx-128-front-door'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'nginx',
            webServerVersion: '1.28',
            domain: 'nginx-128-front-door.test',
            domains: ['nginx-128-front-door.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.nginxAltHttp,
        };
        const apacheProject = {
            id: 'apache-front-door-project',
            name: 'ApacheFrontDoor',
            path: path.join(currentProjectRootPath, scenarioId, 'apache-front-door'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'apache',
            webServerVersion: '2.4',
            domain: 'apache-front-door.test',
            domains: ['apache-front-door.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.apacheAltHttp,
        };
        const nginx124Project = {
            id: 'nginx-124-proxy-project',
            name: 'Nginx124Proxy',
            path: path.join(currentProjectRootPath, scenarioId, 'nginx-124-proxy'),
            type: 'custom',
            phpVersion: installedPhpVersion,
            webServer: 'nginx',
            webServerVersion: '1.24',
            domain: 'nginx-124-proxy.test',
            domains: ['nginx-124-proxy.test'],
            ssl: false,
            autoStart: false,
            networkAccess: false,
            services: {},
            supervisor: { processes: [] },
            port: portPlan.nginxAltHttp + 2,
        };

        const allProjects = [nginx128Project, apacheProject, nginx124Project];
        for (const project of allProjects) {
            await createStaticProject(project.path, project);
        }

        const { serviceManager, projectManager } = await createScenario(allProjects);
        applyWebServerPorts(serviceManager, portPlan);

        try {
            await projectManager.startProject(nginx128Project.id);

            const frontDoorPort = serviceManager.getServicePorts('nginx', '1.28').httpPort;
            expect(frontDoorPort).toBe(portPlan.standardHttp);
            await waitForResponse(frontDoorPort, nginx128Project.domain, nginx128Project.name);

            await projectManager.startProject(apacheProject.id);
            await waitForResponse(frontDoorPort, nginx128Project.domain, nginx128Project.name);
            await waitForResponse(frontDoorPort, apacheProject.domain, apacheProject.name);
            await waitForResponse(serviceManager.getServicePorts('apache', '2.4').httpPort, apacheProject.domain, apacheProject.name);

            await projectManager.startProject(nginx124Project.id);

            await waitForResponse(frontDoorPort, nginx128Project.domain, nginx128Project.name);
            await waitForResponse(frontDoorPort, apacheProject.domain, apacheProject.name);
            await waitForResponse(frontDoorPort, nginx124Project.domain, nginx124Project.name);
            await waitForResponse(serviceManager.getServicePorts('apache', '2.4').httpPort, apacheProject.domain, apacheProject.name);
            await waitForResponse(serviceManager.getServicePorts('nginx', '1.24').httpPort, nginx124Project.domain, nginx124Project.name);
            testPassed = true;
        } catch (error) {
            if (process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                await dumpScenarioDiagnostics('mixed-front-door-nginx124-failure', activeScenario, {
                    error: error.message,
                    nginx128ProjectId: nginx128Project.id,
                    apacheProjectId: apacheProject.id,
                    nginx124ProjectId: nginx124Project.id,
                });
            }
            throw error;
        } finally {
            if (!testPassed && process.env.DEVBOX_KEEP_REAL_BINARY_ARTIFACTS === '1') {
                return;
            }
            for (const project of [nginx124Project, apacheProject, nginx128Project]) {
                await stopProjectIfRunning(projectManager, project.id);
            }
        }
    }, 240000);
});