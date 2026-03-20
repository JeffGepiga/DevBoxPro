import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
const fs = require('fs-extra');

require('../../../helpers/mockElectronCjs');

const vhostApache = require('../../../../src/main/services/project/vhostApache');

function makeContext(overrides = {}) {
  return {
    ...vhostApache,
    configStore: {
      getDataPath: vi.fn(() => 'C:/Users/Jeffrey/.devbox-pro'),
    },
    managers: {
      service: {
        getServicePorts: vi.fn(() => ({ httpPort: 80, sslPort: 443 })),
        serviceStatus: new Map([['apache', { version: '2.4' }]]),
        standardPortOwner: 'apache',
      },
      log: {
        systemWarn: vi.fn(),
        systemError: vi.fn(),
      },
    },
    getDataPath: vi.fn(() => 'C:/Users/Jeffrey/.devbox-pro'),
    getResourcesPath: vi.fn(() => 'C:/Users/Jeffrey/AppData/Roaming/devbox-pro/resources'),
    getEffectiveWebServerVersion: vi.fn(() => '2.4'),
    getProjectServerAliasEntries: vi.fn(() => ['www.hrms.test', '*.hrms.test']),
    getProjectPrimaryDomain: vi.fn(() => 'hrms.test'),
    getDocumentRoot: vi.fn(() => 'C:/laragon/www/hrms/public'),
    getPhpFpmPort: vi.fn(() => 9957),
    ensureProjectSslCertificates: vi.fn().mockResolvedValue(true),
    networkPort80Owner: null,
    ...overrides,
  };
}

describe('project/vhostApache', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue();
    vi.spyOn(fs, 'writeFile').mockResolvedValue();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('writes file-aware rewrite rules without a blanket asset deny rule', async () => {
    const ctx = makeContext();
    const project = {
      id: 'a44d66d8-f88d-4308-ae44-42a167e0d2c5',
      name: 'HRMIS',
      domain: 'hrms.test',
      path: 'C:/laragon/www/hrms',
      phpVersion: '8.3',
      ssl: true,
      networkAccess: true,
    };

    await ctx.createApacheVhost(project, '2.4');

    const [, config] = fs.writeFile.mock.calls[0];
    expect(config).toContain('RewriteCond %{REQUEST_FILENAME} !-f');
    expect(config).toContain('RewriteCond %{REQUEST_FILENAME} !-d');
    expect(config).not.toContain('access forbidden by rule');
    expect(config).not.toContain('location ~ /\\.(?!well-known).* {');
  });
});