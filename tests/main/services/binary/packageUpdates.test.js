import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const path = require('path');
const fs = require('fs-extra');
const packageUpdates = require('../../../../src/main/services/binary/packageUpdates');

function makeContext(overrides = {}) {
  return {
    resourcesPath: '/resources',
    downloads: {
      nodejs: {
        '20': {
          win: {
            url: 'https://nodejs.org/dist/v20.20.8/node-v20.20.8-win-x64.zip',
            filename: 'node-v20.20.8-win-x64.zip',
          },
        },
      },
      python: {
        '3.12': {
          win: {
            url: 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
            filename: 'python-3.12.10-embed-amd64.zip',
          },
        },
      },
      mysql: {
        '8.4': {
          win: {
            url: 'https://cdn.mysql.com/Downloads/MySQL-8.4/mysql-8.4.8-winx64.zip',
            filename: 'mysql-8.4.8-winx64.zip',
          },
        },
      },
    },
    versionMeta: {
      nodejs: ['20', '22'],
      python: ['3.12', '3.13'],
      mysql: ['8.4', '8.0'],
    },
    managers: {
      log: {
        systemError: vi.fn(),
        systemWarn: vi.fn(),
        info: vi.fn(),
      },
      service: {
        getServiceStatus: vi.fn(() => ({ status: 'stopped' })),
        stop: vi.fn().mockResolvedValue(true),
        start: vi.fn().mockResolvedValue(true),
      },
    },
    getPlatform: vi.fn(() => 'win'),
    emitProgress: vi.fn(),
    downloadFile: vi.fn().mockResolvedValue(undefined),
    checkCancelled: vi.fn().mockResolvedValue(undefined),
    extractArchive: vi.fn().mockResolvedValue(undefined),
    setupNodejsEnvironment: vi.fn().mockResolvedValue(undefined),
    bootstrapPip: vi.fn().mockResolvedValue(undefined),
    isNodejsVersionInstalled: vi.fn().mockResolvedValue(true),
    ...packageUpdates,
    ...overrides,
  };
}

describe('binary/packageUpdates', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SemVer parsing and comparison', () => {
    it('correctly parses SemVer numbers', () => {
      expect(packageUpdates.parseSemVer('20.20.1')).toEqual({ major: 20, minor: 20, patch: 1 });
      expect(packageUpdates.parseSemVer('node-v20.20.8-win-x64.zip')).toEqual({ major: 20, minor: 20, patch: 8 });
      expect(packageUpdates.parseSemVer('Python 3.12.10')).toEqual({ major: 3, minor: 12, patch: 10 });
      expect(packageUpdates.parseSemVer('mysql-8.4.8-winx64.zip')).toEqual({ major: 8, minor: 4, patch: 8 });
    });

    it('correctly compares SemVer versions', () => {
      expect(packageUpdates.compareSemVer('20.20.8', '20.20.1')).toBeGreaterThan(0);
      expect(packageUpdates.compareSemVer('3.12.9', '3.12.10')).toBeLessThan(0);
      expect(packageUpdates.compareSemVer('8.4.0', '8.4.0')).toBe(0);
    });
  });

  describe('Version detection and details', () => {
    it('detects configured version from download filename in binaries.json', () => {
      const ctx = makeContext();
      expect(ctx.getConfiguredPackageVersion('nodejs', '20')).toBe('20.20.8');
      expect(ctx.getConfiguredPackageVersion('python', '3.12')).toBe('3.12.10');
      expect(ctx.getConfiguredPackageVersion('mysql', '8.4')).toBe('8.4.8');
    });

    it('reads installed version from .version-info.json if present', async () => {
      const ctx = makeContext();
      vi.spyOn(fs, 'pathExists').mockImplementation(async (target) => {
        const s = String(target).replace(/\\/g, '/');
        if (s.includes('node.exe') || s.includes('.version-info.json')) return true;
        return false;
      });
      vi.spyOn(fs, 'readJson').mockResolvedValue({ version: '20.20.1' });

      const installed = await ctx.getInstalledPackageVersion('nodejs', '20');
      expect(installed).toBe('20.20.1');
    });

    it('computes package version details and flags available update', async () => {
      const ctx = makeContext({
        getInstalledPackageVersion: vi.fn().mockResolvedValue('20.20.1'),
        isPackageInstalled: vi.fn().mockResolvedValue(true),
      });

      const details = await ctx.getPackageVersionDetails('nodejs', '20');
      expect(details.installed).toBe(true);
      expect(details.installedVersion).toBe('20.20.1');
      expect(details.configuredVersion).toBe('20.20.8');
      expect(details.hasUpdate).toBe(true);
    });
  });

  describe('Modification checking', () => {
    it('detects user-installed npm packages and custom .npmrc for Node.js', async () => {
      const ctx = makeContext();
      vi.spyOn(fs, 'pathExists').mockImplementation(async (target) => {
        const s = String(target).replace(/\\/g, '/');
        if (s.endsWith('nodejs/20/win') || s.endsWith('node_modules') || s.endsWith('.npmrc')) return true;
        return false;
      });
      vi.spyOn(fs, 'readdir').mockImplementation(async (target) => {
        const s = String(target).replace(/\\/g, '/');
        if (s.endsWith('node_modules')) return ['pnpm', 'yarn', 'npm'];
        if (s.endsWith('nodejs/20/win')) return ['pnpm.cmd', 'node.exe'];
        return [];
      });

      const mods = await ctx.checkPackageModifications('nodejs', '20');
      expect(mods.hasModifications).toBe(true);
      expect(mods.customPackages).toContain('pnpm');
      expect(mods.customPackages).toContain('yarn');
      expect(mods.customFiles).toContain('.npmrc');
      expect(mods.customFiles).toContain('pnpm.cmd');
    });

    it('detects pip packages in site-packages and provides data safety notice for MySQL', async () => {
      const ctx = makeContext();
      vi.spyOn(fs, 'pathExists').mockImplementation(async (target) => {
        const s = String(target).replace(/\\/g, '/');
        if (s.endsWith('python/3.12/win') || s.endsWith('site-packages')) return true;
        if (s.endsWith('mysql/8.4/win') || s.endsWith('my.ini')) return true;
        return false;
      });
      vi.spyOn(fs, 'readdir').mockImplementation(async (target) => {
        const s = String(target).replace(/\\/g, '/');
        if (s.endsWith('site-packages')) return ['django', 'requests', 'pip'];
        return [];
      });

      const pyMods = await ctx.checkPackageModifications('python', '3.12');
      expect(pyMods.hasModifications).toBe(true);
      expect(pyMods.customPackages).toContain('django');
      expect(pyMods.customPackages).toContain('requests');

      const myMods = await ctx.checkPackageModifications('mysql', '8.4');
      expect(myMods.hasModifications).toBe(true);
      expect(myMods.customFiles).toContain('my.ini');
      expect(myMods.dataSafeNotice).toContain('AppData/data');
    });
  });

  describe('Safe updating', () => {
    it('safely updates Node.js, preserves user packages, and writes version-info', async () => {
      const ctx = makeContext();
      vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
      vi.spyOn(fs, 'move').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);
      vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
      vi.spyOn(fs, 'readdir').mockResolvedValue(['node.exe', 'npm.cmd']);
      vi.spyOn(ctx, 'checkPackageModifications').mockResolvedValue({
        hasModifications: true,
        reasons: ['pnpm installed'],
        modifiedFiles: ['node_modules'],
        customPackages: ['pnpm'],
        customFiles: [],
      });

      const result = await ctx.updatePackage('nodejs', '20', { preserveModifications: true });
      expect(result.success).toBe(true);
      expect(result.newVersion).toBe('20.20.8');
      expect(ctx.downloadFile).toHaveBeenCalled();
      expect(ctx.extractArchive).toHaveBeenCalled();
      expect(ctx.setupNodejsEnvironment).toHaveBeenCalledWith('20', expect.any(String));
      expect(fs.writeJson).toHaveBeenCalledWith(
        expect.stringContaining('.version-info.json'),
        expect.objectContaining({
          service: 'nodejs',
          version: '20.20.8',
          baseVersion: '20',
          preservedModifications: true,
        }),
        expect.any(Object)
      );
    });

    it('safely stops and restarts MySQL service if running during update', async () => {
      const ctx = makeContext();
      ctx.managers.service.getServiceStatus = vi.fn(() => ({ status: 'running' }));
      vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
      vi.spyOn(fs, 'remove').mockResolvedValue(undefined);
      vi.spyOn(fs, 'move').mockResolvedValue(undefined);
      vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);
      vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
      vi.spyOn(fs, 'readdir').mockResolvedValue(['bin', 'share']);
      vi.spyOn(ctx, 'checkPackageModifications').mockResolvedValue({
        hasModifications: false,
        reasons: [],
        modifiedFiles: [],
        customPackages: [],
        customFiles: [],
      });

      const result = await ctx.updatePackage('mysql', '8.4', { preserveModifications: true });
      expect(result.success).toBe(true);
      expect(ctx.managers.service.stop).toHaveBeenCalledWith('mysql', '8.4');
      expect(ctx.managers.service.start).toHaveBeenCalledWith('mysql', '8.4');
    });
  });
});
