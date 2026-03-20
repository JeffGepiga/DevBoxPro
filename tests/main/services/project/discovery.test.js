import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const discovery = require('../../../../src/main/services/project/discovery');

function makeContext(overrides = {}) {
  return {
    configStore: {
      get: vi.fn((key) => {
        if (key === 'settings') return { defaultProjectsPath: '/projects', defaultTld: 'test', webServer: 'nginx' };
        if (key === 'projects') return [];
        return undefined;
      }),
      set: vi.fn(),
    },
    managers: {
      log: {
        systemError: vi.fn(),
        systemWarn: vi.fn(),
      },
      ssl: {
        createCertificate: vi.fn().mockResolvedValue(undefined),
      },
      database: {
        createDatabase: vi.fn().mockResolvedValue(undefined),
      },
    },
    ...discovery,
    getAllProjects: vi.fn(() => []),
    detectProjectType: vi.fn().mockResolvedValue('laravel'),
    findProjectByPath: vi.fn(() => null),
    findProjectByName: vi.fn(() => null),
    getDefaultWebServerVersion: vi.fn(() => '1.28'),
    getDefaultEnvironment: vi.fn((type, name, port) => ({ APP_NAME: name, APP_PORT: String(port), APP_TYPE: type })),
    sanitizeDatabaseName: vi.fn((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '_')),
    createVirtualHost: vi.fn().mockResolvedValue(undefined),
    addToHostsFile: vi.fn().mockResolvedValue(undefined),
    ensureCliInstalled: vi.fn().mockResolvedValue(undefined),
    getResourcesPath: vi.fn(() => '/resources'),
    ...overrides,
  };
}

describe('project/discovery', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns only unregistered PHP-looking projects from the default projects directory', async () => {
    const ctx = makeContext({
      getAllProjects: vi.fn(() => [{ path: path.join('/projects', 'existing-app') }]),
    });

    vi.spyOn(fs, 'pathExists').mockImplementation(async (targetPath) => {
      if (targetPath === '/projects') return true;
      return targetPath.endsWith('composer.json');
    });
    vi.spyOn(fs, 'readdir').mockResolvedValue([
      { name: 'existing-app', isDirectory: () => true },
      { name: 'laravel-app', isDirectory: () => true },
      { name: '.git', isDirectory: () => true },
      { name: 'node_modules', isDirectory: () => true },
      { name: 'notes.txt', isDirectory: () => false },
    ]);

    const result = await ctx.scanUnregisteredProjects();

    expect(result).toEqual([
      {
        name: 'laravel-app',
        path: path.join('/projects', 'laravel-app'),
        type: 'laravel',
      },
    ]);
    expect(ctx.detectProjectType).toHaveBeenCalledWith(path.join('/projects', 'laravel-app'));
  });

  it('detects PHP projects from root php files when standard indicators are missing', async () => {
    const ctx = makeContext();

    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);
    vi.spyOn(fs, 'readdir').mockResolvedValue(['index.php', 'README.md']);

    await expect(ctx.looksLikePhpProject('/projects/plain-php')).resolves.toBe(true);
  });

  it('registers an existing project and persists the imported configuration', async () => {
    const existingProjects = [{ id: 'p-1', name: 'First', path: '/projects/first', port: 8000, sslPort: 443 }];
    const ctx = makeContext({
      configStore: {
        get: vi.fn((key) => {
          if (key === 'settings') return { defaultTld: 'test', webServer: 'nginx', portRangeStart: 8000 };
          if (key === 'projects') return existingProjects;
          return undefined;
        }),
        set: vi.fn(),
      },
      detectProjectType: vi.fn().mockResolvedValue('nodejs'),
      getDefaultEnvironment: vi.fn(() => ({ APP_NAME: 'Imported App' })),
    });

    const result = await ctx.registerExistingProject({
      name: 'Imported App',
      path: '/projects/imported-app',
      services: { mysql: true, nodejs: true },
      nodeStartCommand: 'npm run dev',
      nodePort: 3100,
      ssl: true,
    });

    expect(result.name).toBe('Imported App');
    expect(result.port).toBe(8001);
    expect(result.sslPort).toBe(444);
    expect(result.type).toBe('nodejs');
    expect(result.supervisor.processes).toEqual([
      expect.objectContaining({
        name: 'nodejs-app',
        command: 'npm run dev',
      }),
    ]);
    expect(ctx.managers.database.createDatabase).toHaveBeenCalledWith('imported_app', '8.4');
    expect(ctx.managers.ssl.createCertificate).toHaveBeenCalledWith(['imported-app.test']);
    expect(ctx.createVirtualHost).toHaveBeenCalledWith(expect.objectContaining({ name: 'Imported App' }));
    expect(ctx.addToHostsFile).toHaveBeenCalledWith('imported-app.test');
    expect(ctx.configStore.set).toHaveBeenCalledWith('projects', expect.arrayContaining([
      expect.objectContaining({ name: 'Imported App', path: '/projects/imported-app' }),
    ]));
  });
});
