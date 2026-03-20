import { beforeEach, describe, expect, it, vi } from 'vitest';

const fs = require('fs-extra');
const downloadMixin = require('../../../../src/main/services/binary/download');

function makeContext(overrides = {}) {
  return {
    resourcesPath: '/resources',
    downloads: {
      php: {
        '8.3': {
          win: {
            url: 'https://windows.php.net/downloads/releases/php-8.3.30-nts-Win32-vs16-x64.zip',
            filename: 'php-8.3.30-nts-Win32-vs16-x64.zip',
          },
        },
      },
    },
    activeDownloads: new Map(),
    activeWorkers: new Map(),
    cancelledDownloads: new Set(),
    downloadProgress: new Map(),
    lastProgressEmit: new Map(),
    managers: {
      log: {
        systemError: vi.fn(),
        systemWarn: vi.fn(),
      },
    },
    getPlatform: vi.fn(() => 'win'),
    emitProgress: vi.fn(),
    ...downloadMixin,
    ...overrides,
  };
}

describe('binary/download', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds forward then backward patch candidates from the configured asset', () => {
    const ctx = makeContext();

    const candidates = ctx.buildPatchFallbackCandidates({
      url: 'https://windows.php.net/downloads/releases/php-8.3.30-nts-Win32-vs16-x64.zip',
      filename: 'php-8.3.30-nts-Win32-vs16-x64.zip',
    });

    expect(candidates.slice(0, 6).map((candidate) => candidate.resolvedVersion)).toEqual([
      '8.3.31',
      '8.3.32',
      '8.3.33',
      '8.3.34',
      '8.3.35',
      '8.3.29',
    ]);
  });

  it('retries alternate patch assets and persists the recovered URL', async () => {
    const ctx = makeContext();
    const removeSpy = vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    const downloadSpy = vi.spyOn(ctx, 'downloadFile').mockImplementation(async (url, destPath) => {
      if (url.includes('8.3.30') || url.includes('8.3.31') || url.includes('8.3.32') || url.includes('8.3.33') || url.includes('8.3.34') || url.includes('8.3.35')) {
        throw new Error('Download failed with status 404');
      }

      return destPath;
    });

    const result = await ctx.downloadWithVersionProbe('php', '8.3', 'php-8.3', {
      url: 'https://windows.php.net/downloads/releases/php-8.3.30-nts-Win32-vs16-x64.zip',
      filename: 'php-8.3.30-nts-Win32-vs16-x64.zip',
    });

    expect(result.downloadInfo.url).toContain('8.3.29');
    expect(downloadSpy.mock.calls.map((call) => call[0]).slice(0, 7)).toEqual([
      'https://windows.php.net/downloads/releases/php-8.3.30-nts-Win32-vs16-x64.zip',
      'https://windows.php.net/downloads/releases/php-8.3.31-nts-Win32-vs16-x64.zip',
      'https://windows.php.net/downloads/releases/php-8.3.32-nts-Win32-vs16-x64.zip',
      'https://windows.php.net/downloads/releases/php-8.3.33-nts-Win32-vs16-x64.zip',
      'https://windows.php.net/downloads/releases/php-8.3.34-nts-Win32-vs16-x64.zip',
      'https://windows.php.net/downloads/releases/php-8.3.35-nts-Win32-vs16-x64.zip',
      'https://windows.php.net/downloads/releases/php-8.3.29-nts-Win32-vs16-x64.zip',
    ]);
    expect(ctx.downloads.php['8.3'].win.url).toContain('8.3.29');
    expect(removeSpy).toHaveBeenCalledTimes(6);
    expect(ctx.managers.log.systemWarn).toHaveBeenCalledWith(
      'Recovered php 8.3 download using alternate patch asset',
      expect.objectContaining({
        resolvedUrl: expect.stringContaining('8.3.29'),
      })
    );
  });

  it('cancels active downloads and extraction workers', () => {
    const ctx = makeContext();
    const request = { destroy: vi.fn() };
    const file = { close: vi.fn() };
    const worker = { terminate: vi.fn() };

    ctx.activeDownloads.set('dl-1', {
      request,
      file,
      destPath: '/tmp/download.zip',
    });
    ctx.activeWorkers.set('dl-1', {
      worker,
      destPath: '/tmp/extracted',
    });
    ctx.downloadProgress.set('dl-1', { status: 'downloading' });
    ctx.lastProgressEmit.set('dl-1', { time: 1, progress: 50 });

    const unlinkSpy = vi.spyOn(fs, 'unlink').mockImplementation((targetPath, callback) => callback());
    const removeSpy = vi.spyOn(fs, 'remove').mockImplementation((targetPath, callback) => {
      if (typeof callback === 'function') {
        callback();
      }
      return Promise.resolve();
    });

    const cancelled = ctx.cancelDownload('dl-1');

    expect(cancelled).toBe(true);
    expect(request.destroy).toHaveBeenCalled();
    expect(file.close).toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalled();
    expect(unlinkSpy).toHaveBeenCalledWith('/tmp/download.zip', expect.any(Function));
    expect(removeSpy).toHaveBeenCalledWith('/tmp/extracted', expect.any(Function));
    expect(ctx.cancelledDownloads.has('dl-1')).toBe(true);
    expect(ctx.downloadProgress.has('dl-1')).toBe(false);
    expect(ctx.lastProgressEmit.has('dl-1')).toBe(false);
    expect(ctx.emitProgress).toHaveBeenCalledWith('dl-1', { status: 'cancelled', progress: 0 }, true);
  });

  it('cleans up the partial file and throws a cancelled error', async () => {
    const ctx = makeContext();
    const removeSpy = vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
    ctx.cancelledDownloads.add('dl-2');

    await expect(ctx.checkCancelled('dl-2', '/tmp/download.zip')).rejects.toMatchObject({
      message: 'Download cancelled',
      cancelled: true,
    });

    expect(removeSpy).toHaveBeenCalledWith('/tmp/download.zip');
    expect(ctx.cancelledDownloads.has('dl-2')).toBe(false);
  });
});