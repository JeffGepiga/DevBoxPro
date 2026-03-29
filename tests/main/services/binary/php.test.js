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

  it('writes Linux php.ini with mysqlnd and pdo before dependent extensions', async () => {
    const ctx = makeContext({
      getPlatform: vi.fn(() => 'linux'),
      createLinuxPhpLaunchers: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(fs, 'pathExists').mockImplementation(async (checkPath) => {
      const normalizedPath = checkPath.toString().replace(/\\/g, '/');
      return normalizedPath.endsWith('/curl.so')
        || normalizedPath.endsWith('/ctype.so')
        || normalizedPath.endsWith('/iconv.so')
        || normalizedPath.endsWith('/mbstring.so')
        || normalizedPath.endsWith('/phar.so')
        || normalizedPath.endsWith('/pdo.so')
        || normalizedPath.endsWith('/mysqlnd.so')
        || normalizedPath.endsWith('/pdo_mysql.so')
        || normalizedPath.endsWith('/pdo_sqlite.so')
        || normalizedPath.endsWith('/mysqli.so')
        || normalizedPath.endsWith('/sqlite3.so')
        || normalizedPath.endsWith('/zip.so')
        || normalizedPath.endsWith('/gd.so')
        || normalizedPath.endsWith('/fileinfo.so')
        || normalizedPath.endsWith('/tokenizer.so')
        || normalizedPath.endsWith('/xml.so')
        || normalizedPath.endsWith('/dom.so')
        || normalizedPath.endsWith('/simplexml.so')
        || normalizedPath.endsWith('/xmlreader.so')
        || normalizedPath.endsWith('/xmlwriter.so');
    });
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await binaryPhp.createPhpIni.call(ctx, '/resources/php/8.3/linux', '8.3');

    const iniContents = writeFileSpy.mock.calls.find(([, content]) => content.includes('DevBox Pro PHP 8.3 Configuration'))?.[1];
    expect(iniContents).toContain('extension=phar.so');
    expect(iniContents).toContain('extension=pdo.so');
    expect(iniContents).toContain('extension=mysqlnd.so');
    expect(iniContents.indexOf('extension=pdo.so')).toBeLessThan(iniContents.indexOf('extension=pdo_mysql.so'));
    expect(iniContents.indexOf('extension=mysqlnd.so')).toBeLessThan(iniContents.indexOf('extension=mysqli.so'));
    expect(ctx.createLinuxPhpLaunchers).toHaveBeenCalledWith('/resources/php/8.3/linux', '8.3');
  });

  it('writes Linux launcher scripts with LD_LIBRARY_PATH fallbacks', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs, 'chmod').mockResolvedValue(undefined);

    await binaryPhp.createLinuxPhpLaunchers.call(ctx, '/resources/php/8.4/linux', '8.4');

    const launcherContent = writeFileSpy.mock.calls.find(([filePath]) => filePath.toString().replace(/\\/g, '/').endsWith('/php'))?.[1];
    expect(launcherContent).toContain('LD_LIBRARY_DIRS=()');
    expect(launcherContent).toContain('export LD_LIBRARY_PATH=');
    expect(launcherContent).toContain('exec "${ROOT_DIR}/usr/bin/php8.4" -c "${ROOT_DIR}/php.ini" "$@"');
  });

  it('installs missing Linux PHP shared-library packages automatically', async () => {
    const ctx = makeContext({
      getPlatform: vi.fn(() => 'linux'),
      hasLinuxSharedLibrary: vi.fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false)
        .mockResolvedValue(true),
      detectLinuxPackageManager: vi.fn().mockResolvedValue({
        command: 'apt-get',
        install: (pkg) => `apt-get install -y ${pkg}`,
      }),
      resolveLinuxPackageName: vi.fn()
        .mockResolvedValueOnce('libonig5')
        .mockResolvedValueOnce('libzip4t64'),
      runPrivilegedLinuxCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    });

    const result = await ctx.ensureLinuxPhpSystemDependencies('8.4', 'php-8.4');

    expect(result).toEqual({ success: true, installed: ['libonig5', 'libzip4t64'] });
    expect(ctx.runPrivilegedLinuxCommand).toHaveBeenCalledWith('apt-get install -y libonig5 libzip4t64');
    expect(ctx.emitProgress).toHaveBeenCalledWith('php-8.4', expect.objectContaining({
      status: 'installing',
      progress: 70,
    }));
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