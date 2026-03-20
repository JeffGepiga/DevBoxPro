import { describe, it, expect, vi, afterEach } from 'vitest';

require('../../../helpers/mockElectronCjs');
const operations = require('../../../../src/main/services/database/operations');

function makeContext({ dbType = 'mysql', settings = {}, running = true } = {}) {
  const context = {
    dbConfig: {
      host: '127.0.0.1',
      user: 'root',
      password: '',
    },
    managers: {
      log: {
        systemInfo: vi.fn(),
        systemError: vi.fn(),
      },
      service: {
        startService: vi.fn().mockResolvedValue(undefined),
      },
    },
    configStore: {
      get: vi.fn((key, def) => key === 'settings' ? settings : def),
    },
    getActiveDatabaseType: vi.fn(() => dbType),
    getActiveDatabaseVersion: vi.fn(() => '8.4'),
    isServiceRunning: vi.fn(() => running),
    sanitizeName: vi.fn((value) => String(value).trim().replace(/[^a-zA-Z0-9_]/g, '_') || 'unnamed'),
    _runPostgresQuery: vi.fn(),
    _runMongoQuery: vi.fn(),
    runDbQuery: vi.fn(),
    getDbClientPath: vi.fn(() => 'C:/resources/mysql.exe'),
    getActualPort: vi.fn(() => 3306),
    ensureDbBinaryRuntime: vi.fn().mockResolvedValue(undefined),
    buildBinarySpawnOptions: vi.fn((binaryPath, extraOptions) => ({ binaryPath, ...extraOptions })),
  };

  context.runDbQuery = operations.runDbQuery.bind(context);
  return context;
}

describe('database/operations', () => {
  const originalPlaywright = process.env.PLAYWRIGHT_TEST;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlaywright === undefined) {
      delete process.env.PLAYWRIGHT_TEST;
    } else {
      process.env.PLAYWRIGHT_TEST = originalPlaywright;
    }
  });

  it('returns an empty list when the service is not running', async () => {
    const context = makeContext({ running: false });

    await expect(operations.listDatabases.call(context)).resolves.toEqual([]);
  });

  it('returns an empty list on connection errors while listing databases', async () => {
    const context = makeContext();
    context.runDbQuery = vi.fn().mockRejectedValue(new Error("Can't connect to MySQL server"));

    await expect(operations.listDatabases.call(context)).resolves.toEqual([]);
  });

  it('tracks mocked MySQL databases in Playwright mode', async () => {
    process.env.PLAYWRIGHT_TEST = 'true';
    const context = makeContext();

    await operations.runDbQuery.call(context, 'CREATE DATABASE IF NOT EXISTS `appdb`');
    const rows = await operations.runDbQuery.call(context, 'SHOW DATABASES');
    await operations.runDbQuery.call(context, 'DROP DATABASE IF EXISTS `appdb`');
    const rowsAfterDrop = await operations.runDbQuery.call(context, 'SHOW DATABASES');

    expect(rows).toContainEqual({ Database: 'appdb' });
    expect(rowsAfterDrop).not.toContainEqual({ Database: 'appdb' });
  });

  it('maps MongoDB collection keys into a synthetic structure response', async () => {
    const context = makeContext({ dbType: 'mongodb' });
    context._runMongoQuery.mockResolvedValue(['["_id","email"]']);

    const result = await operations.getTableStructure.call(context, 'analytics', 'users');

    expect(result).toEqual([
      ['_id', 'mixed', 'YES', null],
      ['email', 'mixed', 'YES', null],
    ]);
  });

  it('parses PostgreSQL database size results as integers', async () => {
    const context = makeContext({ dbType: 'postgresql' });
    context._runPostgresQuery.mockResolvedValue([['2048']]);

    await expect(operations.getDatabaseSize.call(context, 'analytics')).resolves.toBe(2048);
  });
});