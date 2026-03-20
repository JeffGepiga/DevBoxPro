import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const catalog = require('../../../../src/main/services/project/catalog');

function makeContext(overrides = {}) {
  return {
    configStore: {
      get: vi.fn((key) => {
        if (key === 'projects') return [];
        return undefined;
      }),
    },
    managers: {
      php: {
        getExtensions: vi.fn().mockResolvedValue({ redis: true, imagick: false }),
      },
      log: {
        project: vi.fn(),
        systemWarn: vi.fn(),
      },
    },
    runningProjects: new Map(),
    ...catalog,
    ...overrides,
  };
}

describe('project/catalog', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('marks returned projects with running state', () => {
    const ctx = makeContext({
      configStore: {
        get: vi.fn(() => [{ id: 'proj-1', name: 'One' }, { id: 'proj-2', name: 'Two' }]),
      },
      runningProjects: new Map([['proj-2', { startedAt: new Date() }]]),
    });

    expect(ctx.getAllProjects()).toEqual([
      { id: 'proj-1', name: 'One', isRunning: false },
      { id: 'proj-2', name: 'Two', isRunning: true },
    ]);
  });

  it('exports project configuration with enabled PHP extensions only', async () => {
    const ctx = makeContext({
      getProject: vi.fn(() => ({
        id: 'proj-1',
        name: 'Exported App',
        path: '/project',
        type: 'laravel',
        phpVersion: '8.3',
        nodeVersion: '20',
        webServer: 'nginx',
        webServerVersion: '1.28',
        services: { mysql: true },
        supervisor: { processes: [] },
      })),
    });
    vi.spyOn(fs, 'writeJson').mockResolvedValue(undefined);

    const result = await ctx.exportProjectConfig('proj-1');

    expect(result).toEqual({ success: true, path: path.join('/project', 'devbox.json') });
    expect(fs.writeJson).toHaveBeenCalledWith(
      path.join('/project', 'devbox.json'),
      expect.objectContaining({
        name: 'Exported App',
        phpExtensions: ['redis'],
      }),
      { spaces: 2 }
    );
  });

  it('detects Symfony projects from composer.json', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => targetPath.endsWith('composer.json'));
    vi.spyOn(fs, 'readJson').mockResolvedValue({ require: { 'symfony/framework-bundle': '^7.0' } });

    await expect(ctx.detectProjectType('/symfony-app')).resolves.toBe('symfony');
  });

  it('merges devbox.json overrides during path detection', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => targetPath.endsWith('devbox.json'));
    vi.spyOn(fs, 'readJson').mockResolvedValue({ name: 'Configured Name', type: 'nodejs', webServer: 'apache' });
    ctx.detectProjectType = vi.fn().mockResolvedValue('custom');

    const result = await ctx.detectProjectTypeFromPath('/projects/app');

    expect(result).toEqual({
      name: 'Configured Name',
      path: '/projects/app',
      type: 'nodejs',
      webServer: 'apache',
      isConfigImport: true,
    });
  });

  it('sanitizes database names consistently', () => {
    const ctx = makeContext();

    expect(ctx.sanitizeDatabaseName('  My App!  ')).toBe('my_app');
  });
});
