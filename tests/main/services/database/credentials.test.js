import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'path';

require('../../../helpers/mockElectronCjs');
const fs = require('fs-extra');
const credentials = require('../../../../src/main/services/database/credentials');

function makeContext() {
  const settings = {};
  return {
    configStore: {
      getDataPath: vi.fn(() => '/data'),
      setSetting: vi.fn((key, value) => { settings[key] = value; }),
    },
    managers: {
      log: {
        systemInfo: vi.fn(),
        systemWarn: vi.fn(),
      },
      service: {
        serviceConfigs: {
          mysql: { actualPort: 3307 },
        },
      },
    },
    dbConfig: {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
    },
    getActiveDatabaseType: vi.fn(() => 'mysql'),
    getDbClientPath: vi.fn(() => 'C:/resources/mysql.exe'),
    ensureDbBinaryRuntime: vi.fn().mockResolvedValue(undefined),
    buildBinarySpawnOptions: vi.fn((binaryPath, extraOptions) => ({ binaryPath, ...extraOptions })),
  };
}

describe('database/credentials', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('updates configStore settings and local dbConfig when resetting credentials', async () => {
    const context = makeContext();

    const result = await credentials.resetCredentials.call(context, 'admin', 'secret');

    expect(result).toEqual({ success: true });
    expect(context.configStore.setSetting).toHaveBeenCalledWith('dbUser', 'admin');
    expect(context.configStore.setSetting).toHaveBeenCalledWith('dbPassword', 'secret');
    expect(context.dbConfig.user).toBe('admin');
    expect(context.dbConfig.password).toBe('secret');
  });

  it('writes a sanitized credential reset init file', async () => {
    vi.useFakeTimers();
    const context = makeContext();
    const ensureDir = vi.spyOn(fs, 'ensureDir').mockResolvedValue(undefined);
    const writeFile = vi.spyOn(fs, 'writeFile').mockResolvedValue(undefined);
    vi.spyOn(fs, 'chmod').mockResolvedValue(undefined);
    vi.spyOn(fs, 'pathExists').mockResolvedValue(false);

    const filePath = await credentials.createCredentialResetInitFile.call(context, "admin user", "p'ass\\word");

    expect(filePath).toBe(path.join('/data', 'mysql', 'credential_reset.sql'));
    expect(ensureDir).toHaveBeenCalledWith(path.join('/data', 'mysql'));
    expect(writeFile).toHaveBeenCalledWith(
      path.join('/data', 'mysql', 'credential_reset.sql'),
      expect.stringContaining("CREATE USER IF NOT EXISTS 'admin_user'@'localhost' IDENTIFIED BY 'p''ass\\\\word';"),
      'utf8'
    );

    await vi.advanceTimersByTimeAsync(60000);
  });

  it('throws when the MySQL client binary is missing for no-auth queries', async () => {
    const context = makeContext();
    vi.spyOn(fs, 'existsSync').mockReturnValue(false);

    await expect(credentials.runDbQueryNoAuth.call(context, 'SHOW DATABASES')).rejects.toThrow(
      'MySQL client not found at C:/resources/mysql.exe. Please install the database binary.'
    );
  });
});