import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const {
  bumpPatchVersion,
  verifyUrl,
  updatePhp,
  updateNodejs,
  updateMariaDb,
} = require('../../../../scripts/update-binaries');

describe('scripts/update-binaries', () => {
  describe('bumpPatchVersion', () => {
    it('increments patch version correctly', () => {
      expect(bumpPatchVersion('1.1.4')).toBe('1.1.5');
      expect(bumpPatchVersion('2.0.0')).toBe('2.0.1');
      expect(bumpPatchVersion('1.2')).toBe('1.2.1');
      expect(bumpPatchVersion(null)).toBe('1.0.1');
    });
  });

  describe('verifyUrl', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('returns false for non-string or non-http URLs', async () => {
      expect(await verifyUrl(null)).toBe(false);
      expect(await verifyUrl('')).toBe(false);
      expect(await verifyUrl('ftp://example.com')).toBe(false);
      expect(await verifyUrl('builtin')).toBe(false);
      expect(await verifyUrl('manual')).toBe(false);
    });

    it('returns true when HEAD request succeeds with 200', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        status: 200,
        ok: true,
      });

      const result = await verifyUrl('https://example.com/test.zip');
      expect(result).toBe(true);
    });

    it('falls back to GET range when HEAD returns 405 Method Not Allowed', async () => {
      vi.spyOn(global, 'fetch')
        .mockResolvedValueOnce({ status: 405, ok: false })
        .mockResolvedValueOnce({ status: 206, ok: true });

      const result = await verifyUrl('https://example.com/test.zip');
      expect(result).toBe(true);
    });

    it('returns false when network throws', async () => {
      vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Connection refused'));
      const result = await verifyUrl('https://example.com/test.zip');
      expect(result).toBe(false);
    });
  });

  describe('updateNodejs', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('updates Node.js downloads when a newer version is present', async () => {
      const mockConfig = {
        nodejs: {
          downloads: {
            '22': {
              win: { url: 'https://nodejs.org/dist/v22.0.0/node-v22.0.0-win-x64.zip', filename: 'node-v22.0.0-win-x64.zip' },
              mac: { url: 'https://nodejs.org/dist/v22.0.0/node-v22.0.0-darwin-arm64.tar.gz', filename: 'node-v22.0.0-darwin-arm64.tar.gz' },
              linux: { url: 'https://nodejs.org/dist/v22.0.0/node-v22.0.0-linux-x64.tar.gz', filename: 'node-v22.0.0-linux-x64.tar.gz' },
            },
          },
        },
      };

      const mockIndex = [
        { version: 'v22.23.4', files: ['win-x64-zip', 'osx-arm64-tar', 'linux-x64'] },
      ];

      vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (typeof url === 'string' && url.includes('dist/index.json')) {
          return { ok: true, json: async () => mockIndex };
        }
        return { status: 200, ok: true };
      });

      const changes = [];
      await updateNodejs(mockConfig, changes);

      expect(changes.length).toBe(1);
      expect(changes[0]).toMatchObject({
        service: 'nodejs',
        version: '22',
        platform: 'win',
        from: 'node-v22.0.0-win-x64.zip',
        to: 'node-v22.23.4-win-x64.zip',
      });
      expect(mockConfig.nodejs.downloads['22'].win.filename).toBe('node-v22.23.4-win-x64.zip');
      expect(mockConfig.nodejs.downloads['22'].win.url).toBe('https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip');
    });
  });

  describe('updateMariaDb', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    it('updates MariaDB downloads when newer release is found', async () => {
      const mockConfig = {
        mariadb: {
          downloads: {
            '11.4': {
              win: { url: 'https://archive.mariadb.org/mariadb-11.4.1/winx64-packages/mariadb-11.4.1-winx64.zip', filename: 'mariadb-11.4.1-winx64.zip' },
              linux: { url: 'https://archive.mariadb.org/mariadb-11.4.1/bintar-linux-systemd-x86_64/mariadb-11.4.1-linux-systemd-x86_64.tar.gz', filename: 'mariadb-11.4.1-linux-systemd-x86_64.tar.gz' },
            },
          },
        },
      };

      vi.spyOn(global, 'fetch').mockImplementation(async (url) => {
        if (typeof url === 'string' && url.includes('rest-api/mariadb/11.4')) {
          return { ok: true, json: async () => ({ releases: { '11.4.13': {} } }) };
        }
        return { status: 200, ok: true };
      });

      const changes = [];
      await updateMariaDb(mockConfig, changes);

      expect(changes.length).toBe(1);
      expect(changes[0].to).toBe('mariadb-11.4.13-winx64.zip');
      expect(mockConfig.mariadb.downloads['11.4'].win.filename).toBe('mariadb-11.4.13-winx64.zip');
      expect(mockConfig.mariadb.downloads['11.4'].linux.filename).toBe('mariadb-11.4.13-linux-systemd-x86_64.tar.gz');
    });
  });
});

