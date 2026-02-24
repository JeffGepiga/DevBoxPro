/**
 * Tests for src/main/services/PhpManager.js
 *
 * Phase 3 – PhpManager tests. Focuses on pure validation logic
 * (validatePhpCommand, validateArtisanCommand), path construction,
 * version management, and extension discovery using temp dirs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

const fs = require('fs-extra');
require('../../helpers/mockElectronCjs');
const { PhpManager } = require('../../../src/main/services/PhpManager');

describe('PhpManager', () => {
    let pm;
    let tmpDir;
    let mockConfigStore;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `phpmgr-test-${Date.now()}`);
        await fs.ensureDir(tmpDir);
        mockConfigStore = {
            get: vi.fn(() => ({})),
            set: vi.fn(),
        };
        pm = new PhpManager(tmpDir, mockConfigStore, {});
    });

    afterEach(async () => {
        await fs.remove(tmpDir).catch(() => { });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Constructor / basic properties
    // ═══════════════════════════════════════════════════════════════════

    describe('constructor', () => {
        it('stores resourcePath and configStore', () => {
            expect(pm.resourcePath).toBe(tmpDir);
            expect(pm.configStore).toBe(mockConfigStore);
        });

        it('initializes supportedVersions', () => {
            expect(pm.supportedVersions).toContain('8.3');
            expect(pm.supportedVersions).toContain('7.4');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getPhpBinaryName()
    // ═══════════════════════════════════════════════════════════════════

    describe('getPhpBinaryName()', () => {
        it('returns platform-appropriate name', () => {
            const name = pm.getPhpBinaryName();
            if (process.platform === 'win32') {
                expect(name).toBe('php.exe');
            } else {
                expect(name).toBe('php');
            }
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getComposerPath()
    // ═══════════════════════════════════════════════════════════════════

    describe('getComposerPath()', () => {
        it('returns correct path under resourcePath', () => {
            const result = pm.getComposerPath();
            expect(result).toBe(path.join(tmpDir, 'composer', 'composer.phar'));
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getPhpBinaryPath()
    // ═══════════════════════════════════════════════════════════════════

    describe('getPhpBinaryPath()', () => {
        it('throws when version is not available', () => {
            expect(() => pm.getPhpBinaryPath('8.3')).toThrow('PHP 8.3 is not available');
        });

        it('returns binary path when version is available', () => {
            pm.phpVersions['8.3'] = {
                available: true,
                binary: '/path/to/php',
            };
            expect(pm.getPhpBinaryPath('8.3')).toBe('/path/to/php');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getDefaultVersion() / setDefaultVersion()
    // ═══════════════════════════════════════════════════════════════════

    describe('getDefaultVersion()', () => {
        it('returns config-stored version when available', () => {
            mockConfigStore.get.mockReturnValue({ defaultPhpVersion: '8.2' });
            pm.phpVersions['8.2'] = { available: true };
            expect(pm.getDefaultVersion()).toBe('8.2');
        });

        it('falls back to first available version', () => {
            mockConfigStore.get.mockReturnValue({});
            pm.phpVersions['8.3'] = { available: true };
            expect(pm.getDefaultVersion()).toBe('8.3');
        });

        it('falls back to 8.2 when nothing available', () => {
            mockConfigStore.get.mockReturnValue({});
            expect(pm.getDefaultVersion()).toBe('8.2');
        });
    });

    describe('setDefaultVersion()', () => {
        it('stores version in config when available', () => {
            pm.phpVersions['8.3'] = { available: true };
            mockConfigStore.get.mockReturnValue({});
            pm.setDefaultVersion('8.3');
            expect(mockConfigStore.set).toHaveBeenCalledWith('settings', { defaultPhpVersion: '8.3' });
        });

        it('throws when version not available', () => {
            expect(() => pm.setDefaultVersion('9.0')).toThrow('PHP 9.0 is not available');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getAvailableVersions()
    // ═══════════════════════════════════════════════════════════════════

    describe('getAvailableVersions()', () => {
        it('returns list with version info', () => {
            pm.phpVersions['8.3'] = { available: true, path: '/p', extensions: [] };
            pm.phpVersions['7.4'] = { available: false, path: '/q', extensions: [] };
            const versions = pm.getAvailableVersions();
            expect(versions).toHaveLength(2);
            expect(versions.find((v) => v.version === '8.3').available).toBe(true);
            expect(versions.find((v) => v.version === '7.4').available).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getExtensions()
    // ═══════════════════════════════════════════════════════════════════

    describe('getExtensions()', () => {
        it('returns extensions for known version', () => {
            pm.phpVersions['8.3'] = { extensions: [{ name: 'curl', enabled: true }] };
            expect(pm.getExtensions('8.3')).toEqual([{ name: 'curl', enabled: true }]);
        });

        it('throws for unknown version', () => {
            expect(() => pm.getExtensions('9.9')).toThrow('PHP 9.9 not found');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // validatePhpCommand()
    // ═══════════════════════════════════════════════════════════════════

    describe('validatePhpCommand()', () => {
        it('accepts safe PHP code', () => {
            expect(pm.validatePhpCommand('echo "hello";')).toBe(true);
        });

        it('accepts phpinfo()', () => {
            expect(pm.validatePhpCommand('phpinfo();')).toBe(true);
        });

        it('rejects exec()', () => {
            expect(pm.validatePhpCommand('exec("rm -rf /")')).toBe(false);
        });

        it('rejects shell_exec()', () => {
            expect(pm.validatePhpCommand('shell_exec("ls")')).toBe(false);
        });

        it('rejects system()', () => {
            expect(pm.validatePhpCommand('system("whoami")')).toBe(false);
        });

        it('rejects passthru()', () => {
            expect(pm.validatePhpCommand('passthru("id")')).toBe(false);
        });

        it('rejects backtick execution', () => {
            expect(pm.validatePhpCommand('`ls`')).toBe(false);
        });

        it('rejects variable interpolation exploit', () => {
            expect(pm.validatePhpCommand('echo ${`whoami`}')).toBe(false);
        });

        it('rejects null/empty', () => {
            expect(pm.validatePhpCommand(null)).toBe(false);
            expect(pm.validatePhpCommand('')).toBe(false);
        });

        it('rejects non-string', () => {
            expect(pm.validatePhpCommand(123)).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // validateArtisanCommand()
    // ═══════════════════════════════════════════════════════════════════

    describe('validateArtisanCommand()', () => {
        it('accepts safe artisan commands', () => {
            expect(pm.validateArtisanCommand('migrate')).toBe(true);
            expect(pm.validateArtisanCommand('make:controller UserController')).toBe(true);
            expect(pm.validateArtisanCommand('route:list')).toBe(true);
        });

        it('rejects semicolons (command chaining)', () => {
            expect(pm.validateArtisanCommand('migrate; rm -rf /')).toBe(false);
        });

        it('rejects ampersand (background/chaining)', () => {
            expect(pm.validateArtisanCommand('migrate && echo hacked')).toBe(false);
        });

        it('rejects pipe', () => {
            expect(pm.validateArtisanCommand('migrate | grep something')).toBe(false);
        });

        it('rejects backticks', () => {
            expect(pm.validateArtisanCommand('migrate `whoami`')).toBe(false);
        });

        it('rejects dollar sign (variable expansion)', () => {
            expect(pm.validateArtisanCommand('migrate $HOME')).toBe(false);
        });

        it('rejects null/empty', () => {
            expect(pm.validateArtisanCommand(null)).toBe(false);
            expect(pm.validateArtisanCommand('')).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // discoverExtensions()
    // ═══════════════════════════════════════════════════════════════════

    describe('discoverExtensions()', () => {
        it('discovers extensions from ext directory and ini', async () => {
            const phpDir = path.join(tmpDir, 'php83');
            const extDir = path.join(phpDir, 'ext');
            await fs.ensureDir(extDir);
            await fs.writeFile(path.join(extDir, 'php_curl.dll'), '');
            await fs.writeFile(path.join(extDir, 'php_gd.dll'), '');
            await fs.writeFile(path.join(phpDir, 'php.ini'), 'extension=curl\n;extension=gd');

            const exts = await pm.discoverExtensions(phpDir, '8.3');
            const curl = exts.find((e) => e.name === 'curl');
            const gd = exts.find((e) => e.name === 'gd');
            expect(curl.enabled).toBe(true);
            expect(gd.enabled).toBe(false);
        });

        it('returns empty array when ext dir missing', async () => {
            const phpDir = path.join(tmpDir, 'empty');
            await fs.ensureDir(phpDir);
            const exts = await pm.discoverExtensions(phpDir, '8.3');
            expect(exts).toEqual([]);
        });
    });
});
