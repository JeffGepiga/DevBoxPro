import { describe, it, expect, vi, afterEach } from 'vitest';

require('../../../helpers/mockElectronCjs');
const operations = require('../../../../src/main/services/database/operations');

function makeContext({ dbType = 'mysql', dbVersion = '8.4', settings = {}, running = true } = {}) {
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
    getActiveDatabaseVersion: vi.fn(() => dbVersion),
    isServiceRunning: vi.fn(() => running),
    ensureServiceRunning: vi.fn(async () => running),
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
    vi.useRealTimers();
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

  it('uses recovered service state before trying to start MySQL again', async () => {
    const context = makeContext({ running: false });
    context.ensureServiceRunning
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    context.runDbQuery = vi.fn().mockResolvedValue([]);

    await expect(operations.createDatabase.call(context, 'app_db')).resolves.toEqual({
      success: true,
      name: 'app_db',
    });

    expect(context.managers.service.startService).toHaveBeenCalledWith('mysql', '8.4');
    expect(context.ensureServiceRunning).toHaveBeenCalledWith('mysql', '8.4');
  });

  it('uses recovered service state before trying to start MariaDB again', async () => {
    const context = makeContext({ dbType: 'mariadb', dbVersion: '11.4', running: false });
    context.ensureServiceRunning
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    context.runDbQuery = vi.fn().mockResolvedValue([]);

    await expect(operations.createDatabase.call(context, 'app_db')).resolves.toEqual({
      success: true,
      name: 'app_db',
    });

    expect(context.managers.service.startService).toHaveBeenCalledWith('mariadb', '11.4');
    expect(context.ensureServiceRunning).toHaveBeenCalledWith('mariadb', '11.4');
  });

  it('returns an empty list on connection errors while listing databases', async () => {
    const context = makeContext();
    context.runDbQuery = vi.fn().mockRejectedValue(new Error("Can't connect to MySQL server"));

    await expect(operations.listDatabases.call(context)).resolves.toEqual([]);
  });

  it('returns PostgreSQL databases when the query succeeds', async () => {
    const context = makeContext({ dbType: 'postgresql' });
    context._runPostgresQuery.mockResolvedValue([
      ['postgres'],
      ['analytics'],
    ]);

    await expect(operations.listDatabases.call(context)).resolves.toEqual([
      { name: 'postgres', isSystem: true },
      { name: 'analytics', isSystem: false },
    ]);
  });

  it('returns an empty list on PostgreSQL startup-transient errors', async () => {
    const context = makeContext({ dbType: 'postgresql' });
    context._runPostgresQuery.mockRejectedValue(
      new Error('PostgreSQL query failed: psql: error: connection to server at "127.0.0.1", port 5432 failed: FATAL: the database system is starting up')
    );

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