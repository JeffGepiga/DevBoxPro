import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');

vi.mock('../../../../src/main/utils/SpawnUtils', () => ({
  spawnAsync: vi.fn(),
  killProcessesByPath: vi.fn(),
}));

const fs = require('fs-extra');
const runtimeTools = require('../../../../src/main/services/binary/runtimeTools');

function makeContext(overrides = {}) {
  return {
    ...runtimeTools,
    resourcesPath: '/resources',
    downloads: {
      nodejs: {
        '20': {
          win: {
            url: 'https://example.com/node-v20.zip',
            filename: 'node-v20.zip',
          },
        },
      },
      composer: {
        all: {
          url: 'https://example.com/composer.phar',
          filename: 'composer.phar',
        },
      },
      git: {
        portable: {
          win: {
            url: 'https://example.com/git.exe',
            filename: 'git.exe',
          },
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
    downloadWithVersionProbe: vi.fn().mockResolvedValue({ downloadPath: '/resources/downloads/node-v20.zip' }),
    downloadFile: vi.fn().mockResolvedValue(undefined),
    checkCancelled: vi.fn().mockResolvedValue(undefined),
    extractArchive: vi.fn().mockResolvedValue(undefined),
    setupNodejsEnvironment: vi.fn().mockResolvedValue(undefined),
    isNodejsVersionInstalled: vi.fn().mockResolvedValue(true),
    setupComposerEnvironment: vi.fn().mockResolvedValue(undefined),
    fetchRemoteMetadata: vi.fn().mockResolvedValue({ etag: 'composer-etag' }),
    saveServiceMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('binary/runtimeTools', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('downloads Node.js, flattens the extracted directory, and validates the install', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'move').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readdir').mockImplementation(async (targetPath) => {
      if (targetPath === path.join('/resources', 'nodejs', '20', 'win')) {
        return ['node-v20-win-x64'];
      }

      if (targetPath === path.join('/resources', 'nodejs', '20', 'win', 'node-v20-win-x64')) {
        return ['node.exe', 'npm.cmd'];
      }

      return [];
    });

    const result = await ctx.downloadNodejs('20');

    expect(result).toEqual({ success: true, version: '20', path: path.join('/resources', 'nodejs', '20', 'win') });
    expect(ctx.downloadWithVersionProbe).toHaveBeenCalledWith('nodejs', '20', 'nodejs-20', ctx.downloads.nodejs['20'].win);
    expect(fs.move).toHaveBeenCalledWith(
      path.join('/resources', 'nodejs', '20', 'win', 'node-v20-win-x64', 'node.exe'),
      path.join('/resources', 'nodejs', '20', 'win', 'node.exe'),
      { overwrite: true }
    );
    expect(ctx.setupNodejsEnvironment).toHaveBeenCalledWith('20', path.join('/resources', 'nodejs', '20', 'win'));
    expect(ctx.isNodejsVersionInstalled).toHaveBeenCalledWith('20', 'win');
  });

  it('downloads Composer, creates wrappers, and persists metadata', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'copy').mockResolvedValue(undefined);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);

    const result = await ctx.downloadComposer();

    expect(result).toEqual({ success: true, path: path.join('/resources', 'composer') });
    expect(ctx.downloadFile).toHaveBeenCalledWith(
      'https://example.com/composer.phar',
      path.join('/resources', 'downloads', 'composer.phar'),
      'composer',
      { forceIPv4: true }
    );
    expect(fs.copy).toHaveBeenCalledWith(
      path.join('/resources', 'downloads', 'composer.phar'),
      path.join('/resources', 'composer', 'composer.phar')
    );
    expect(ctx.setupComposerEnvironment).toHaveBeenCalledWith(path.join('/resources', 'composer'));
    expect(ctx.saveServiceMetadata).toHaveBeenCalledWith('composer', { etag: 'composer-etag' });
  });

  it('fails early when the requested PHP version is not installed for Composer', async () => {
    const ctx = makeContext();
    const onOutput = vi.fn();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);

    await expect(ctx.runComposer('/project', 'install --no-dev', '8.3', onOutput)).rejects.toThrow(
      'PHP 8.3 is not installed. Please download it from the Binary Manager.'
    );

    expect(onOutput).toHaveBeenCalledWith(
      'PHP 8.3 is not installed. Please download it from the Binary Manager.',
      'error'
    );
  });

  it('returns guidance instead of downloading Git on macOS', async () => {
    const ctx = makeContext({
      getPlatform: vi.fn(() => 'mac'),
    });

    const result = await ctx.downloadGit();

    expect(result).toEqual({
      success: false,
      error: 'Git on macOS should be installed via: xcode-select --install or brew install git',
    });
    expect(ctx.downloadFile).not.toHaveBeenCalled();
  });

  it('builds Node.js helper paths for the selected platform', () => {
    const ctx = makeContext();

    expect(ctx.getNodejsPath('20')).toBe(path.join('/resources', 'nodejs', '20', 'win', 'node.exe'));
    expect(ctx.getNpmPath('20')).toBe(path.join('/resources', 'nodejs', '20', 'win', 'npm.cmd'));
    expect(ctx.getComposerPath()).toBe(path.join('/resources', 'composer', 'composer.phar'));
  });
});