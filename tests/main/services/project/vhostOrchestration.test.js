import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const vhostOrchestration = require('../../../../src/main/services/project/vhostOrchestration');

function makeContext(overrides = {}) {
  return {
    ...vhostOrchestration,
    configStore: {
      get: vi.fn((key, defaultValue) => {
        if (key === 'projects') {
          return [];
        }

        return defaultValue;
      }),
    },
    getDataPath: vi.fn(() => 'C:/Users/Jeffrey/.devbox-pro'),
    getDefaultWebServerVersion: vi.fn((webServer) => webServer === 'apache' ? '2.4' : '1.28'),
    getEffectiveWebServer: vi.fn((project) => project.webServer),
    getEffectiveWebServerVersion: vi.fn((project) => project.webServerVersion),
    getFrontDoorOwner: vi.fn(() => null),
    getProjectProxyBackendHttpPort: vi.fn(() => 8081),
    projectNeedsFrontDoorProxy: vi.fn(() => false),
    runningProjects: new Map(),
    createApacheVhost: vi.fn().mockResolvedValue(undefined),
    createProxyApacheVhost: vi.fn().mockResolvedValue(undefined),
    createNginxVhost: vi.fn().mockResolvedValue(undefined),
    createProxyNginxVhost: vi.fn().mockResolvedValue(undefined),
    managers: {
      service: {
        standardPortOwner: null,
      },
      log: {
        systemWarn: vi.fn(),
      },
    },
    ...overrides,
  };
}

describe('project/vhostOrchestration', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('recreates missing apache vhosts for running apache projects', async () => {
    const project = {
      id: 'apache-project',
      name: 'Apache Project',
      webServer: 'apache',
      webServerVersion: '2.4',
    };

    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);

    const ctx = makeContext({
      configStore: {
        get: vi.fn((key, defaultValue) => key === 'projects' ? [project] : defaultValue),
      },
      getFrontDoorOwner: vi.fn(() => ({ webServer: 'apache', version: '2.4' })),
      runningProjects: new Map([['apache-project', { startedAt: new Date() }]]),
    });

    await ctx.regenerateAllApacheVhosts(null, '2.4');

    expect(ctx.createApacheVhost).toHaveBeenCalledWith(project, '2.4');
  });

  it('recreates missing nginx vhosts for running nginx projects', async () => {
    const project = {
      id: 'nginx-project',
      name: 'Nginx Project',
      webServer: 'nginx',
      webServerVersion: '1.28',
    };

    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);

    const ctx = makeContext({
      configStore: {
        get: vi.fn((key, defaultValue) => key === 'projects' ? [project] : defaultValue),
      },
      getFrontDoorOwner: vi.fn(() => ({ webServer: 'nginx', version: '1.28' })),
      runningProjects: new Map([['nginx-project', { startedAt: new Date(), phpFpmPort: 9100 }]]),
    });

    await ctx.regenerateAllNginxVhosts(null, '1.28');

    expect(ctx.createNginxVhost).toHaveBeenCalledWith(project, 9100, '1.28');
  });
});