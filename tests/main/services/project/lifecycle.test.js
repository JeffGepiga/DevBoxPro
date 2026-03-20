import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { EventEmitter } = require('events');

const fs = require('fs-extra');
const lifecycle = require('../../../../src/main/services/project/lifecycle');

function makeConfigStore(initialProjects = []) {
  let projects = [...initialProjects];

  return {
    get: vi.fn((key, fallback) => {
      if (key === 'projects') {
        return projects;
      }

      return fallback;
    }),
    set: vi.fn((key, value) => {
      if (key === 'projects') {
        projects = value;
      }
    }),
    _getProjects: () => projects,
  };
}

function makeContext(overrides = {}) {
  return {
    ...lifecycle,
    configStore: makeConfigStore(),
    managers: {
      service: {
        serviceStatus: new Map(),
        serviceConfigs: {
          nginx: { versioned: true },
          apache: { versioned: true },
          mysql: { versioned: true },
          redis: { versioned: true },
        },
        getServicePorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
        isVersionRunning: vi.fn(() => false),
        startService: vi.fn().mockResolvedValue({ success: true }),
        restartService: vi.fn().mockResolvedValue({ success: true }),
        stopService: vi.fn().mockResolvedValue(undefined),
        standardPortOwner: null,
      },
      supervisor: {
        startProcess: vi.fn().mockResolvedValue(undefined),
      },
      log: {
        project: vi.fn(),
        systemWarn: vi.fn(),
        systemError: vi.fn(),
        systemInfo: vi.fn(),
      },
    },
    runningProjects: new Map(),
    cancelPendingServiceStop: vi.fn(),
    getProject: vi.fn(),
    getProjectServiceDependencies: vi.fn(() => []),
    getEffectiveWebServerVersion: vi.fn((project, webServer) => project.webServerVersion || (webServer === 'apache' ? '2.4' : '1.28')),
    getResourcesPath: vi.fn(() => '/mock/resources'),
    ...overrides,
  };
}

describe('project/lifecycle', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.PLAYWRIGHT_TEST;
    vi.useRealTimers();
  });

  it('starts only supervisor processes marked for autostart', async () => {
    const ctx = makeContext();

    await ctx.startSupervisorProcesses({
      id: 'proj-1',
      name: 'Proj 1',
      supervisor: {
        processes: [
          { name: 'worker', autostart: true },
          { name: 'manual', autostart: false },
        ],
      },
    });

    expect(ctx.managers.supervisor.startProcess).toHaveBeenCalledTimes(1);
    expect(ctx.managers.supervisor.startProcess).toHaveBeenCalledWith('proj-1', { name: 'worker', autostart: true });
  });

  it('marks startup as failed when a critical service is not installed', async () => {
    const ctx = makeContext({
      managers: {
        service: {
          serviceStatus: new Map(),
          serviceConfigs: {
            nginx: { versioned: true },
          },
          getServicePorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
          isVersionRunning: vi.fn(() => false),
          startService: vi.fn().mockResolvedValue({ status: 'not_installed' }),
          restartService: vi.fn().mockResolvedValue({ success: true }),
          standardPortOwner: null,
        },
        supervisor: {
          startProcess: vi.fn().mockResolvedValue(undefined),
        },
        log: {
          project: vi.fn(),
          systemWarn: vi.fn(),
          systemError: vi.fn(),
          systemInfo: vi.fn(),
        },
      },
    });

    const result = await ctx.startProjectServices({
      id: 'proj-2',
      name: 'Proj 2',
      webServer: 'nginx',
      webServerVersion: '1.28',
      services: {},
    });

    expect(result.success).toBe(false);
    expect(result.criticalFailures).toEqual(['nginx']);
    expect(result.errors).toContain('nginx 1.28 is not installed. Please download it from Binary Manager.');
  });

  it('auto-updates the project web server version when a fallback binary exists', async () => {
    const project = {
      id: 'proj-3',
      name: 'Proj 3',
      phpVersion: '8.3',
      webServer: 'nginx',
      webServerVersion: '1.24',
      services: {},
    };
    const configStore = makeConfigStore([project]);
    const ctx = makeContext({ configStore });

    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      const normalized = String(targetPath).replace(/\\/g, '/');
      return normalized.endsWith('/php/8.3/win/php.exe')
        || normalized.endsWith('/php/8.3/win/php-cgi.exe')
        || normalized.endsWith('/nginx')
        || normalized.endsWith('/nginx/1.28/win');
    });
    vi.spyOn(fs, 'readdir').mockResolvedValue(['1.28']);

    const result = await ctx.validateProjectBinaries(project);

    expect(result).toEqual([]);
    expect(project.webServerVersion).toBe('1.28');
    expect(configStore.set).toHaveBeenCalledWith('projects', [expect.objectContaining({ webServerVersion: '1.28' })]);
  });

  it('reloads nginx when a rapid restart moves PHP-CGI to a fallback port', async () => {
    const project = {
      id: 'proj-rapid',
      name: 'Rapid Restart',
      type: 'php',
      phpVersion: '8.3',
      webServer: 'nginx',
      webServerVersion: '1.28',
      domain: 'rapid.test',
      path: '/projects/rapid',
      services: {},
      supervisor: { processes: [] },
      environment: {},
    };

    const configStore = makeConfigStore([project]);
    const reloadNginx = vi.fn().mockResolvedValue(undefined);
    const ctx = makeContext({
      configStore,
      getProject: vi.fn(() => project),
      validateProjectBinaries: vi.fn().mockResolvedValue([]),
      getPhpFpmPort: vi.fn(() => 9100),
      createNginxVhost: vi.fn().mockResolvedValue(undefined),
      regenerateAllNginxVhosts: vi.fn().mockResolvedValue(undefined),
      syncProjectLocalProxy: vi.fn().mockResolvedValue(false),
      startProjectServices: vi.fn().mockResolvedValue({ success: true, errors: [], criticalFailures: [] }),
      startPhpCgi: vi.fn().mockResolvedValue({ process: { pid: 4321 }, port: 9101 }),
      createVirtualHost: vi.fn().mockResolvedValue(undefined),
      updateHostsFile: vi.fn().mockResolvedValue(undefined),
      managers: {
        service: {
          serviceStatus: new Map([['nginx', { status: 'running', version: '1.28' }]]),
          serviceConfigs: {
            nginx: { versioned: true },
            apache: { versioned: true },
            mysql: { versioned: true },
            redis: { versioned: true },
          },
          getServicePorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
          isVersionRunning: vi.fn((serviceName, version) => serviceName === 'nginx' && version === '1.28'),
          startService: vi.fn().mockResolvedValue({ success: true }),
          restartService: vi.fn().mockResolvedValue({ success: true }),
          stopService: vi.fn().mockResolvedValue(undefined),
          reloadNginx,
          standardPortOwner: 'nginx',
          standardPortOwnerVersion: '1.28',
        },
        supervisor: {
          startProcess: vi.fn().mockResolvedValue(undefined),
        },
        log: {
          project: vi.fn(),
          systemWarn: vi.fn(),
          systemError: vi.fn(),
          systemInfo: vi.fn(),
        },
      },
    });

    const result = await ctx.startProject(project.id);

    expect(result.success).toBe(true);
    expect(ctx.createVirtualHost).toHaveBeenCalledWith(project, 9101, '1.28');
    expect(reloadNginx).toHaveBeenCalledTimes(2);
  });

  it('cancels pending nginx shutdown before mixed-server restart work begins', async () => {
    const project = {
      id: 'proj-mixed',
      name: 'Mixed Restart',
      type: 'php',
      phpVersion: '8.3',
      webServer: 'nginx',
      webServerVersion: '1.28',
      domain: 'mixed.test',
      path: '/projects/mixed',
      services: {},
      supervisor: { processes: [] },
      environment: {},
    };

    const cancelPendingServiceStop = vi.fn();
    const createNginxVhost = vi.fn().mockResolvedValue(undefined);
    const reloadNginx = vi.fn().mockResolvedValue(undefined);
    const reloadApache = vi.fn().mockResolvedValue(undefined);

    const ctx = makeContext({
      configStore: makeConfigStore([project]),
      getProject: vi.fn(() => project),
      getProjectServiceDependencies: vi.fn(() => [{ name: 'nginx', version: '1.28' }]),
      cancelPendingServiceStop,
      validateProjectBinaries: vi.fn().mockResolvedValue([]),
      getPhpFpmPort: vi.fn(() => 9100),
      createNginxVhost,
      regenerateAllNginxVhosts: vi.fn().mockResolvedValue(undefined),
      syncProjectLocalProxy: vi.fn().mockResolvedValue(true),
      startProjectServices: vi.fn().mockResolvedValue({ success: true, errors: [], criticalFailures: [] }),
      startPhpCgi: vi.fn().mockResolvedValue({ process: { pid: 4321 }, port: 9100 }),
      updateHostsFile: vi.fn().mockResolvedValue(undefined),
      managers: {
        service: {
          serviceStatus: new Map([
            ['nginx', { status: 'running', version: '1.28' }],
            ['apache', { status: 'running', version: '2.4' }],
          ]),
          serviceConfigs: {
            nginx: { versioned: true },
            apache: { versioned: true },
            mysql: { versioned: true },
            redis: { versioned: true },
          },
          getServicePorts: vi.fn((serviceName) => serviceName === 'nginx'
            ? { httpPort: 8081, sslPort: 8444 }
            : { httpPort: 80, sslPort: 443 }),
          isVersionRunning: vi.fn((serviceName, version) =>
            (serviceName === 'nginx' && version === '1.28') || (serviceName === 'apache' && version === '2.4')),
          startService: vi.fn().mockResolvedValue({ success: true }),
          restartService: vi.fn().mockResolvedValue({ success: true }),
          stopService: vi.fn().mockResolvedValue(undefined),
          reloadNginx,
          reloadApache,
          standardPortOwner: 'apache',
          standardPortOwnerVersion: '2.4',
        },
        supervisor: {
          startProcess: vi.fn().mockResolvedValue(undefined),
        },
        log: {
          project: vi.fn(),
          systemWarn: vi.fn(),
          systemError: vi.fn(),
          systemInfo: vi.fn(),
        },
      },
      getFrontDoorOwner: vi.fn(() => ({ webServer: 'apache', version: '2.4' })),
    });

    await ctx.startProject(project.id);

    expect(cancelPendingServiceStop).toHaveBeenCalledWith({ name: 'nginx', version: '1.28' });
    expect(cancelPendingServiceStop.mock.invocationCallOrder[0]).toBeLessThan(createNginxVhost.mock.invocationCallOrder[0]);
  });

  it('stops all running projects and reports the aggregate result', async () => {
    const ctx = makeContext({
      runningProjects: new Map([
        ['proj-a', {}],
        ['proj-b', {}],
      ]),
      stopProject: vi.fn()
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true }),
      forceKillOrphanPhpProcesses: vi.fn().mockResolvedValue(undefined),
    });

    const result = await ctx.stopAllProjects();

    expect(ctx.stopProject).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      success: true,
      stoppedCount: 2,
      results: [
        { id: 'proj-a', success: true },
        { id: 'proj-b', success: true },
      ],
    });
  });

  it('waits for PHP-CGI to exit before finishing stopProject', async () => {
    vi.useFakeTimers();

    const killMock = vi.fn((pid, signal, callback) => {
      callback();
    });
    require('module')._cache[require.resolve('tree-kill')] = {
      id: require.resolve('tree-kill'),
      filename: require.resolve('tree-kill'),
      loaded: true,
      exports: killMock,
    };

    const phpCgiProcess = new EventEmitter();
    phpCgiProcess.pid = 4321;

    const project = {
      id: 'proj-stop',
      name: 'Stop Wait',
      supervisor: { processes: [] },
    };

    const ctx = makeContext({
      getProject: vi.fn(() => project),
      runningProjects: new Map([['proj-stop', { phpCgiProcess }]]),
      stopProjectServices: vi.fn().mockResolvedValue({ scheduled: [] }),
    });

    let resolved = false;
    const stopPromise = ctx.stopProject('proj-stop').then(() => {
      resolved = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(resolved).toBe(false);

    phpCgiProcess.emit('exit', 0);
    await stopPromise;

    expect(killMock).toHaveBeenCalledWith(4321, 'SIGTERM', expect.any(Function));
    expect(ctx.stopProjectServices).toHaveBeenCalledWith(project);
  });
});