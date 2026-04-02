import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const path = require('path');
const fs = require('fs-extra');

require('../../../helpers/mockElectronCjs');

const vhostNginx = require('../../../../src/main/services/project/vhostNginx');

function makeContext(overrides = {}) {
  return {
    ...vhostNginx,
    configStore: {
      get: vi.fn(() => []),
      set: vi.fn(),
      getDataPath: vi.fn(() => 'C:/Users/Jeffrey/.devbox-pro'),
      getResourcesPath: vi.fn(() => 'C:/Users/Jeffrey/AppData/Roaming/devbox-pro/resources'),
    },
    managers: {
      service: {
        getServicePorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
        serviceStatus: new Map([['nginx', { version: '1.28' }]]),
        standardPortOwner: 'nginx',
      },
      log: {
        systemWarn: vi.fn(),
      },
    },
    getDataPath: vi.fn(() => 'C:/Users/Jeffrey/.devbox-pro'),
    getResourcesPath: vi.fn(() => 'C:/Users/Jeffrey/AppData/Roaming/devbox-pro/resources'),
    getEffectiveWebServerVersion: vi.fn(() => '1.28'),
    getPhpFpmPort: vi.fn(() => 9957),
    getProjectServerNameEntries: vi.fn(() => ['hrms.test', 'www.hrms.test', '*.hrms.test']),
    getDocumentRoot: vi.fn(() => 'C:/laragon/www/hrms/public'),
    ensureProjectSslCertificates: vi.fn().mockResolvedValue(true),
    networkPort80Owner: null,
    ...overrides,
  };
}

describe('project/vhostNginx', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readdir').mockResolvedValue(['1.28']);
    vi.spyOn(fs, 'writeFile').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes escaped nginx regex locations so normal assets are not denied', async () => {
    const ctx = makeContext();
    const project = {
      id: 'a44d66d8-f88d-4308-ae44-42a167e0d2c5',
      name: 'HRMIS',
      domain: 'hrms.test',
      path: 'C:/laragon/www/hrms',
      ssl: true,
      networkAccess: true,
    };

    await ctx.createNginxVhost(project, 9957, '1.28');

    const [, config] = fs.writeFile.mock.calls[0];
    expect(config).toContain('location ~ \\.php$ {');
    expect(config).toContain('location ~ /\\.(?!well-known).* {');
  });

  it('uses the target nginx version for SSL http2 syntax in mixed-version setups', async () => {
    const ctx = makeContext({
      managers: {
        service: {
          getServicePorts: vi.fn((serviceName, version) => {
            if (serviceName === 'nginx' && version === '1.24') {
              return { httpPort: 8083, sslPort: 8445 };
            }

            if (serviceName === 'nginx' && version === '1.28') {
              return { httpPort: 80, sslPort: 443 };
            }

            return { httpPort: 80, sslPort: 443 };
          }),
          serviceStatus: new Map([['nginx', { version: '1.28' }]]),
          standardPortOwner: 'nginx',
        },
        log: {
          systemWarn: vi.fn(),
        },
      },
      getEffectiveWebServerVersion: vi.fn(() => '1.24'),
    });
    const project = {
      id: 'mixed-version-project',
      name: 'Legacy App',
      domain: 'legacy.test',
      path: 'C:/laragon/www/legacy',
      ssl: true,
      webServer: 'nginx',
      webServerVersion: '1.24',
      networkAccess: false,
    };

    await ctx.createNginxVhost(project, 9957, '1.24');

    const [, config] = fs.writeFile.mock.calls.at(-1);
    expect(config).toContain('listen 8445 ssl http2;');
    expect(config).not.toContain('http2 on;');
  });
});