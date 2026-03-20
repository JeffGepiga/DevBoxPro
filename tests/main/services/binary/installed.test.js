import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const installedMixin = require('../../../../src/main/services/binary/installed');

function makeContext(overrides = {}) {
  return {
    resourcesPath: '/resources',
    versionMeta: {
      php: ['8.4'],
      mysql: [],
      mariadb: [],
      redis: [],
      nginx: [],
      apache: [],
      nodejs: ['20'],
      postgresql: [],
      python: [],
      mongodb: [],
      memcached: [],
    },
    managers: {
      log: {
        systemWarn: vi.fn(),
      },
    },
    getPlatform: vi.fn(() => 'win'),
    ...installedMixin,
    ...overrides,
  };
}

describe('binary/installed', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('marks a Node.js version as incomplete when node exists without npm/npx assets', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => targetPath.endsWith('node.exe'));

    await expect(ctx.isNodejsVersionInstalled('20', 'win')).resolves.toBe(false);
  });

  it('detects custom PHP versions only when both php and php-cgi exist', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      if (targetPath === path.join('/resources', 'php')) return true;
      if (targetPath.endsWith(path.join('8.5-custom', 'win', 'php.exe'))) return true;
      if (targetPath.endsWith(path.join('8.5-custom', 'win', 'php-cgi.exe'))) return true;
      return false;
    });
    vi.spyOn(fs, 'readdir').mockResolvedValue(['8.4', '8.5-custom']);

    const installed = { '8.4': true };
    await ctx.scanCustomPhpVersions(installed, 'win');

    expect(installed['8.5-custom']).toBe(true);
  });

  it('finds recursively nested executables for custom binary imports', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      if (targetPath === path.join('/resources', 'redis')) return true;
      if (targetPath.endsWith(path.join('7.5-custom', 'win'))) return true;
      return false;
    });
    vi.spyOn(fs, 'readdir')
      .mockResolvedValueOnce(['7.5-custom'])
      .mockResolvedValueOnce([
        { name: 'nested', isFile: () => false, isDirectory: () => true },
      ])
      .mockResolvedValueOnce([
        { name: 'redis-server.exe', isFile: () => true, isDirectory: () => false },
      ]);

    const installed = {};
    await ctx.scanBinaryVersionsRecursive('redis', installed, 'win', 'redis-server.exe');

    expect(installed['7.5-custom']).toBe(true);
  });

  it('reports complete installed binaries including Node.js when all required assets exist', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'readdir').mockResolvedValue([]);
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      const normalized = targetPath.replace(/\\/g, '/');
      return normalized.endsWith('/php/8.4/win/php.exe')
        || normalized.endsWith('/php/8.4/win/php-cgi.exe')
        || normalized.endsWith('/nodejs/20/win/node.exe')
        || normalized.endsWith('/nodejs/20/win/npm.cmd')
        || normalized.endsWith('/nodejs/20/win/npx.cmd');
    });

    const installed = await ctx.getInstalledBinaries();

    expect(installed.php['8.4']).toBe(true);
    expect(installed.nodejs['20']).toBe(true);
  });
});
