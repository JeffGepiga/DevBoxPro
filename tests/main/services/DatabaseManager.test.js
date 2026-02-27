/**
 * Tests for src/main/services/DatabaseManager.js
 *
 * Phase 3.9 – Tests for database type management, credentials, file path
 * validation, operation tracking, and connection helpers.
 * (Actual SQL execution is mocked – no live database required.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

require('../../helpers/mockElectronCjs');
const { DatabaseManager } = require('../../../src/main/services/DatabaseManager');

// ─────────────────────────────────────────────────────────────────────────────

function makeConfigStore(settings = {}, state = {}) {
    const settingsMap = { activeDatabaseType: 'mysql', activeDatabaseVersion: '8.4', ...settings };
    const store = { settings: {}, ...state };

    return {
        get: vi.fn((key, def) => key in store ? store[key] : def),
        set: vi.fn((key, val) => { store[key] = val; }),
        getSetting: vi.fn((key, def) => key in settingsMap ? settingsMap[key] : def),
        setSetting: vi.fn((key, val) => { settingsMap[key] = val; }),
    };
}

function makeDbManager(settingsOverrides = {}, stateOverrides = {}) {
    const configStore = makeConfigStore(settingsOverrides, stateOverrides);
    const mgr = new DatabaseManager('/resources', configStore, {});
    return { mgr, configStore };
}

describe('DatabaseManager', () => {
    // ═══════════════════════════════════════════════════════════════════
    // constructor
    // ═══════════════════════════════════════════════════════════════════

    describe('constructor', () => {
        it('sets default dbConfig with host 127.0.0.1', () => {
            const { mgr } = makeDbManager();
            expect(mgr.dbConfig.host).toBe('127.0.0.1');
            expect(mgr.dbConfig.port).toBe(3306);
            expect(mgr.dbConfig.user).toBe('root');
        });

        it('initializes runningOperations as empty Map', () => {
            const { mgr } = makeDbManager();
            expect(mgr.runningOperations.size).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getActiveDatabaseType() / getActiveDatabaseVersion()
    // ═══════════════════════════════════════════════════════════════════

    describe('getActiveDatabaseType()', () => {
        it('returns mysql by default', () => {
            const { mgr } = makeDbManager({ activeDatabaseType: 'mysql' });
            expect(mgr.getActiveDatabaseType()).toBe('mysql');
        });

        it('returns mariadb when configured', () => {
            const { mgr } = makeDbManager({ activeDatabaseType: 'mariadb' });
            expect(mgr.getActiveDatabaseType()).toBe('mariadb');
        });
    });

    describe('getActiveDatabaseVersion()', () => {
        it('returns configured version', () => {
            const { mgr } = makeDbManager({ activeDatabaseType: 'mysql', activeDatabaseVersion: '8.0' });
            expect(mgr.getActiveDatabaseVersion()).toBe('8.0');
        });

        it('defaults to 8.4 for mysql', () => {
            const { mgr, configStore } = makeDbManager();
            configStore.getSetting.mockImplementation((key, def) => {
                if (key === 'activeDatabaseType') return 'mysql';
                return def; // no activeDatabaseVersion set
            });
            expect(mgr.getActiveDatabaseVersion()).toBe('8.4');
        });

        it('defaults to 11.4 for mariadb', () => {
            const { mgr, configStore } = makeDbManager();
            configStore.getSetting.mockImplementation((key, def) => {
                if (key === 'activeDatabaseType') return 'mariadb';
                return def; // no activeDatabaseVersion set
            });
            expect(mgr.getActiveDatabaseVersion()).toBe('11.4');
        });

        it('defaults to 17 for postgresql', () => {
            const { mgr, configStore } = makeDbManager();
            configStore.getSetting.mockImplementation((key, def) => {
                if (key === 'activeDatabaseType') return 'postgresql';
                return def;
            });
            expect(mgr.getActiveDatabaseVersion()).toBe('17');
        });

        it('defaults to 8.0 for mongodb', () => {
            const { mgr, configStore } = makeDbManager();
            configStore.getSetting.mockImplementation((key, def) => {
                if (key === 'activeDatabaseType') return 'mongodb';
                return def;
            });
            expect(mgr.getActiveDatabaseVersion()).toBe('8.0');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // setActiveDatabaseType()
    // ═══════════════════════════════════════════════════════════════════

    describe('setActiveDatabaseType()', () => {
        it('sets mysql successfully', async () => {
            const { mgr } = makeDbManager();
            const result = await mgr.setActiveDatabaseType('mysql');
            expect(result.success).toBe(true);
            expect(result.type).toBe('mysql');
        });

        it('sets mariadb successfully', async () => {
            const { mgr } = makeDbManager();
            const result = await mgr.setActiveDatabaseType('mariadb', '10.6');
            expect(result.success).toBe(true);
            expect(result.type).toBe('mariadb');
            expect(result.version).toBe('10.6');
        });

        it('sets postgresql successfully', async () => {
            const { mgr } = makeDbManager();
            const result = await mgr.setActiveDatabaseType('postgresql', '17');
            expect(result.success).toBe(true);
            expect(result.type).toBe('postgresql');
            expect(result.version).toBe('17');
        });

        it('sets mongodb successfully', async () => {
            const { mgr } = makeDbManager();
            const result = await mgr.setActiveDatabaseType('mongodb', '8.0');
            expect(result.success).toBe(true);
            expect(result.type).toBe('mongodb');
            expect(result.version).toBe('8.0');
        });

        it('throws for invalid database type', async () => {
            const { mgr } = makeDbManager();
            await expect(mgr.setActiveDatabaseType('sqlite')).rejects.toThrow('Invalid database type');
        });

        it('saves type to configStore', async () => {
            const { mgr, configStore } = makeDbManager();
            await mgr.setActiveDatabaseType('mariadb');
            expect(configStore.setSetting).toHaveBeenCalledWith('activeDatabaseType', 'mariadb');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getDatabaseInfo()
    // ═══════════════════════════════════════════════════════════════════

    describe('getDatabaseInfo()', () => {
        it('returns correct shape', () => {
            const { mgr } = makeDbManager();
            const info = mgr.getDatabaseInfo();
            expect(info).toHaveProperty('type');
            expect(info).toHaveProperty('version');
            expect(info).toHaveProperty('host');
            expect(info).toHaveProperty('port');
            expect(info).toHaveProperty('user');
            expect(info).toHaveProperty('password');
        });

        it('includes database type in result', () => {
            const { mgr } = makeDbManager({ activeDatabaseType: 'mariadb' });
            const info = mgr.getDatabaseInfo();
            expect(info.type).toBe('mariadb');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // resetCredentials()
    // ═══════════════════════════════════════════════════════════════════

    describe('resetCredentials()', () => {
        it('saves credentials to configStore', async () => {
            const { mgr, configStore } = makeDbManager();
            await mgr.resetCredentials('admin', 'secret');
            expect(configStore.setSetting).toHaveBeenCalledWith('dbUser', 'admin');
            expect(configStore.setSetting).toHaveBeenCalledWith('dbPassword', 'secret');
        });

        it('updates local dbConfig', async () => {
            const { mgr } = makeDbManager();
            await mgr.resetCredentials('newuser', 'newpass');
            expect(mgr.dbConfig.user).toBe('newuser');
            expect(mgr.dbConfig.password).toBe('newpass');
        });

        it('returns success: true', async () => {
            const { mgr } = makeDbManager();
            const result = await mgr.resetCredentials();
            expect(result.success).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // validateFilePath()
    // ═══════════════════════════════════════════════════════════════════

    describe('validateFilePath()', () => {
        let mgr;
        beforeEach(() => {
            ({ mgr } = makeDbManager());
        });

        it('allows valid .sql files', () => {
            expect(mgr.validateFilePath('/home/user/backup.sql').valid).toBe(true);
        });

        it('allows .sql.gz files', () => {
            expect(mgr.validateFilePath('/home/user/backup.sql.gz').valid).toBe(true);
        });

        it('allows .gz files', () => {
            expect(mgr.validateFilePath('/home/user/backup.gz').valid).toBe(true);
        });

        it('rejects .exe files', () => {
            const result = mgr.validateFilePath('/home/user/malware.exe');
            expect(result.valid).toBe(false);
        });

        it('rejects path traversal with ..', () => {
            const result = mgr.validateFilePath('/home/user/../etc/passwd.sql');
            expect(result.valid).toBe(false);
            expect(result.error).toContain('path traversal');
        });

        it('rejects null filePath', () => {
            const result = mgr.validateFilePath(null);
            expect(result.valid).toBe(false);
        });

        it('rejects non-string filePath', () => {
            const result = mgr.validateFilePath(42);
            expect(result.valid).toBe(false);
        });

        it('skips extension check when checkExtension=false', () => {
            const result = mgr.validateFilePath('/valid/path/file.anything', false);
            expect(result.valid).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // cancelOperation() / getRunningOperations()
    // ═══════════════════════════════════════════════════════════════════

    describe('cancelOperation()', () => {
        it('returns error when operation not found', () => {
            const { mgr } = makeDbManager();
            const result = mgr.cancelOperation('nonexistent-id');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not found');
        });

        it('kills the process and removes from map', () => {
            const { mgr } = makeDbManager();
            const mockProc = { killed: false, kill: vi.fn() };
            mgr.runningOperations.set('op-1', { proc: mockProc, type: 'import', dbName: 'testdb' });

            const result = mgr.cancelOperation('op-1');

            expect(result.success).toBe(true);
            expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM');
            expect(mgr.runningOperations.has('op-1')).toBe(false);
        });

        it('handles process that is already killed', () => {
            const { mgr } = makeDbManager();
            const mockProc = { killed: true, kill: vi.fn() };
            mgr.runningOperations.set('op-2', { proc: mockProc, type: 'export', dbName: 'db' });

            const result = mgr.cancelOperation('op-2');
            expect(result.success).toBe(true);
            expect(mockProc.kill).not.toHaveBeenCalled();
        });
    });

    describe('getRunningOperations()', () => {
        it('returns empty array when no operations', () => {
            const { mgr } = makeDbManager();
            expect(mgr.getRunningOperations()).toEqual([]);
        });

        it('returns operations with correct shape', () => {
            const { mgr } = makeDbManager();
            mgr.runningOperations.set('op-1', { proc: {}, type: 'import', dbName: 'testdb', status: 'running' });

            const ops = mgr.getRunningOperations();
            expect(ops).toHaveLength(1);
            expect(ops[0]).toMatchObject({
                operationId: 'op-1',
                type: 'import',
                dbName: 'testdb',
                status: 'running',
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getConnections()
    // ═══════════════════════════════════════════════════════════════════

    describe('getConnections()', () => {
        it('returns connection info for active db type', () => {
            const { mgr } = makeDbManager({ activeDatabaseType: 'mysql' });
            const conns = mgr.getConnections();
            expect(conns).toHaveProperty('mysql');
            expect(conns.mysql.type).toBe('mysql');
            expect(conns.mysql.host).toBe('127.0.0.1');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // isServiceRunning()
    // ═══════════════════════════════════════════════════════════════════

    describe('isServiceRunning()', () => {
        it('returns false when no service manager', () => {
            const { mgr } = makeDbManager();
            expect(mgr.isServiceRunning()).toBe(false);
        });

        it('returns true when version is in runningVersions', () => {
            const { mgr } = makeDbManager({ activeDatabaseType: 'mysql', activeDatabaseVersion: '8.4' });
            const runningVersions = new Map([['8.4', { port: 3306 }]]);
            mgr.managers.service = {
                runningVersions: new Map([['mysql', runningVersions]]),
            };
            expect(mgr.isServiceRunning('mysql', '8.4')).toBe(true);
        });

        it('returns false when version is not running', () => {
            const { mgr } = makeDbManager({ activeDatabaseType: 'mysql', activeDatabaseVersion: '8.4' });
            mgr.managers.service = {
                runningVersions: new Map([['mysql', new Map()]]),
            };
            expect(mgr.isServiceRunning('mysql', '8.0')).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // deleteDatabase() – system database protection
    // ═══════════════════════════════════════════════════════════════════

    describe('deleteDatabase()', () => {
        it('throws when trying to delete a system database', async () => {
            const { mgr } = makeDbManager();
            // runDbQuery would be called after sanitizeName - mock it
            vi.spyOn(mgr, 'runDbQuery').mockResolvedValue([]);

            await expect(mgr.deleteDatabase('information_schema')).rejects.toThrow('Cannot delete system database');
            await expect(mgr.deleteDatabase('mysql')).rejects.toThrow('Cannot delete system database');
            await expect(mgr.deleteDatabase('performance_schema')).rejects.toThrow('Cannot delete system database');
            await expect(mgr.deleteDatabase('sys')).rejects.toThrow('Cannot delete system database');
        });

        it('allows deleting non-system databases', async () => {
            const { mgr } = makeDbManager();
            vi.spyOn(mgr, 'runDbQuery').mockResolvedValue([]);

            const result = await mgr.deleteDatabase('my_app_db');
            expect(result.success).toBe(true);
        });
    });
});
