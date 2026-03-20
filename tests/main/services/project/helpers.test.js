import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const helpers = require('../../../../src/main/services/project/helpers');

function makeContext(overrides = {}) {
  return {
    configStore: {
      get: vi.fn((key) => {
        if (key === 'resourcePath') return '/mock/resources';
        if (key === 'dataPath') return '/mock/data';
        return undefined;
      }),
    },
    managers: {
      service: {
        getServicePorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
        standardPortOwner: null,
        standardPortOwnerVersion: null,
      },
      log: {
        systemWarn: vi.fn(),
        systemInfo: vi.fn(),
      },
    },
    runningProjects: new Map(),
    networkPort80Owner: null,
    ...helpers,
    ...overrides,
  };
}

describe('project/helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deduplicates domains and keeps primary domain first', () => {
    const ctx = makeContext();

    expect(ctx.getProjectDomains({ domain: 'app.test', domains: ['app.test', 'api.app.test', 'app.test'] })).toEqual([
      'app.test',
      'api.app.test',
    ]);
    expect(ctx.getProjectPrimaryDomain({ domain: 'app.test', domains: ['app.test', 'api.app.test'] })).toBe('app.test');
  });

  it('builds project urls without default ports and with custom ports when needed', () => {
    const ctx = makeContext({
      managers: {
        service: {
          getServicePorts: vi.fn(() => ({ httpPort: 8005, sslPort: 4443 })),
          standardPortOwner: null,
          standardPortOwnerVersion: null,
        },
        log: {
          systemWarn: vi.fn(),
          systemInfo: vi.fn(),
        },
      },
    });

    expect(ctx.getProjectUrl({ domain: 'default.test', ssl: false, webServer: 'nginx' })).toBe('http://default.test:8005');
    expect(ctx.getProjectUrl({ domain: 'secure.test', ssl: true, webServer: 'nginx' })).toBe('https://secure.test:4443');
  });

  it('uses documentRoot overrides before fallback detection', () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    expect(ctx.getDocumentRoot({ path: '/project', documentRoot: 'public_html' })).toBe(path.join('/project', 'public_html'));
    expect(ctx.getDocumentRoot({ path: '/project', documentRoot: '/' })).toBe('/project');
    expect(ctx.getDocumentRoot({ path: '/project', documentRoot: '/custom/root' })).toBe('/custom/root');
  });

  it('falls back to common public directories for custom projects', () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => targetPath === path.join('/project', 'www'));

    expect(ctx.getDocumentRoot({ path: '/project', type: 'custom' })).toBe(path.join('/project', 'www'));
  });
});
