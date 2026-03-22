import { beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const binaryCatalog = require('../../../../src/main/services/binary/catalog');

function makeContext(overrides = {}) {
  return {
    ...binaryCatalog,
    resourcesPath: '/resources',
    downloads: {
      php: {
        '8.3': { label: 'PHP 8.3', win: { url: 'php.zip', filename: 'php.zip' } },
      },
      mysql: {
        '8.4': { label: 'MySQL 8.4', defaultPort: 3306, win: { url: 'mysql.zip', filename: 'mysql.zip' } },
      },
      mariadb: {},
      redis: {},
      mailpit: { win: { url: 'mailpit.zip', filename: 'mailpit.zip' } },
      phpmyadmin: { all: { url: 'pma.zip', filename: 'pma.zip' } },
      nginx: {},
      apache: {},
      nodejs: {},
      composer: { all: { url: 'composer.phar', filename: 'composer.phar' } },
      python: {},
    },
    versionMeta: {
      php: ['8.3'],
      mysql: ['8.4'],
    },
    managers: {
      log: { systemWarn: vi.fn() },
      project: { stopProject: vi.fn().mockResolvedValue(undefined) },
      service: { stopService: vi.fn().mockResolvedValue(undefined), runningVersions: new Map() },
    },
    getPlatform: vi.fn(() => 'win'),
    getRunningConflicts: vi.fn().mockResolvedValue({ hasConflicts: false, items: [] }),
    assertBinaryFolderDeletable: vi.fn().mockResolvedValue(undefined),
    getLocalServiceMetadata: vi.fn(),
    fetchRemoteMetadata: vi.fn(),
    ...overrides,
  };
}

describe('binary/catalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds download URLs with labels and default ports', () => {
    const ctx = makeContext();

    expect(ctx.getDownloadUrls()).toEqual(expect.objectContaining({
      php: {
        '8.3': { url: 'php.zip', filename: 'php.zip', label: 'PHP 8.3' },
      },
      mysql: {
        '8.4': { url: 'mysql.zip', filename: 'mysql.zip', label: 'MySQL 8.4', defaultPort: 3306 },
      },
      mailpit: { url: 'mailpit.zip', filename: 'mailpit.zip' },
      phpmyadmin: { url: 'pma.zip', filename: 'pma.zip' },
    }));
  });

  it('removes a versioned binary from the correct platform path', async () => {
    const ctx = makeContext();
    const removeSpy = vi.spyOn(fs, 'remove').mockResolvedValue(undefined);

    const result = await ctx.removeBinary('mysql', '8.4');

    expect(result).toEqual({ success: true });
    expect(ctx.assertBinaryFolderDeletable).toHaveBeenCalledWith(path.join('/resources', 'mysql', '8.4', 'win'), 'mysql', '8.4');
    expect(removeSpy).toHaveBeenCalledWith(path.join('/resources', 'mysql', '8.4', 'win'));
  });

  it('maps locked-file delete failures to a binary-in-use error after the delete starts', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'remove').mockRejectedValue(Object.assign(new Error('EPERM: operation not permitted, unlink libssh2.dll'), { code: 'EPERM' }));

    await expect(ctx.removeBinary('php', '8.3')).rejects.toMatchObject({
      code: 'BINARY_FILES_IN_USE',
      message: expect.stringContaining('Stop the project or service using this binary'),
      originalError: 'EPERM: operation not permitted, unlink libssh2.dll',
    });

    expect(ctx.assertBinaryFolderDeletable).toHaveBeenCalledWith(path.join('/resources', 'php', '8.3', 'win'), 'php', '8.3');
  });

  it('flags update availability for latest services when remote metadata changes', async () => {
    const ctx = makeContext({
      getLocalServiceMetadata: vi.fn((serviceName) => {
        if (serviceName === 'composer') {
          return Promise.resolve({ lastModified: 'old-1' });
        }

        if (serviceName === 'phpmyadmin') {
          return Promise.resolve({ lastModified: 'same' });
        }

        return Promise.resolve(null);
      }),
      fetchRemoteMetadata: vi.fn((url) => {
        if (url === 'composer.phar') {
          return Promise.resolve({ lastModified: 'new-1' });
        }

        return Promise.resolve({ lastModified: 'same' });
      }),
    });

    const result = await ctx.checkForServiceUpdates();

    expect(result.composer.updateAvailable).toBe(true);
    expect(result.phpmyadmin.updateAvailable).toBe(false);
  });
});