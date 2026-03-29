import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const helpers = require('../../../../src/main/services/service/helpers');

function makeContext(overrides = {}) {
  return {
    resourcePath: '/resources',
    configStore: {
      get: vi.fn((key) => {
        if (key === 'dataPath') return '/configured-data';
        return undefined;
      }),
    },
    managers: {
      log: {
        systemWarn: vi.fn(),
        systemInfo: vi.fn(),
      },
    },
    ...helpers,
    ...overrides,
  };
}

describe('service/helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('prefers configStore.getDataPath when available', () => {
    const ctx = makeContext({
      configStore: {
        getDataPath: vi.fn(() => '/custom-data-path'),
        get: vi.fn(),
      },
    });

    expect(ctx.getDataPath()).toBe('/custom-data-path');
  });

  it('adopts legacy MySQL data when the current directory is uninitialized and empty', async () => {
    const ctx = makeContext({
      getLegacyMySQLDataDir: vi.fn(() => '/legacy/mysql/8.4/data'),
    });

    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      if (targetPath === path.join('/current/mysql/8.4/data', 'mysql')) return false;
      if (targetPath === path.join('/legacy/mysql/8.4/data', 'mysql')) return true;
      return true;
    });
    vi.spyOn(fs, 'readdir').mockResolvedValue([]);
    vi.spyOn(fs, 'copy').mockResolvedValue(undefined);

    const adopted = await ctx.maybeAdoptLegacyMySQLData('8.4', '/current/mysql/8.4/data');

    expect(adopted).toBe(true);
    expect(fs.copy).toHaveBeenCalledWith('/legacy/mysql/8.4/data', '/current/mysql/8.4/data', {
      overwrite: false,
      errorOnExist: false,
    });
    expect(ctx.managers.log.systemInfo).toHaveBeenCalled();
  });

  it('keeps process output snippets bounded', () => {
    const ctx = makeContext();

    const result = ctx.appendProcessOutputSnippet('first line', 'second line that is longer', 20);

    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toContain('longer');
  });

  it('delegates Linux runtime dependency repair to the binary manager', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux' });

    const ensureLinuxBinarySystemDependencies = vi.fn().mockResolvedValue({ success: true });
    const ctx = makeContext({
      managers: {
        log: {
          systemWarn: vi.fn(),
          systemInfo: vi.fn(),
        },
        binaryDownload: {
          ensureLinuxBinarySystemDependencies,
        },
      },
    });

    try {
      await ctx.ensureLinuxServiceRuntimeDependencies('mysql', '8.4', ['/resources/mysql/8.4/linux/bin/mysqld']);

      expect(ensureLinuxBinarySystemDependencies).toHaveBeenCalledWith(
        'mysql',
        '8.4',
        ['/resources/mysql/8.4/linux/bin/mysqld']
      );
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform });
    }
  });
});
