import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const cliInstall = require('../../../../src/main/services/cli/install');

const originalPlatform = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

function makeContext(overrides = {}) {
  return {
    ...cliInstall,
    resourcesPath: 'C:/DevBox/resources',
    getAlias: vi.fn(() => 'dvp'),
    getCliPath: vi.fn(() => 'C:/DevBox/cli'),
    syncProjectsFile: vi.fn(async () => 'C:/DevBox/cli/projects.json'),
    getInstallInstructions: vi.fn((cliPath) => ({ automatic: cliPath })),
    getProjectsFilePath: vi.fn(() => 'C:/DevBox/cli/projects.json'),
    installWindowsCli: cliInstall.installWindowsCli,
    installUnixCli: cliInstall.installUnixCli,
    ...overrides,
  };
}

describe('cli/install', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setPlatform('win32');
  });

  afterEach(() => {
    setPlatform(originalPlatform);
  });

  it('installs the CLI wrapper by syncing projects and dispatching to the platform-specific installer', async () => {
    const ctx = makeContext({
      installWindowsCli: vi.fn(async () => 'C:/DevBox/cli/dvp.cmd'),
    });
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.installCli();

    expect(fs.ensureDir).toHaveBeenCalledWith('C:/DevBox/cli');
    expect(ctx.syncProjectsFile).toHaveBeenCalled();
    expect(ctx.installWindowsCli).toHaveBeenCalledWith('dvp', 'C:/DevBox/cli');
    expect(result).toEqual({
      alias: 'dvp',
      path: 'C:/DevBox/cli',
      instructions: { automatic: 'C:/DevBox/cli' },
    });
  });

  it('writes the Windows helper and wrapper scripts with project lookup support', async () => {
    const ctx = makeContext();
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await ctx.installWindowsCli('dvp', 'C:/DevBox/cli');

    expect(result).toBe(path.join('C:/DevBox/cli', 'dvp.cmd'));
    expect(writeFileSpy).toHaveBeenNthCalledWith(
      1,
      path.join('C:/DevBox/cli', 'find-project.ps1'),
      expect.stringContaining('Write-Output "FOUND|$php|$node|$mt|$mv|$py"'),
      'utf8'
    );
    expect(writeFileSpy).toHaveBeenNthCalledWith(
      2,
      path.join('C:/DevBox/cli', 'dvp.cmd'),
      expect.stringContaining('Usage: dvp ^<command^> [arguments]'),
      'utf8'
    );
  });

  it('writes the Unix wrapper script and marks it executable', async () => {
    setPlatform('linux');
    const ctx = makeContext({
      resourcesPath: '/opt/devbox/resources',
      getProjectsFilePath: vi.fn(() => '/opt/devbox/cli/projects.json'),
    });
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    const chmodSpy = vi.spyOn(fs, 'chmod').mockResolvedValue(undefined);

    const result = await ctx.installUnixCli('dvp', '/opt/devbox/cli');

    expect(result).toBe(path.join('/opt/devbox/cli', 'dvp'));
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('/opt/devbox/cli', 'dvp'),
      expect.stringContaining('DEVBOX_RESOURCES="/opt/devbox/resources"'),
      'utf8'
    );
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('/opt/devbox/cli', 'dvp'),
      expect.stringContaining('Usage: dvp <command> [arguments]'),
      'utf8'
    );
    expect(chmodSpy).toHaveBeenCalledWith(path.join('/opt/devbox/cli', 'dvp'), '755');
  });
});