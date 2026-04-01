import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const binaryImports = require('../../../../src/main/services/binary/imports');

function makeContext(overrides = {}) {
  return {
    ...binaryImports,
    resourcesPath: '/resources',
    downloads: {
      composer: { all: { url: 'composer.phar' } },
    },
    getPlatform: vi.fn(() => 'win'),
    emitProgress: vi.fn(),
    extractArchive: vi.fn().mockResolvedValue(undefined),
    normalizeExtractedStructure: vi.fn().mockResolvedValue(undefined),
    createPhpMyAdminConfig: vi.fn().mockResolvedValue(undefined),
    validateZipFile: vi.fn().mockResolvedValue(true),
    createPhpIni: vi.fn().mockResolvedValue(undefined),
    createApacheConfig: vi.fn().mockResolvedValue(undefined),
    setupNodejsEnvironment: vi.fn().mockResolvedValue(undefined),
    fetchRemoteMetadata: vi.fn().mockResolvedValue({ etag: 'etag-1' }),
    saveServiceMetadata: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('binary/imports', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('imports phpMyAdmin into the fixed destination and creates config', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    const result = await ctx.importBinary('phpmyadmin', 'latest', '/tmp/phpmyadmin.zip');

    expect(result).toEqual({ success: true, version: 'latest', path: path.join('/resources', 'phpmyadmin') });
    expect(ctx.extractArchive).toHaveBeenCalledWith('/tmp/phpmyadmin.zip', path.join('/resources', 'phpmyadmin'), 'phpmyadmin-latest');
    expect(ctx.createPhpMyAdminConfig).toHaveBeenCalledWith(path.join('/resources', 'phpmyadmin'));
  });

  it('imports Node.js archives, flattens nested node directories, and sets up wrappers', async () => {
    const ctx = makeContext({
      normalizeExtractedStructure: binaryImports.normalizeExtractedStructure,
    });
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'move').mockResolvedValue(undefined);
    vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => false });
    vi.spyOn(fs, 'readdir').mockImplementation(async (targetPath) => {
      if (targetPath === path.join('/resources', 'nodejs', '20', 'win')) {
        return ['node-v20-win-x64'];
      }

      if (targetPath === path.join('/resources', 'nodejs', '20', 'win', 'node-v20-win-x64')) {
        return ['node.exe', 'npm.cmd'];
      }

      return [];
    });

    const result = await ctx.importBinary('nodejs', '20', '/tmp/node.zip');

    expect(result).toEqual({ success: true, version: '20', path: path.join('/resources', 'nodejs', '20', 'win') });
    expect(ctx.setupNodejsEnvironment).toHaveBeenCalledWith('20', path.join('/resources', 'nodejs', '20', 'win'));
  });

  it('normalizes a single nested directory by moving files up one level', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'readdir').mockImplementation(async (targetPath) => {
      if (targetPath === '/extract') {
        return ['nested'];
      }

      if (targetPath === path.join('/extract', 'nested')) {
        return ['file.txt'];
      }

      return [];
    });
    vi.spyOn(fs, 'stat').mockResolvedValue({ isDirectory: () => true });
    vi.spyOn(fs, 'move').mockResolvedValue(undefined);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);

    await binaryImports.normalizeExtractedStructure.call(ctx, 'custom', '/extract');

    expect(fs.move).toHaveBeenCalledWith(path.join('/extract', 'nested', 'file.txt'), path.join('/extract', 'file.txt'), { overwrite: true });
    expect(fs.remove).toHaveBeenCalledWith(path.join('/extract', 'nested'));
  });
  it('sets process.noAsar = true during import and restores it afterward', async () => {
    process.noAsar = false; // Start with it explicitly off.
    let noAsarDuringExtract;

    const ctx = makeContext({
      extractArchive: vi.fn(async () => {
        // Capture the value while the import is running.
        noAsarDuringExtract = process.noAsar;
      }),
    });

    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    await ctx.importBinary('postgresql', '18.3.2', '/tmp/pg.zip');

    // process.noAsar must have been true while extractArchive ran.
    expect(noAsarDuringExtract).toBe(true);
    // process.noAsar must be restored to its original value after the call.
    expect(process.noAsar).toBe(false);
  });

  it('restores process.noAsar even when the import fails', async () => {
    process.noAsar = false;

    const ctx = makeContext({
      extractArchive: vi.fn().mockRejectedValue(new Error('disk full')),
    });

    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    await expect(ctx.importBinary('postgresql', '18.3.2', '/tmp/pg.zip')).rejects.toThrow('disk full');

    // Must be restored even on failure.
    expect(process.noAsar).toBe(false);
  });

  it('calls fs.remove to clean up a corrupted prior extraction before re-importing', async () => {
    const ctx = makeContext();

    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    const removeSpy = vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);

    await ctx.importBinary('postgresql', '18.3.2', '/tmp/pg.zip');

    // The corrupted destination must have been removed before extraction starts.
    const expectedPath = path.join('/resources', 'postgresql', '18.3.2', 'win');
    expect(removeSpy).toHaveBeenCalledWith(expectedPath);
  });
});