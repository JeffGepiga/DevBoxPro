import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = require('fs-extra');
const serviceDownloads = require('../../../../src/main/services/binary/serviceDownloads');

function makeContext(overrides = {}) {
  return {
    ...serviceDownloads,
    resourcesPath: '/resources',
    downloads: {
      mysql: {
        '8.4': {
          win: {
            url: 'https://example.com/mysql-8.4.7.zip',
            filename: 'mysql-8.4.7.zip',
          },
        },
      },
      phpmyadmin: {
        all: {
          url: 'https://example.com/phpmyadmin.zip',
          filename: 'phpmyadmin.zip',
        },
      },
      apache: {
        '2.4': {
          win: {
            url: 'https://bad.example.com/httpd.zip',
            filename: 'httpd.zip',
            fallbackUrls: ['https://good.example.com/httpd.zip'],
          },
        },
      },
    },
    managers: {
      log: {
        systemError: vi.fn(),
        systemWarn: vi.fn(),
      },
    },
    getPlatform: vi.fn(() => 'win'),
    emitProgress: vi.fn(),
    downloadFile: vi.fn(),
    checkCancelled: vi.fn(),
    extractArchive: vi.fn(),
    fetchRemoteMetadata: vi.fn(),
    saveServiceMetadata: vi.fn(),
    createApacheConfig: vi.fn(),
    generateSecret: vi.fn(() => 'secret-value'),
    ...overrides,
  };
}

describe('binary/serviceDownloads', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('orchestrates MySQL download through extract and cleanup', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.downloadMysql('8.4');

    expect(result).toEqual({ success: true, version: '8.4' });
    expect(ctx.downloadFile).toHaveBeenCalledWith(
      'https://example.com/mysql-8.4.7.zip',
      expect.stringContaining('mysql-8.4.7.zip'),
      'mysql-8.4'
    );
    expect(ctx.extractArchive).toHaveBeenCalledWith(
      expect.stringContaining('mysql-8.4.7.zip'),
      expect.stringContaining('mysql'),
      'mysql-8.4'
    );
  });

  it('downloads phpMyAdmin and persists remote metadata when available', async () => {
    const ctx = makeContext({
      fetchRemoteMetadata: vi.fn().mockResolvedValue({ etag: 'etag-1' }),
      saveServiceMetadata: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.downloadPhpMyAdmin();

    expect(result).toEqual({ success: true });
    expect(ctx.fetchRemoteMetadata).toHaveBeenCalledWith('https://example.com/phpmyadmin.zip');
    expect(ctx.saveServiceMetadata).toHaveBeenCalledWith('phpmyadmin', { etag: 'etag-1' });
  });

  it('falls back to a secondary Apache download URL before extracting', async () => {
    const ctx = makeContext({
      createApacheConfig: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
    ctx.downloadFile
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce(undefined);

    const result = await ctx.downloadApache('2.4');

    expect(result).toEqual({ success: true, version: '2.4' });
    expect(ctx.downloadFile.mock.calls.map((call) => call[0])).toEqual([
      'https://bad.example.com/httpd.zip',
      'https://good.example.com/httpd.zip',
    ]);
    expect(ctx.createApacheConfig).toHaveBeenCalled();
  });

  it('writes a phpMyAdmin config with a generated blowfish secret', async () => {
    const ctx = makeContext();
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.createPhpMyAdminConfig('/resources/phpmyadmin');

    expect(ctx.generateSecret).toHaveBeenCalledWith(32);
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('config.inc.php'),
      expect.stringContaining("$cfg['blowfish_secret'] = 'secret-value';")
    );
  });
});