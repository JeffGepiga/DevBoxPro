import { describe, it, expect, vi, afterEach } from 'vitest';

require('../../../helpers/mockElectronCjs');
const fs = require('fs-extra');
const postgres = require('../../../../src/main/services/database/postgres');

function makeContext(settings = {}) {
  return {
    configStore: {
      get: vi.fn((key, def) => key === 'settings' ? settings : def),
    },
    dbConfig: {
      host: '127.0.0.1',
      password: 'fallback-secret',
    },
    getDbClientPath: vi.fn(() => 'C:/resources/psql.exe'),
    getActualPort: vi.fn(() => 5432),
    _buildPgEnv: postgres._buildPgEnv,
  };
}

describe('database/postgres', () => {
  const originalPlaywright = process.env.PLAYWRIGHT_TEST;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalPlaywright === undefined) {
      delete process.env.PLAYWRIGHT_TEST;
    } else {
      process.env.PLAYWRIGHT_TEST = originalPlaywright;
    }
  });

  it('prefers pgPassword over generic dbPassword in the postgres env', () => {
    const context = makeContext({ pgPassword: 'pg-secret', dbPassword: 'db-secret' });

    const env = postgres._buildPgEnv.call(context);

    expect(env.PGPASSWORD).toBe('pg-secret');
  });

  it('tracks mocked databases in Playwright mode', async () => {
    process.env.PLAYWRIGHT_TEST = 'true';
    const context = makeContext();

    await postgres._runPostgresQuery.call(context, 'CREATE DATABASE "appdb"');
    const rows = await postgres._runPostgresQuery.call(context, 'SELECT datname FROM pg_database');
    await postgres._runPostgresQuery.call(context, 'DROP DATABASE IF EXISTS "appdb"');
    const rowsAfterDrop = await postgres._runPostgresQuery.call(context, 'SELECT datname FROM pg_database');

    expect(rows).toContainEqual(['appdb']);
    expect(rowsAfterDrop).not.toContainEqual(['appdb']);
  });

  it('rejects when the postgres client binary is missing', async () => {
    process.env.PLAYWRIGHT_TEST = 'false';
    const context = makeContext();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await expect(postgres._runPostgresQuery.call(context, 'SELECT 1')).rejects.toThrow(
      'psql not found at C:/resources/psql.exe. Please install the PostgreSQL binary from the Binaries page.'
    );
  });
});