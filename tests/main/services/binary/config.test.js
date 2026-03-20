import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const configMixin = require('../../../../src/main/services/binary/config');

function makeContext(overrides = {}) {
  return {
    downloads: {
      php: {
        '8.3': {
          win: {
            url: 'https://example.com/php-8.3.29.zip',
            filename: 'php-8.3.29.zip',
          },
          label: 'Security Only',
        },
      },
      mysql: {},
    },
    versionMeta: {
      php: ['8.3'],
      mysql: [],
    },
    configVersion: '1.0.0',
    remoteConfig: null,
    localConfigPath: '/cache/binaries-config.json',
    managers: {
      log: {
        systemError: vi.fn(),
        systemWarn: vi.fn(),
      },
    },
    getPlatform: vi.fn(() => 'win'),
    ...configMixin,
    ...overrides,
  };
}

describe('binary/config', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('applies remote config downloads and version metadata', async () => {
    const ctx = makeContext();

    const appliedCount = await ctx.applyConfigToDownloads({
      version: '2.0.0',
      php: {
        versions: ['8.4', '8.3'],
        downloads: {
          '8.4': {
            win: {
              url: 'https://example.com/php-8.4.16.zip',
              filename: 'php-8.4.16.zip',
            },
            label: 'Latest',
          },
        },
      },
    });

    expect(appliedCount).toBe(1);
    expect(ctx.downloads.php['8.4']).toEqual({
      win: {
        url: 'https://example.com/php-8.4.16.zip',
        filename: 'php-8.4.16.zip',
      },
      label: 'Latest',
    });
    expect(ctx.versionMeta.php).toEqual(['8.4', '8.3']);
  });

  it('loads cached config and applies it to in-memory downloads', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readJson').mockResolvedValue({
      config: {
        version: '2.1.0',
        mysql: {
          versions: ['8.4'],
          downloads: {
            '8.4': {
              win: {
                url: 'https://example.com/mysql-8.4.7.zip',
                filename: 'mysql-8.4.7.zip',
              },
              label: 'Latest',
            },
          },
        },
      },
    });

    const loaded = await ctx.loadCachedConfig();

    expect(loaded).toBe(true);
    expect(ctx.remoteConfig.version).toBe('2.1.0');
    expect(ctx.configVersion).toBe('2.1.0');
    expect(ctx.downloads.mysql['8.4'].win.filename).toBe('mysql-8.4.7.zip');
  });

  it('applies loaded remote config updates and persists the cache', async () => {
    const ctx = makeContext({
      remoteConfig: {
        version: '3.0.0',
        php: {
          downloads: {
            '8.3': {
              win: {
                url: 'https://example.com/php-8.3.30.zip',
                filename: 'php-8.3.30.zip',
              },
            },
          },
        },
      },
    });
    vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);

    const result = await ctx.applyUpdates();

    expect(result).toEqual({ success: true, appliedCount: 1, version: '3.0.0' });
    expect(ctx.configVersion).toBe('3.0.0');
    expect(fs.writeJson).toHaveBeenCalledWith(
      '/cache/binaries-config.json',
      expect.objectContaining({
        config: expect.objectContaining({ version: '3.0.0' }),
      }),
      { spaces: 2 }
    );
  });
});
