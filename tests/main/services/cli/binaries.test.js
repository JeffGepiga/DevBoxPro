import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const cliBinaries = require('../../../../src/main/services/cli/binaries');

function makeContext(overrides = {}) {
  const configStore = {
    get: vi.fn((key, fallback) => {
      const values = {
        'settings.defaultPhpVersion': null,
        'settings.defaultNodeVersion': null,
        'settings.defaultPythonVersion': null,
      };
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    }),
    getSetting: vi.fn((key, fallback) => {
      const values = {
        activeDatabaseType: 'mysql',
        activeDatabaseVersion: '8.4',
      };
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : fallback;
    }),
    set: vi.fn(),
    delete: vi.fn(),
  };

  return {
    ...cliBinaries,
    configStore,
    resourcesPath: '/resources',
    ...overrides,
  };
}

describe('cli/binaries', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the newest installed Node.js version that has an executable', () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      if (targetPath === path.join('/resources', 'nodejs')) return true;
      return targetPath === path.join('/resources', 'nodejs', '22', 'win', 'node.exe');
    });
    vi.spyOn(fs, 'readdirSync').mockReturnValue(['20', '22', '18']);

    expect(ctx.getFirstInstalledNodeVersion()).toBe('22');
  });

  it('builds a project PATH with PHP, Node.js, Composer, MySQL, PostgreSQL, Python, and MongoDB bins prepended', () => {
    const originalPath = process.env.PATH;
    process.env.PATH = 'SYSTEM_PATH';

    const ctx = makeContext({
      getPhpPath: vi.fn(() => path.join('/resources', 'php', '8.3', 'win', 'php.exe')),
      getFirstInstalledNodeVersion: vi.fn(() => '20'),
      getNodePath: vi.fn(() => path.join('/resources', 'nodejs', '20', 'win', 'node.exe')),
      getComposerPath: vi.fn(() => path.join('/resources', 'composer', 'composer.phar')),
      getActiveMysqlInfo: vi.fn(() => ({ dbType: 'mysql', version: '8.4' })),
      getMysqlClientPath: vi.fn(() => path.join('/resources', 'mysql', '8.4', 'win', 'bin', 'mysql.exe')),
      getPsqlPath: vi.fn(() => path.join('/resources', 'postgresql', '17', 'win', 'bin', 'psql.exe')),
      getPythonPath: vi.fn(() => path.join('/resources', 'python', '3.13', 'win', 'python.exe')),
      getMongoshPath: vi.fn(() => path.join('/resources', 'mongodb', '8.0', 'win', 'bin', 'mongosh.exe')),
    });

    const env = ctx.buildProjectEnv({
      phpVersion: '8.3',
      services: {
        nodejs: true,
        postgresql: true,
        python: true,
        mongodb: true,
      },
    });

    expect(env.PATH).toContain(path.join('/resources', 'php', '8.3', 'win'));
    expect(env.PATH).toContain(path.join('/resources', 'nodejs', '20', 'win'));
    expect(env.PATH).toContain(path.join('/resources', 'composer'));
    expect(env.PATH).toContain(path.join('/resources', 'mysql', '8.4', 'win', 'bin'));
    expect(env.PATH).toContain(path.join('/resources', 'postgresql', '17', 'win', 'bin'));
    expect(env.PATH).toContain(path.join('/resources', 'python', '3.13', 'win'));
    expect(env.PATH).toContain(path.join('/resources', 'python', '3.13', 'win', 'Scripts'));
    expect(env.PATH).toContain(path.join('/resources', 'mongodb', '8.0', 'win', 'bin'));

    process.env.PATH = originalPath;
  });

  it('falls back to sqlite3 on non-Windows platforms', () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const ctx = makeContext();

    expect(ctx.getSqlitePath('3')).toBe('sqlite3');

    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('persists and clears default runtime versions in config', () => {
    const ctx = makeContext();

    ctx.setDefaultPhpVersion('8.4');
    ctx.setDefaultNodeVersion('22');
    ctx.setDefaultPythonVersion('3.13');
    ctx.setDefaultPhpVersion(null);
    ctx.setDefaultNodeVersion(null);
    ctx.setDefaultPythonVersion(null);

    expect(ctx.configStore.set).toHaveBeenCalledWith('settings.defaultPhpVersion', '8.4');
    expect(ctx.configStore.set).toHaveBeenCalledWith('settings.defaultNodeVersion', '22');
    expect(ctx.configStore.set).toHaveBeenCalledWith('settings.defaultPythonVersion', '3.13');
    expect(ctx.configStore.delete).toHaveBeenCalledWith('settings.defaultPhpVersion');
    expect(ctx.configStore.delete).toHaveBeenCalledWith('settings.defaultNodeVersion');
    expect(ctx.configStore.delete).toHaveBeenCalledWith('settings.defaultPythonVersion');
  });

  it('detects the first installed MySQL-family version across mysql and mariadb', () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'existsSync').mockImplementation((targetPath) => {
      if (targetPath === path.join('/resources', 'mysql')) return true;
      if (targetPath === path.join('/resources', 'mariadb')) return true;
      return targetPath === path.join('/resources', 'mariadb', '11.4', 'win', 'bin', 'mysql.exe');
    });
    vi.spyOn(fs, 'readdirSync').mockImplementation((targetPath) => {
      if (targetPath === path.join('/resources', 'mysql')) return [];
      if (targetPath === path.join('/resources', 'mariadb')) return ['11.4'];
      return [];
    });

    expect(ctx.getFirstInstalledMysqlVersion()).toEqual({ dbType: 'mariadb', version: '11.4' });
  });
});