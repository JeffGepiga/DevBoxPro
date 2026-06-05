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

  it('extracts the most relevant MySQL startup failure line instead of generic shutdown footer', () => {
    const ctx = makeContext();
    const tail = [
      '2026-06-05T05:55:12.220000Z 0 [ERROR] [MY-010119] [Server] Aborting',
      '2026-06-05T05:55:12.332134Z 0 [System] [MY-015016] [Server] MySQL Server - end.',
    ].join('\n');

    const line = ctx.extractMySqlStartupFailureLine(tail);

    expect(line).toContain('[ERROR]');
    expect(line).toContain('Aborting');
  });

  it('prefers the specific error before generic server abort during startup failures', () => {
    const ctx = makeContext();
    const tail = [
      '2026-06-05T06:14:11.830001Z 0 [ERROR] [MY-010946] [Server] Failed to open optimizer cost constant tables',
      '2026-06-05T06:14:11.841061Z 0 [ERROR] [MY-010119] [Server] Aborting',
      '2026-06-05T06:14:11.842000Z 0 [System] [MY-015016] [Server] MySQL Server - end.',
    ].join('\n');

    const line = ctx.extractMySqlStartupFailureLine(tail);

    expect(line).toContain('Failed to open optimizer cost constant tables');
    expect(line).not.toContain('Aborting');
  });

  it('escapes MySQL string literals for quotes and backslashes', () => {
    const ctx = makeContext();

    expect(ctx.escapeMySqlStringLiteral("pa'ss\\word")).toBe("pa''ss\\\\word");
  });

  it('extracts MariaDB startup failure line from error log tail and ignores generic abort footer', () => {
    const ctx = makeContext();
    const tail = [
      '2026-06-05 06:40:01 0 [ERROR] mariadbd.exe: Aria engine: log initialization failed',
      '2026-06-05 06:40:01 0 [ERROR] Aborting',
      '2026-06-05 06:40:01 0 [Note] mariadbd: Shutdown complete',
    ].join('\n');

    const line = ctx.extractMariaDbStartupFailureLine(tail);

    expect(line).toContain('Aria engine: log initialization failed');
    expect(line).not.toContain('Aborting');
  });

  it('falls back to stderr output for MariaDB failure extraction when error log tail is missing', () => {
    const ctx = makeContext();
    const fallbackOutput = [
      '2026-06-05 06:40:02 0 [ERROR] mariadbd.exe: InnoDB: Unable to lock ./ibdata1 error: 32',
      '2026-06-05 06:40:02 0 [ERROR] Aborting',
    ].join('\n');

    const line = ctx.extractMariaDbStartupFailureLine('', fallbackOutput);

    expect(line).toContain('Unable to lock ./ibdata1');
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
