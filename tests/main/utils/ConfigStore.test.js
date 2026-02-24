/**
 * Tests for src/main/utils/ConfigStore.js
 *
 * Phase 2 – Tests for ConfigStore.
 *
 * NOTE: Vitest vi.mock does not intercept CJS require() in Node environment.
 * Tests use the real electron-store (persisted to a temp directory) and
 * real fs-extra. Tests that need isolation create fresh instances.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

const { ConfigStore } = require('../../../src/main/utils/ConfigStore');

// ═══════════════════════════════════════════════════════════════════════════════

describe('ConfigStore', () => {
    let store;

    beforeEach(() => {
        store = new ConfigStore();
    });

    // ─── constructor ──────────────────────────────────────────────────────

    describe('constructor()', () => {
        it('creates a store instance with a working store property', () => {
            expect(store.store).not.toBeNull();
        });

        it('initializes with defaults', () => {
            const dataPath = store.get('dataPath');
            expect(dataPath).toBeDefined();
            expect(typeof dataPath).toBe('string');
        });
    });

    // ─── getDefaults() ────────────────────────────────────────────────────

    describe('getDefaults()', () => {
        it('returns correct shape with all required keys', () => {
            const defaults = store.getDefaults();
            expect(defaults).toHaveProperty('dataPath');
            expect(defaults).toHaveProperty('settings');
            expect(defaults).toHaveProperty('projects');
            expect(defaults).toHaveProperty('phpVersions');
            expect(defaults).toHaveProperty('certificates');
            expect(defaults).toHaveProperty('recentProjects');
        });

        it('settings has expected default values', () => {
            const { settings } = store.getDefaults();
            expect(settings.autoStartServices).toBe(true);
            expect(settings.autoStartOnLaunch).toBe(false);
            expect(settings.portRangeStart).toBe(8000);
            expect(settings.sslEnabled).toBe(true);
            expect(settings.defaultPhpVersion).toBeNull();
            expect(settings.defaultEditor).toBe('vscode');
            expect(settings.theme).toBe('system');
            expect(settings.mysqlPort).toBe(3306);
            expect(settings.redisPort).toBe(6379);
            expect(settings.activeDatabaseType).toBe('mysql');
            expect(settings.dbUser).toBe('root');
            expect(settings.dbPassword).toBe('');
            expect(settings.serverTimezone).toBe('UTC');
        });

        it('projects is an empty array by default', () => {
            expect(store.getDefaults().projects).toEqual([]);
        });

        it('recentProjects is an empty array by default', () => {
            expect(store.getDefaults().recentProjects).toEqual([]);
        });

        it('defaultProjectsPath is platform-specific', () => {
            const defaults = store.getDefaults();
            if (process.platform === 'win32') {
                expect(defaults.settings.defaultProjectsPath).toBe('C:/Projects');
            } else {
                expect(defaults.settings.defaultProjectsPath).toContain('Projects');
            }
        });
    });

    // ─── get() / set() ────────────────────────────────────────────────────

    describe('get()', () => {
        it('returns stored value in normal mode', () => {
            const value = store.get('dataPath');
            expect(value).toBeDefined();
            expect(typeof value).toBe('string');
        });

        it('returns defaultValue when key is missing', () => {
            expect(store.get('nonexistent_key_xyz', 'fallback')).toBe('fallback');
        });

        it('returns undefined when key is missing and no default', () => {
            expect(store.get('nonexistent_key_xyz')).toBeUndefined();
        });

        it('retrieves nested settings via dot notation', () => {
            const theme = store.get('settings.theme');
            // Could be 'system' or user-modified, just verify it's defined
            expect(theme).toBeDefined();
        });
    });

    describe('set()', () => {
        it('sets and retrieves a value', () => {
            const testKey = '_test_key_' + Date.now();
            store.set(testKey, 'testValue');
            expect(store.get(testKey)).toBe('testValue');
            // Clean up
            store.delete(testKey);
        });

        it('returns the set value', () => {
            const testKey = '_test_ret_' + Date.now();
            const result = store.set(testKey, 42);
            expect(result).toBe(42);
            store.delete(testKey);
        });
    });

    // ─── delete / has / getAll ────────────────────────────────────────────

    describe('delete()', () => {
        it('removes a key', () => {
            const testKey = '_test_del_' + Date.now();
            store.set(testKey, 'value');
            store.delete(testKey);
            expect(store.get(testKey)).toBeUndefined();
        });
    });

    describe('has()', () => {
        it('returns true for existing key', () => {
            expect(store.has('dataPath')).toBe(true);
        });

        it('returns false for non-existing key', () => {
            expect(store.has('nonexistent_abc_123')).toBe(false);
        });
    });

    describe('getAll()', () => {
        it('returns an object with all config data', () => {
            const all = store.getAll();
            expect(all).toBeDefined();
            expect(typeof all).toBe('object');
            expect(all).toHaveProperty('dataPath');
            expect(all).toHaveProperty('settings');
        });
    });

    describe('reset()', () => {
        it('restores defaults', () => {
            // Modify something
            const testKey = '_test_reset_' + Date.now();
            store.set(testKey, 'value');

            const defaults = store.reset();
            expect(defaults).toHaveProperty('dataPath');
            expect(defaults).toHaveProperty('settings');
            // The test key should be gone after reset
            expect(store.get(testKey)).toBeUndefined();
        });
    });

    // ─── addRecentProject / getRecentProjects ─────────────────────────────

    describe('addRecentProject()', () => {
        beforeEach(() => {
            // Clear recent projects for isolation
            store.set('recentProjects', []);
        });

        it('adds project to front of list', () => {
            store.addRecentProject('proj-1');
            store.addRecentProject('proj-2');
            const recent = store.get('recentProjects');
            expect(recent[0]).toBe('proj-2');
            expect(recent[1]).toBe('proj-1');
        });

        it('deduplicates project IDs', () => {
            store.addRecentProject('proj-1');
            store.addRecentProject('proj-2');
            store.addRecentProject('proj-1'); // duplicate
            const recent = store.get('recentProjects');
            expect(recent.filter((id) => id === 'proj-1')).toHaveLength(1);
            expect(recent[0]).toBe('proj-1');
        });

        it('caps at 10 entries', () => {
            for (let i = 0; i < 15; i++) {
                store.addRecentProject(`proj-${i}`);
            }
            const recent = store.get('recentProjects');
            expect(recent.length).toBeLessThanOrEqual(10);
        });
    });

    describe('getRecentProjects()', () => {
        beforeEach(() => {
            store.set('recentProjects', []);
            store.set('projects', []);
        });

        it('maps IDs to project objects and filters invalid', () => {
            store.set('projects', [
                { id: 'a', name: 'Project A' },
                { id: 'b', name: 'Project B' },
            ]);
            store.set('recentProjects', ['a', 'nonexistent', 'b']);
            const recent = store.getRecentProjects();
            expect(recent).toHaveLength(2);
            expect(recent[0].name).toBe('Project A');
            expect(recent[1].name).toBe('Project B');
        });

        it('returns empty array when no recent projects exist', () => {
            store.set('recentProjects', []);
            store.set('projects', []);
            expect(store.getRecentProjects()).toEqual([]);
        });
    });

    // ─── getSetting / setSetting ──────────────────────────────────────────

    describe('getSetting()', () => {
        it('returns setting value', () => {
            const theme = store.getSetting('theme');
            expect(typeof theme).toBe('string');
        });

        it('returns defaultValue for missing setting', () => {
            expect(store.getSetting('nonexistent_setting', 'fb')).toBe('fb');
        });
    });

    describe('setSetting()', () => {
        it('updates a setting value and can be retrieved', () => {
            const original = store.getSetting('theme');
            store.setSetting('theme', 'test-theme');
            expect(store.getSetting('theme')).toBe('test-theme');
            // Restore
            store.setSetting('theme', original);
        });

        it('returns the set value', () => {
            const original = store.getSetting('theme');
            const result = store.setSetting('theme', 'dark');
            expect(result).toBe('dark');
            store.setSetting('theme', original);
        });
    });

    // ─── exportConfig ─────────────────────────────────────────────────────

    describe('exportConfig()', () => {
        it('writes config to file and returns success', async () => {
            const fs = require('fs-extra');
            const os = require('os');
            const filePath = path.join(os.tmpdir(), `devbox-test-export-${Date.now()}.json`);

            try {
                const result = await store.exportConfig(filePath);
                expect(result).toEqual({ success: true, path: filePath });
                // Verify file was written
                const exists = await fs.pathExists(filePath);
                expect(exists).toBe(true);
                const content = await fs.readJson(filePath);
                expect(content).toHaveProperty('dataPath');
                expect(content).toHaveProperty('settings');
            } finally {
                // Clean up
                await fs.remove(filePath).catch(() => { });
            }
        });
    });

    // ─── importConfig ─────────────────────────────────────────────────────

    describe('importConfig()', () => {
        it('throws when file not found', async () => {
            await expect(store.importConfig('/nonexistent_path/config.json'))
                .rejects.toThrow('Config file not found');
        });

        it('throws for invalid format (missing settings)', async () => {
            const fs = require('fs-extra');
            const os = require('os');
            const filePath = path.join(os.tmpdir(), `devbox-test-invalid-${Date.now()}.json`);

            try {
                await fs.writeJson(filePath, { projects: [] }); // missing settings
                await expect(store.importConfig(filePath))
                    .rejects.toThrow('Invalid config file format');
            } finally {
                await fs.remove(filePath).catch(() => { });
            }
        });

        it('throws for invalid format (projects not array)', async () => {
            const fs = require('fs-extra');
            const os = require('os');
            const filePath = path.join(os.tmpdir(), `devbox-test-invalid2-${Date.now()}.json`);

            try {
                await fs.writeJson(filePath, { settings: {}, projects: 'not-array' });
                await expect(store.importConfig(filePath))
                    .rejects.toThrow('Invalid config file format');
            } finally {
                await fs.remove(filePath).catch(() => { });
            }
        });

        it('merges valid config with defaults', async () => {
            const fs = require('fs-extra');
            const os = require('os');
            const filePath = path.join(os.tmpdir(), `devbox-test-valid-${Date.now()}.json`);

            try {
                await fs.writeJson(filePath, {
                    settings: { theme: 'imported-dark' },
                    projects: [{ id: '1', name: 'Imported' }],
                });
                const result = await store.importConfig(filePath);
                expect(result).toEqual({ success: true });
                expect(store.getSetting('theme')).toBe('imported-dark');
                // Default values should be preserved
                expect(store.getSetting('mysqlPort')).toBe(3306);
            } finally {
                await fs.remove(filePath).catch(() => { });
                // Restore theme
                store.setSetting('theme', 'system');
            }
        });
    });

    // ─── Path helpers ─────────────────────────────────────────────────────

    describe('path helpers', () => {
        it('getDataPath() returns a string', () => {
            expect(typeof store.getDataPath()).toBe('string');
        });

        it('getLogsPath() contains logs', () => {
            expect(store.getLogsPath()).toContain('logs');
        });

        it('getMysqlDataPath() contains mysql and data', () => {
            const p = store.getMysqlDataPath();
            expect(p).toContain('mysql');
            expect(p).toContain('data');
        });

        it('getRedisDataPath() contains redis', () => {
            expect(store.getRedisDataPath()).toContain('redis');
        });

        it('getSslPath() contains ssl', () => {
            expect(store.getSslPath()).toContain('ssl');
        });

        it('all paths are under dataPath', () => {
            const dataPath = store.getDataPath();
            expect(store.getLogsPath()).toContain(dataPath);
            expect(store.getMysqlDataPath()).toContain(dataPath);
            expect(store.getRedisDataPath()).toContain(dataPath);
            expect(store.getSslPath()).toContain(dataPath);
        });
    });
});
