import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
});