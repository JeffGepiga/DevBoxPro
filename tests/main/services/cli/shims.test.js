import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const cliShims = require('../../../../src/main/services/cli/shims');

const originalPlatform = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

function makeContext(overrides = {}) {
  return {
    ...cliShims,
    resourcesPath: 'C:/DevBox/resources',
    configStore: {
      get: vi.fn((key, fallback) => fallback),
      set: vi.fn(),
    },
    getCliPath: vi.fn(() => 'C:/DevBox/cli'),
    syncProjectsFile: vi.fn(async () => 'C:/DevBox/cli/projects.json'),
    getProjectsFilePath: vi.fn(() => 'C:/DevBox/cli/projects.json'),
    getDefaultPhpVersion: vi.fn(() => '8.4'),
    getFirstInstalledPhpVersion: vi.fn(() => '8.3'),
    getDefaultNodeVersion: vi.fn(() => '22'),
    getFirstInstalledNodeVersion: vi.fn(() => '20'),
    getDefaultPythonVersion: vi.fn(() => '3.13'),
    getFirstInstalledPythonVersion: vi.fn(() => '3.12'),
    getActiveMysqlInfo: vi.fn(() => ({ dbType: 'mysql', version: '8.4' })),
    installWindowsDirectShims: cliShims.installWindowsDirectShims,
    installUnixDirectShims: cliShims.installUnixDirectShims,
    installDirectShims: cliShims.installDirectShims,
    removeDirectShims: cliShims.removeDirectShims,
    ...overrides,
  };
}

describe('cli/shims', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setPlatform('win32');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('persists the direct shims setting and dispatches to install or remove', async () => {
    const ctx = makeContext({
      installDirectShims: vi.fn(async () => ({ success: true })),
      removeDirectShims: vi.fn(async () => ({ success: true })),
    });

    await expect(ctx.setDirectShimsEnabled(true)).resolves.toBe(true);
    await expect(ctx.setDirectShimsEnabled(false)).resolves.toBe(false);

    expect(ctx.configStore.set).toHaveBeenCalledWith('settings.directShimsEnabled', true);
    expect(ctx.configStore.set).toHaveBeenCalledWith('settings.directShimsEnabled', false);
    expect(ctx.installDirectShims).toHaveBeenCalledTimes(1);
    expect(ctx.removeDirectShims).toHaveBeenCalledTimes(1);
  });

  it('installs direct shims by preparing the cli directory, syncing projects, and dispatching per platform', async () => {
    const ctx = makeContext({
      installWindowsDirectShims: vi.fn(async () => true),
    });
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.installDirectShims();

    expect(fs.ensureDir).toHaveBeenCalledWith('C:/DevBox/cli');
    expect(ctx.syncProjectsFile).toHaveBeenCalled();
    expect(ctx.installWindowsDirectShims).toHaveBeenCalledWith('C:/DevBox/cli');
    expect(result).toEqual({ success: true, path: 'C:/DevBox/cli' });
  });

  it('removes existing shim files for the active platform extension', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      return [path.join('C:/DevBox/cli', 'php.cmd'), path.join('C:/DevBox/cli', 'composer.cmd')].includes(targetPath);
    });
    const removeSpy = vi.spyOn(fs, 'remove').mockResolvedValue(undefined);

    const result = await ctx.removeDirectShims();

    expect(result).toEqual({ success: true });
    expect(removeSpy).toHaveBeenCalledWith(path.join('C:/DevBox/cli', 'php.cmd'));
    expect(removeSpy).toHaveBeenCalledWith(path.join('C:/DevBox/cli', 'composer.cmd'));
  });

  it('writes Windows direct shim files with the configured default runtime values', async () => {
    const ctx = makeContext();
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await ctx.installWindowsDirectShims('C:/DevBox/cli');

    expect(result).toBe(true);
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('C:/DevBox/cli', 'php.cmd'),
      expect.stringContaining('set "DEFAULT_PHP=8.4"'),
      'utf8'
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('C:/DevBox/cli', 'composer.cmd'),
      expect.stringContaining('set "COMPOSER_PATH=%DEVBOX_RESOURCES%\\composer\\composer.phar"'),
      'utf8'
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('C:/DevBox/cli', 'pip.cmd'),
      expect.stringContaining('set "DEFAULT_PYTHON=3.13"'),
      'utf8'
    );
  });
});