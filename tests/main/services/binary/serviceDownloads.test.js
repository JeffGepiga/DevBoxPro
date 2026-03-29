import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');

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
      redis: {
        '7.4': {
          win: {
            url: 'https://example.com/redis.zip',
            filename: 'redis.zip',
          },
          linux: {
            url: 'builtin',
            manageWithPackageManager: true,
            packageNames: {
              'apt-get': ['redis-server', 'redis'],
            },
            filename: 'redis-system-package',
          },
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
      cloudflared: {
        win: {
          url: 'https://example.com/cloudflared.exe',
          filename: 'cloudflared.exe',
        },
      },
      zrok: {
        win: {
          githubRepo: 'openziti/zrok',
          assetPattern: 'windows.*amd64.*\\.(?:zip|tar\\.gz)$',
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

  it('parses missing Linux shared libraries from ldd output', () => {
    const ctx = makeContext();

    expect(ctx.parseMissingLinuxSharedLibraries(`
      libaio.so.1 => not found
      libnuma.so.1 => /lib/x86_64-linux-gnu/libnuma.so.1 (0x00007f)
      libssl.so.1.1 => not found
    `)).toEqual(['libaio.so.1', 'libssl.so.1.1']);
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

  it('downloads cloudflared directly to its executable path on Windows', async () => {
    const ctx = makeContext({
      fetchRemoteMetadata: vi.fn().mockResolvedValue({ lastModified: 'cf-last-modified' }),
      saveServiceMetadata: vi.fn().mockResolvedValue(undefined),
    });
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.downloadCloudflared();

    expect(result).toEqual({ success: true });
    expect(ctx.downloadFile).toHaveBeenCalledWith(
      'https://example.com/cloudflared.exe',
      expect.stringContaining('cloudflared.exe'),
      'cloudflared'
    );
    expect(ctx.saveServiceMetadata).toHaveBeenCalledWith('cloudflared', { lastModified: 'cf-last-modified' });
    expect(ctx.extractArchive).not.toHaveBeenCalled();
  });

  it('downloads zrok using the resolved latest GitHub release asset', async () => {
    const moveSpy = vi.spyOn(fs, 'move').mockResolvedValue(undefined);
    const ctx = makeContext({
      resolveGithubReleaseAsset: vi.fn().mockResolvedValue({
        url: 'https://example.com/zrok_2.0.1_windows_amd64.tar.gz',
        filename: 'zrok_2.0.1_windows_amd64.tar.gz',
        tagName: 'v2.0.1',
      }),
      fetchRemoteMetadata: vi.fn().mockResolvedValue({ lastModified: 'zrok-last-modified', etag: 'zrok-etag' }),
      saveServiceMetadata: vi.fn().mockResolvedValue(undefined),
      findBinaryInDir: vi.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('/resources/zrok/win/zrok2.exe'),
    });
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.downloadZrok();

    expect(result).toEqual({ success: true });
    expect(ctx.resolveGithubReleaseAsset).toHaveBeenCalledWith(
      'openziti/zrok',
      'windows.*amd64.*\\.(?:zip|tar\\.gz)$',
      []
    );
    expect(ctx.extractArchive).toHaveBeenCalledWith(
      expect.stringContaining('zrok_2.0.1_windows_amd64.tar.gz'),
      expect.stringContaining('zrok'),
      'zrok'
    );
    expect(moveSpy).toHaveBeenCalledWith(
      '/resources/zrok/win/zrok2.exe',
      path.join('/resources', 'zrok', 'win', 'zrok.exe'),
      { overwrite: true }
    );
    expect(ctx.saveServiceMetadata).toHaveBeenCalledWith('zrok', {
      lastModified: 'zrok-last-modified',
      etag: 'zrok-etag',
      tagName: 'v2.0.1',
    });
  });

  it('uses wsl.exe root handoff for privileged Linux commands inside WSL', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });
    process.env.WSL_DISTRO_NAME = 'Ubuntu';

    const ctx = makeContext({
      isRunningInWsl: vi.fn().mockResolvedValue(true),
      findLinuxCommand: vi.fn(async (command) => command === 'wsl.exe' ? '/mnt/c/Windows/System32/wsl.exe' : null),
      execLinuxCommand: vi.fn(async (command, args) => {
        if (command === 'bash' && args[1] === 'id -u') {
          return { stdout: '1000\n', stderr: '' };
        }

        if (command === '/mnt/c/Windows/System32/wsl.exe') {
          return { stdout: 'ok\n', stderr: '' };
        }

        throw new Error(`Unexpected command: ${command} ${args.join(' ')}`);
      }),
    });

    try {
      const result = await ctx.runPrivilegedLinuxCommand('apt-get install -y nginx');
      expect(result).toEqual({ stdout: 'ok\n', stderr: '' });
      expect(ctx.execLinuxCommand).toHaveBeenCalledWith(
        '/mnt/c/Windows/System32/wsl.exe',
        ['-d', 'Ubuntu', '-u', 'root', '--', 'bash', '-lc', 'apt-get install -y nginx'],
        { encoding: 'utf8' }
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
      delete process.env.WSL_DISTRO_NAME;
    }
  });

  it('installs missing Linux runtime packages for bundled service binaries', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const ctx = makeContext({
      findMissingLinuxSharedLibraries: vi.fn()
        .mockResolvedValueOnce(['libaio.so.1'])
        .mockResolvedValueOnce([]),
      detectLinuxPackageManager: vi.fn().mockResolvedValue({
        command: 'apt-get',
        install: (pkg) => `apt-get install -y ${pkg}`,
      }),
      resolveLinuxPackageName: vi.fn().mockResolvedValue('libaio1'),
      runPrivilegedLinuxCommand: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
    });

    try {
      const result = await ctx.ensureLinuxBinarySystemDependencies('mysql', '8.4', ['/resources/mysql/8.4/linux/bin/mysqld'], { id: 'mysql-8.4' });

      expect(result).toEqual({
        success: true,
        installed: ['libaio1'],
        missingLibraries: ['libaio.so.1'],
      });
      expect(ctx.runPrivilegedLinuxCommand).toHaveBeenCalledWith('apt-get install -y libaio1');
      expect(ctx.emitProgress).toHaveBeenCalledWith('mysql-8.4', expect.objectContaining({
        status: 'installing',
        progress: 88,
      }));
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });

  it('installs managed Linux Redis instead of extracting source archives', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const ctx = makeContext({
      getPlatform: vi.fn(() => 'linux'),
      installManagedLinuxRedis: vi.fn().mockResolvedValue({ success: true, version: '7.4', systemManaged: true }),
    });

    try {
      const result = await ctx.downloadRedis('7.4');

      expect(result).toEqual({ success: true, version: '7.4', systemManaged: true });
      expect(ctx.installManagedLinuxRedis).toHaveBeenCalledWith('7.4', ctx.downloads.redis['7.4'].linux);
      expect(ctx.downloadFile).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});