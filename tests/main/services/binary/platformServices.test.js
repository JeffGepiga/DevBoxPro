import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const platformServices = require('../../../../src/main/services/binary/platformServices');

function makeContext(overrides = {}) {
  return {
    ...platformServices,
    resourcesPath: '/resources',
    downloads: {
      python: {
        '3.13': {
          win: {
            url: 'https://example.com/python.zip',
            filename: 'python.zip',
          },
        },
      },
      mongodb: {
        '8.0': {
          win: {
            url: 'https://example.com/mongodb.zip',
            filename: 'mongodb.zip',
          },
        },
      },
      mongosh: {
        latest: {
          win: {
            url: 'https://example.com/mongosh.zip',
            filename: 'mongosh.zip',
          },
        },
      },
      sqlite: {
        '3': {
          mac: {
            url: 'builtin',
            filename: 'sqlite',
          },
        },
      },
      minio: {
        latest: {
          linux: {
            url: 'https://example.com/minio',
            filename: 'minio',
          },
        },
      },
      memcached: {
        '1.6': {
          win: {
            url: 'https://example.com/memcached.zip',
            filename: 'memcached.zip',
          },
        },
      },
    },
    managers: {
      log: {
        systemError: vi.fn(),
        systemWarn: vi.fn(),
        system: vi.fn(),
      },
    },
    getPlatform: vi.fn(() => 'win'),
    emitProgress: vi.fn(),
    downloadFile: vi.fn().mockResolvedValue(undefined),
    checkCancelled: vi.fn().mockResolvedValue(undefined),
    extractArchive: vi.fn().mockResolvedValue(undefined),
    bootstrapPip: vi.fn().mockResolvedValue(undefined),
    downloadMongosh: vi.fn().mockResolvedValue({ success: true }),
    ...overrides,
  };
}

describe('binary/platformServices', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('downloads Python, enables site-packages, and bootstraps pip', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readFile').mockResolvedValue('#import site');
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await ctx.downloadPython('3.13');

    expect(result).toEqual({ success: true, version: '3.13' });
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('/resources', 'python', '3.13', 'win', 'python313._pth'),
      'import site'
    );
    expect(ctx.bootstrapPip).toHaveBeenCalledWith(path.join('/resources', 'python', '3.13', 'win'), 'win', 'python-3.13');
  });

  it('downloads MongoDB, flattens the extracted directory, and downloads mongosh', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'move').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readdir').mockImplementation(async (targetPath) => {
      if (targetPath === path.join('/resources', 'mongodb', '8.0', 'win')) {
        return ['mongodb-win-x64'];
      }

      if (targetPath === path.join('/resources', 'mongodb', '8.0', 'win', 'mongodb-win-x64')) {
        return ['bin', 'LICENSE'];
      }

      return [];
    });

    const result = await ctx.downloadMongodb('8.0');

    expect(result).toEqual({ success: true, version: '8.0' });
    expect(fs.move).toHaveBeenCalledWith(
      path.join('/resources', 'mongodb', '8.0', 'win', 'mongodb-win-x64', 'bin'),
      path.join('/resources', 'mongodb', '8.0', 'win', 'bin'),
      { overwrite: true }
    );
    expect(ctx.downloadMongosh).toHaveBeenCalledWith('8.0');
  });

  it('treats SQLite as builtin when the platform download is marked builtin', async () => {
    const ctx = makeContext({
      getPlatform: vi.fn(() => 'mac'),
    });

    const result = await ctx.downloadSqlite('3');

    expect(result).toEqual({ success: true, builtin: true, version: '3' });
    expect(ctx.downloadFile).not.toHaveBeenCalled();
  });

  it('downloads MinIO and marks the binary executable on non-Windows platforms', async () => {
    const ctx = makeContext({
      getPlatform: vi.fn(() => 'linux'),
    });
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    const chmodSpy = vi.spyOn(fs, 'chmod').mockResolvedValue(undefined);

    const result = await ctx.downloadMinio();

    expect(result).toEqual({ success: true });
    expect(ctx.downloadFile).toHaveBeenCalledWith(
      'https://example.com/minio',
      path.join('/resources', 'minio', 'linux', 'minio'),
      'minio'
    );
    expect(chmodSpy).toHaveBeenCalledWith(path.join('/resources', 'minio', 'linux', 'minio'), '755');
  });

  it('flattens extracted Memcached directories on Windows', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'move').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => targetPath === path.join('/resources', 'memcached', '1.6', 'win', 'bin'));
    vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true });
    vi.spyOn(fs, 'readdir').mockImplementation(async (targetPath) => {
      if (targetPath === path.join('/resources', 'memcached', '1.6', 'win')) {
        return ['memcached-1.6', 'bin'];
      }

      if (targetPath === path.join('/resources', 'memcached', '1.6', 'win', 'memcached-1.6')) {
        return ['memcached.exe'];
      }

      if (targetPath === path.join('/resources', 'memcached', '1.6', 'win', 'bin')) {
        return ['libevent.dll'];
      }

      return [];
    });

    const result = await ctx.downloadMemcached('1.6');

    expect(result).toEqual({ success: true, version: '1.6' });
    expect(fs.move).toHaveBeenCalledWith(
      path.join('/resources', 'memcached', '1.6', 'win', 'bin', 'libevent.dll'),
      path.join('/resources', 'memcached', '1.6', 'win', 'libevent.dll'),
      { overwrite: true }
    );
  });

  it('builds helper paths for the extracted services', () => {
    const ctx = makeContext();

    expect(ctx.getPostgresqlBinPath('17')).toBe(path.join('/resources', 'postgresql', '17', 'win', 'bin'));
    expect(ctx.getPythonPath('3.13')).toBe(path.join('/resources', 'python', '3.13', 'win', 'python.exe'));
    expect(ctx.getMongodbBinPath('8.0')).toBe(path.join('/resources', 'mongodb', '8.0', 'win', 'bin'));
    expect(ctx.getSqlitePath('3')).toBe(path.join('/resources', 'sqlite', '3', 'win', 'sqlite3.exe'));
    expect(ctx.getMinioPath()).toBe(path.join('/resources', 'minio', 'win', 'minio.exe'));
    expect(ctx.getMemcachedPath('1.6')).toBe(path.join('/resources', 'memcached', '1.6', 'win', 'memcached.exe'));
  });
});