import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

require('../../../helpers/mockElectronCjs');

const fs = require('fs-extra');
const environment = require('../../../../src/main/services/project/environment');
const projectHelpers = require('../../../../src/main/services/project/helpers');

function makeContext(overrides = {}) {
  return {
    configStore: {
      get: vi.fn((key) => {
        if (key === 'projects') return [];
        return undefined;
      }),
      set: vi.fn(),
    },
    compatibilityManager: {
      initialize: vi.fn().mockResolvedValue(undefined),
    },
    managers: {
      cli: {
        checkCliInstalled: vi.fn().mockResolvedValue({ installed: true, inPath: true }),
        installCli: vi.fn().mockResolvedValue(undefined),
        addToPath: vi.fn().mockResolvedValue(undefined),
        syncProjectsFile: vi.fn().mockResolvedValue('/mock/cli/projects.json'),
        getDirectShimsEnabled: vi.fn().mockReturnValue(false),
        installDirectShims: vi.fn().mockResolvedValue(undefined),
      },
      database: {
        getDatabaseInfo: vi.fn().mockReturnValue({ user: 'root', password: '', port: 3306 }),
      },
      log: {
        systemWarn: vi.fn(),
        systemError: vi.fn(),
        systemInfo: vi.fn(),
      },
    },
    getDataPath: vi.fn(() => '/mock/data'),
    getProject: vi.fn(),
    sanitizeDatabaseName: vi.fn((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '_')),
    syncCliProjectsFile: environment.syncCliProjectsFile,
    cleanupOrphanedConfigs: environment.cleanupOrphanedConfigs,
    getProjectDatabaseSelection: projectHelpers.getProjectDatabaseSelection,
    getProjectDatabaseConfig: projectHelpers.getProjectDatabaseConfig,
    ...environment,
    ...overrides,
  };
}

describe('project/environment', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    delete process.env.PLAYWRIGHT_TEST;
  });

  it('initializes compatibility and ensures projects storage exists', async () => {
    const ctx = makeContext({
      configStore: {
        get: vi.fn(() => undefined),
        set: vi.fn(),
      },
      cleanupOrphanedConfigs: vi.fn().mockResolvedValue(undefined),
    });

    await ctx.initialize();

    expect(ctx.configStore.set).toHaveBeenCalledWith('projects', []);
    expect(ctx.compatibilityManager.initialize).toHaveBeenCalled();
    expect(ctx.cleanupOrphanedConfigs).toHaveBeenCalled();
  });

  it('syncs environment values into an existing .env file', async () => {
    const ctx = makeContext();
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readFile').mockResolvedValue('APP_NAME=Old\nAPP_ENV=local\n');
    vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);

    await ctx.syncEnvFile({
      path: '/project',
      environment: {
        APP_NAME: 'NewName',
        DB_PORT: '3306',
      },
    });

    expect(fs.writeFile).toHaveBeenCalledWith(expect.stringContaining('.env'), 'APP_NAME=NewName\nAPP_ENV=local\nDB_PORT=3306\n');
  });

  it('reads multiline quoted values from .env files', async () => {
    const ctx = makeContext({
      getProject: vi.fn(() => ({ id: 'proj-1', path: '/project' })),
    });
    vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
    vi.spyOn(fs, 'readFile').mockResolvedValue('APP_NAME=DevBox\nPRIVATE_KEY="line1\nline2"\nMAIL_FROM=devbox@test\n');

    const result = await ctx.readEnvFile('proj-1');

    expect(result).toEqual({
      APP_NAME: 'DevBox',
      PRIVATE_KEY: 'line1\nline2',
      MAIL_FROM: 'devbox@test',
    });
  });

  it('builds laravel defaults from active database settings', () => {
    const ctx = makeContext();

    const result = ctx.getDefaultEnvironment('laravel', 'My App', 8080);

    expect(result).toMatchObject({
      APP_NAME: 'My App',
      APP_URL: 'http://localhost:8080',
      DB_PORT: '3306',
      DB_DATABASE: 'my_app',
      MAIL_PORT: '1025',
    });
  });

  it('builds laravel defaults from project-selected MariaDB settings', () => {
    const ctx = makeContext({
      managers: {
        database: {
          getDatabaseInfo: vi.fn().mockReturnValue({ type: 'mysql', version: '8.4', user: 'root', password: '', port: 3306 }),
        },
        service: {
          runningVersions: new Map([
            ['mariadb', new Map([['11.4', { port: 3310 }]])],
          ]),
          serviceConfigs: {
            mariadb: { defaultPort: 3310 },
          },
          getVersionPort: vi.fn((serviceName, version, defaultPort) => defaultPort),
        },
        log: {
          systemWarn: vi.fn(),
          systemError: vi.fn(),
          systemInfo: vi.fn(),
        },
      },
    });

    const result = ctx.getDefaultEnvironment('laravel', 'Maria App', 8080, {
      services: {
        mariadb: true,
        mariadbVersion: '11.4',
      },
    });

    expect(result).toMatchObject({
      DB_CONNECTION: 'mysql',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3310',
      DB_DATABASE: 'maria_app',
    });
  });

  it('syncs CLI projects and auto-installs direct shims when enabled', async () => {
    const ctx = makeContext({
      managers: {
        cli: {
          checkCliInstalled: vi.fn().mockResolvedValue({ installed: false, inPath: false }),
          installCli: vi.fn().mockResolvedValue(undefined),
          addToPath: vi.fn().mockResolvedValue(undefined),
          syncProjectsFile: vi.fn().mockResolvedValue('/mock/cli/projects.json'),
          getDirectShimsEnabled: vi.fn().mockReturnValue(true),
          installDirectShims: vi.fn().mockResolvedValue(undefined),
        },
        database: {
          getDatabaseInfo: vi.fn().mockReturnValue({ user: 'root', password: '', port: 3306 }),
        },
        log: {
          systemWarn: vi.fn(),
          systemError: vi.fn(),
          systemInfo: vi.fn(),
        },
      },
    });
    process.env.PLAYWRIGHT_TEST = 'true';

    await ctx.syncCliProjectsFile();

    expect(ctx.managers.cli.syncProjectsFile).toHaveBeenCalled();
    expect(ctx.managers.cli.installCli).toHaveBeenCalled();
    expect(ctx.managers.cli.installDirectShims).toHaveBeenCalled();
    expect(ctx.managers.cli.addToPath).not.toHaveBeenCalled();
  });
});
