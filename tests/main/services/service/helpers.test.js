import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const helpers = require('../../../../src/main/services/service/helpers');

const originalPlatform = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

function normalizeTestPath(value) {
  return String(value).replace(/\\/g, '/');
}

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
    setPlatform('win32');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
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

  it('refreshes stale Windows runtime DLLs from bundled vcredist files', async () => {
    const ctx = makeContext({
      getBundledVCRedistDirs: vi.fn(() => ['/bundle/vcredist']),
    });

    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      const normalizedPath = normalizeTestPath(targetPath);

      if (normalizedPath.startsWith('/bundle/vcredist')) return true;
      if (normalizedPath.endsWith('/System32/vcruntime140.dll')) return true;
      if (normalizedPath.endsWith('/System32/msvcp140.dll')) return true;
      if (normalizedPath.endsWith('/System32/vcruntime140_1.dll')) return true;
      if (normalizedPath.startsWith('/target/runtime')) return true;
      return false;
    });
    vi.spyOn(fs, 'stat').mockImplementation(async (targetPath) => {
      if (normalizeTestPath(targetPath).startsWith('/bundle/vcredist')) {
        return { size: 42 };
      }

      return { size: 29 };
    });
    const copySpy = vi.spyOn(fs, 'copy').mockResolvedValue(undefined);

    await ctx.ensureWindowsRuntimeDlls('/target/runtime', 'MySQL 8.4');

    expect(copySpy).toHaveBeenCalledWith(
      path.join('/bundle/vcredist', 'vcruntime140.dll'),
      path.join('/target/runtime', 'vcruntime140.dll'),
      { overwrite: true }
    );
    expect(copySpy).toHaveBeenCalledWith(
      path.join('/bundle/vcredist', 'msvcp140.dll'),
      path.join('/target/runtime', 'msvcp140.dll'),
      { overwrite: true }
    );
    expect(copySpy).toHaveBeenCalledWith(
      path.join('/bundle/vcredist', 'vcruntime140_1.dll'),
      path.join('/target/runtime', 'vcruntime140_1.dll'),
      { overwrite: true }
    );
    expect(copySpy).not.toHaveBeenCalledWith(
      expect.stringContaining('System32'),
      expect.any(String),
      expect.any(Object)
    );
  });
});
