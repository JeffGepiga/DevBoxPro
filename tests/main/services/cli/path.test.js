import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const os = require('os');
const fs = require('fs-extra');
const cliPathMixin = require('../../../../src/main/services/cli/path');

const originalPlatform = process.platform;
const originalShell = process.env.SHELL;
const originalPathEnv = process.env.PATH;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
  });
}

function makeContext(overrides = {}) {
  return {
    ...cliPathMixin,
    getAlias: vi.fn(() => 'dvp'),
    getCliPath: vi.fn(() => '/cli/bin'),
    managers: {
      log: {
        systemError: vi.fn(),
      },
    },
    ...overrides,
  };
}

describe('cli/path', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.SHELL = '/bin/bash';
    process.env.PATH = ['C:/Windows/System32', path.join('/cli/bin'), 'C:/Tools'].join(path.delimiter);
    setPlatform('linux');
  });

  afterEach(() => {
    process.env.SHELL = originalShell;
    process.env.PATH = originalPathEnv;
    setPlatform(originalPlatform);
  });

  it('renders Unix install instructions using the active shell rc file', () => {
    process.env.SHELL = '/bin/zsh';
    const ctx = makeContext();

    const instructions = ctx.getInstallInstructions('/cli/bin');

    expect(instructions.automatic).toContain('~/.zshrc');
    expect(instructions.command).toContain('source ~/.zshrc');
  });

  it('prepends the CLI export line when adding to a Unix shell rc file', async () => {
    const ctx = makeContext();
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readFile').mockResolvedValue('export PATH="/usr/local/bin:$PATH"\n');
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await ctx.addToUnixPath('/cli/bin');

    expect(result).toEqual(expect.objectContaining({ success: true, message: 'Added to .bashrc' }));
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('/home/tester', '.bashrc'),
      'export PATH="/cli/bin:$PATH"  # DevBox Pro CLI\nexport PATH="/usr/local/bin:$PATH"\n',
      'utf8'
    );
  });

  it('returns early when the Unix rc file is already configured', async () => {
    const ctx = makeContext();
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readFile').mockResolvedValue('export PATH="/cli/bin:$PATH"  # DevBox Pro CLI\n');
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await ctx.addToUnixPath('/cli/bin');

    expect(result).toEqual(expect.objectContaining({ success: true, message: 'Already in PATH' }));
    expect(writeFileSpy).not.toHaveBeenCalled();
  });

  it('removes the DevBox CLI marker line from a Unix rc file', async () => {
    const ctx = makeContext();
    vi.spyOn(os, 'homedir').mockReturnValue('/home/tester');
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readFile').mockResolvedValue(
      'export PATH="/cli/bin:$PATH"  # DevBox Pro CLI\nexport PATH="/usr/local/bin:$PATH"\n'
    );
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    const result = await ctx.removeFromUnixPath('/cli/bin');

    expect(result).toEqual(expect.objectContaining({ success: true, message: 'Removed from .bashrc' }));
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('/home/tester', '.bashrc'),
      'export PATH="/usr/local/bin:$PATH"\n',
      'utf8'
    );
  });

  it('reports install state using the process PATH on non-Windows platforms', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);

    const result = await ctx.checkCliInstalled();

    expect(result).toEqual(expect.objectContaining({
      alias: 'dvp',
      installed: true,
      inPath: true,
      scriptPath: path.join('/cli/bin', 'dvp'),
    }));
  });

  it('delegates Windows PATH installation and reports which scope won priority', async () => {
    setPlatform('win32');
    const ctx = makeContext({
      getCliPath: vi.fn(() => 'C:/DevBox/cli/'),
      tryAddToSystemPath: vi.fn(async () => ({ success: false, reason: 'uac_cancelled' })),
      addToUserPath: vi.fn(async () => ({ success: true, message: 'Added to User PATH' })),
    });

    const result = await ctx.addToPath();

    expect(ctx.tryAddToSystemPath).toHaveBeenCalledWith('C:/DevBox/cli');
    expect(ctx.addToUserPath).toHaveBeenCalledWith('C:/DevBox/cli');
    expect(result).toEqual(expect.objectContaining({
      success: true,
      message: 'Added to User PATH (at the beginning for priority)',
    }));
  });
});