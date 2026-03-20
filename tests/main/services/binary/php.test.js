import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const binaryPhp = require('../../../../src/main/services/binary/php');

function makeContext(overrides = {}) {
  return {
    resourcesPath: '/resources',
    downloads: {
      php: {
        '8.3': {
          win: {
            url: 'https://example.com/php-8.3.29.zip',
            filename: 'php-8.3.29.zip',
          },
        },
      },
    },
    configStore: {
      get: vi.fn(() => ({ serverTimezone: 'Asia/Manila' })),
    },
    managers: {
      log: {
        systemError: vi.fn(),
        systemWarn: vi.fn(),
        info: vi.fn(),
      },
    },
    getPlatform: vi.fn(() => 'win'),
    emitProgress: vi.fn(),
    downloadWithVersionProbe: vi.fn(),
    checkCancelled: vi.fn(),
    extractArchive: vi.fn(),
    createPhpIni: vi.fn(),
    ensureVCRedist: vi.fn(),
    ensureCaCertBundle: vi.fn(),
    ...binaryPhp,
    ...overrides,
  };
}

describe('binary/php', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('orchestrates PHP download, extraction, ini creation, and VC runtime setup', async () => {
    const ctx = makeContext({
      downloadWithVersionProbe: vi.fn().mockResolvedValue({ downloadPath: '/resources/downloads/php-8.3.29.zip' }),
      createPhpIni: vi.fn().mockResolvedValue(undefined),
      ensureVCRedist: vi.fn().mockResolvedValue(undefined),
      extractArchive: vi.fn().mockResolvedValue(undefined),
      checkCancelled: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.downloadPhp('8.3');

    expect(result).toEqual({ success: true });
    expect(ctx.downloadWithVersionProbe).toHaveBeenCalledWith(
      'php',
      '8.3',
      'php-8.3',
      ctx.downloads.php['8.3'].win
    );
    expect(ctx.extractArchive).toHaveBeenCalledWith(
      '/resources/downloads/php-8.3.29.zip',
      expect.stringContaining('php'),
      'php-8.3'
    );
    expect(ctx.ensureVCRedist).toHaveBeenCalled();
  });

  it('writes php.ini with timezone, CA bundle, and enabled extensions', async () => {
    const ctx = makeContext({
      ensureCaCertBundle: vi.fn().mockResolvedValue('/resources/php/8.3/win/cacert.pem'),
    });
    vi.spyOn(fs, 'pathExists').mockImplementation(async (checkPath) => (
      checkPath.endsWith('php_curl.dll') || checkPath.endsWith('php_gd.dll')
    ));
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await binaryPhp.createPhpIni.call(ctx, '/resources/php/8.3/win', '8.3');

    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('php.ini'),
      expect.stringContaining('date.timezone = Asia/Manila')
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('php.ini'),
      expect.stringContaining('curl.cainfo = "/resources/php/8.3/win/cacert.pem"')
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('php.ini'),
      expect.stringContaining('extension=php_curl.dll')
    );
  });

  it('updates existing php.ini files with extension_dir and available extensions', async () => {
    const ctx = makeContext({
      ensureCaCertBundle: vi.fn().mockResolvedValue('/resources/php/8.3/win/cacert.pem'),
    });
    vi.spyOn(fs, 'pathExists').mockImplementation(async (checkPath) => (
      checkPath === path.join('/resources', 'php')
      || checkPath.endsWith('php.ini')
      || checkPath.endsWith('php_curl.dll')
    ));
    vi.spyOn(fs, 'readdir').mockResolvedValue(['8.3']);
    vi.spyOn(fs, 'readFile').mockResolvedValue('[PHP]\n; extension=php_curl.dll\n');
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await binaryPhp.enablePhpExtensions.call(ctx);

    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('php.ini'),
      expect.stringContaining('extension_dir = "/resources/php/8.3/win/ext"')
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      expect.stringContaining('php.ini'),
      expect.stringContaining('extension=php_curl.dll')
    );
  });
});