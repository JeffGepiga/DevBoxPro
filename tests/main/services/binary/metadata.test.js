import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const metadataMixin = require('../../../../src/main/services/binary/metadata');

function makeContext(overrides = {}) {
  return {
    resourcesPath: '/resources',
    managers: {
      log: {
        systemWarn: vi.fn(),
      },
    },
    ...metadataMixin,
    ...overrides,
  };
}

describe('binary/metadata', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes version metadata for supported latest-style services', async () => {
    const ctx = makeContext();
    const ensureDirSpy = vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    const writeFileSpy = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.saveServiceMetadata('composer', { etag: 'etag-1' });

    expect(ensureDirSpy).toHaveBeenCalledWith(path.join('/resources', 'composer'));
    expect(writeFileSpy).toHaveBeenCalledWith(
      path.join('/resources', 'composer', '.version-info.json'),
      expect.stringContaining('"etag": "etag-1"')
    );
  });

  it('returns parsed local metadata when the version info file exists', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readFile').mockResolvedValue('{"etag":"etag-2"}');

    const result = await ctx.getLocalServiceMetadata('phpmyadmin');

    expect(result).toEqual({ etag: 'etag-2' });
  });

  it('follows redirect responses when probing remote metadata', async () => {
    const ctx = makeContext();
    const requestMock = vi.spyOn(https, 'request').mockImplementationOnce((parsedUrl, options, callback) => {
      callback({
        statusCode: 302,
        headers: {
          location: 'https://example.com/final',
        },
      });
      return { on: vi.fn(), end: vi.fn() };
    }).mockImplementationOnce((parsedUrl, options, callback) => {
      callback({
        statusCode: 200,
        headers: {
          'last-modified': 'Fri, 20 Mar 2026 00:00:00 GMT',
          etag: 'etag-3',
        },
      });
      return { on: vi.fn(), end: vi.fn() };
    });

    const result = await ctx.fetchRemoteMetadata('https://example.com/original');

    expect(result).toEqual({
      lastModified: 'Fri, 20 Mar 2026 00:00:00 GMT',
      etag: 'etag-3',
    });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });
});