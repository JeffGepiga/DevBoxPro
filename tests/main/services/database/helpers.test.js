import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

require('../../../helpers/mockElectronCjs');
const databaseHelpers = require('../../../../src/main/services/database/helpers');

function makeContext({ settings = {}, state = {}, managers = {}, resourcePath = '/resources' } = {}) {
  const settingsMap = { activeDatabaseType: 'mysql', activeDatabaseVersion: '8.4', ...settings };
  const store = { settings: {}, ...state };

  return {
    resourcePath,
    configStore: {
      get: vi.fn((key, def) => key in store ? store[key] : def),
      getDataPath: vi.fn(() => '/data'),
      getSetting: vi.fn((key, def) => key in settingsMap ? settingsMap[key] : def),
      setSetting: vi.fn((key, value) => { settingsMap[key] = value; }),
    },
    managers,
    dbConfig: {
      host: '127.0.0.1',
      port: 3306,
      user: 'root',
      password: '',
    },
    runningOperations: new Map(),
    getActiveDatabaseType: databaseHelpers.getActiveDatabaseType,
    getActiveDatabaseVersion: databaseHelpers.getActiveDatabaseVersion,
    getActualPort: databaseHelpers.getActualPort,
    getBinaryRuntimeDir: databaseHelpers.getBinaryRuntimeDir,
    _getBinaryPath: databaseHelpers._getBinaryPath,
  };
}

describe('database/helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns configured database info for PostgreSQL credentials', () => {
    const context = makeContext({
      settings: { activeDatabaseType: 'postgresql', activeDatabaseVersion: '17' },
      state: { settings: { pgUser: 'pgadmin', pgPassword: 'secret' } },
    });

    const info = databaseHelpers.getDatabaseInfo.call(context);

    expect(info).toEqual({
      type: 'postgresql',
      version: '17',
      host: '127.0.0.1',
      port: 5432,
      user: 'pgadmin',
      password: 'secret',
    });
  });

  it('calculates expected port from service offsets when version is not running', () => {
    const context = makeContext({
      settings: { activeDatabaseType: 'mysql', activeDatabaseVersion: '8.0' },
      managers: {
        service: {
          runningVersions: new Map([['mysql', new Map()]]),
          serviceConfigs: { mysql: { defaultPort: 3306 } },
          versionPortOffsets: { mysql: { '8.0': 10 } },
        },
      },
    });

    expect(databaseHelpers.getActualPort.call(context)).toBe(3316);
  });

  it('returns the running version binary path when available', () => {
    const context = makeContext({
      managers: {
        service: {
          serviceStatus: new Map([['mysql', { status: 'running', version: '8.4' }]]),
        },
      },
      resourcePath: 'C:/DevBox/resources',
    });

    vi.spyOn(path, 'join');
    const existsSync = vi.spyOn(require('fs-extra'), 'existsSync').mockImplementation((filePath) => filePath.includes('8.4'));

    const binaryPath = databaseHelpers._getBinaryPath.call(context, 'mysql');

    expect(binaryPath).toContain(path.join('mysql', '8.4'));
    expect(existsSync).toHaveBeenCalled();
  });

  it('uses runtime directory as cwd for MySQL spawn options', () => {
    const context = makeContext({ settings: { activeDatabaseType: 'mysql' } });

    const options = databaseHelpers.buildBinarySpawnOptions.call(
      context,
      'C:/Users/test/AppData/Roaming/devbox-pro/resources/mysql/8.4/win/bin/mysql.exe',
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    expect(options.cwd).toBe('C:/Users/test/AppData/Roaming/devbox-pro/resources/mysql/8.4/win');
    expect(options.windowsHide).toBe(true);
  });

  it('returns connection metadata for the active database type', () => {
    const context = makeContext({ settings: { activeDatabaseType: 'mariadb' } });

    expect(databaseHelpers.getConnections.call(context)).toEqual({
      mariadb: {
        type: 'mariadb',
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        status: 'connected',
      },
    });
  });

  it('sanitizes database names consistently', () => {
    const context = makeContext();

    expect(databaseHelpers.sanitizeName.call(context, '  my-app db!!!  ')).toBe('my_app_db');
    expect(databaseHelpers.sanitizeName.call(context, '')).toBe('unnamed');
  });
});