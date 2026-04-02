import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = require('fs-extra');
const tar = require('tar');
const nodeFs = require('fs');
const extractionMixin = require('../../../../src/main/services/binary/extraction');

function makeContext(overrides = {}) {
  return {
    activeWorkers: new Map(),
    emitProgress: vi.fn(),
    managers: {
      log: {
        systemError: vi.fn(),
      },
    },
    ...extractionMixin,
    ...overrides,
  };
}

describe('binary/extraction', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts tar archives with a stripped top-level directory', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(tar, 't').mockImplementation(async ({ onentry }) => {
      onentry({ path: 'package/bin/tool.exe', type: 'File' });
    });
    const tarSpy = vi.spyOn(tar, 'x').mockResolvedValue(undefined);

    await ctx.extractArchive('archive.tar.gz', '/dest/path', 'dl-tar');

    expect(tarSpy).toHaveBeenCalledWith({
      file: 'archive.tar.gz',
      cwd: '/dest/path',
      strip: 1,
    });
  });

  it('extracts flat tar archives without stripping entries', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(tar, 't').mockImplementation(async ({ onentry }) => {
      onentry({ path: 'zrok2.exe', type: 'File' });
    });
    const tarSpy = vi.spyOn(tar, 'x').mockResolvedValue(undefined);

    await ctx.extractArchive('archive.tar.gz', '/dest/path', 'dl-flat-tar');

    expect(tarSpy).toHaveBeenCalledWith({
      file: 'archive.tar.gz',
      cwd: '/dest/path',
      strip: 0,
    });
  });

  it('rejects zip archives that are actually HTML responses', async () => {
    const ctx = makeContext({
      validateZipFile: vi.fn().mockResolvedValue(false),
    });
    vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    vi.spyOn(fs, 'readFile').mockResolvedValue('<!doctype html>blocked');

    await expect(ctx.extractArchive('archive.zip', '/dest/path', 'dl-zip')).rejects.toThrow(
      'Downloaded file is HTML instead of ZIP'
    );
  });

  it('recognizes the ZIP file signature from the header bytes', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'open').mockResolvedValue(42);
    vi.spyOn(fs, 'close').mockResolvedValue(undefined);
    vi.spyOn(nodeFs, 'read').mockImplementation((fd, buffer, offset, length, position, callback) => {
      buffer[0] = 0x50;
      buffer[1] = 0x4B;
      buffer[2] = 0x03;
      buffer[3] = 0x04;
      callback(null, 4, buffer);
    });

    const result = await ctx.validateZipFile('/tmp/archive.zip');

    expect(result).toBe(true);
  });
});