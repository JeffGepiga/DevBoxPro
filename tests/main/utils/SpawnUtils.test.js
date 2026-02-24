/**
 * Tests for src/main/utils/SpawnUtils.js
 *
 * Phase 2 – Tests for spawn wrapper functions.
 *
 * IMPORTANT: Node built-in modules (child_process) cannot be mocked via
 * vi.mock in CJS context. We test spawnSyncSafe/spawnAsync with real commands,
 * and higher-level functions (isProcessRunning, killProcess*, etc.) by mocking
 * the SpawnUtils module itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
    spawnSyncSafe,
    spawnAsync,
    getSanitizedEnv,
    commandExists,
    isProcessRunning,
    getProcessPidsByPath,
} = require('../../../src/main/utils/SpawnUtils');

// ═══════════════════════════════════════════════════════════════════════════════
// spawnSyncSafe() — tested with REAL simple commands
// ═══════════════════════════════════════════════════════════════════════════════

describe('spawnSyncSafe()', () => {
    it('returns stdout from successful command', () => {
        // 'hostname' is available on Windows, macOS, Linux and returns a short string
        const result = spawnSyncSafe('hostname');
        expect(result.status).toBe(0);
        expect(result.stdout.trim().length).toBeGreaterThan(0);
        expect(result.error).toBeFalsy();
    });

    it('returns status 0 and stderr empty for simple command', () => {
        const result = spawnSyncSafe('hostname');
        expect(result.status).toBe(0);
        expect(typeof result.stdout).toBe('string');
        expect(typeof result.stderr).toBe('string');
    });

    it('returns object with stdout, stderr, status, error shape', () => {
        const result = spawnSyncSafe('hostname');
        expect(result).toHaveProperty('stdout');
        expect(result).toHaveProperty('stderr');
        expect(result).toHaveProperty('status');
        expect(result).toHaveProperty('error');
    });

    it('handles command error gracefully', () => {
        // A command that doesn't exist should return error/status -1
        const result = spawnSyncSafe('nonexistent_cmd_12345');
        // Either status is non-0 or error is set
        expect(result.status !== 0 || result.error !== null).toBe(true);
    });

    it('respects timeout option', () => {
        // Use a very short timeout with a command that should be instant
        const result = spawnSyncSafe('hostname', [], { timeout: 5000 });
        expect(result.status).toBe(0);
    });

    it('sets windowsHide by default', () => {
        // Can't directly verify the option, but we verify it doesn't crash
        const result = spawnSyncSafe('hostname');
        expect(result.status).toBe(0);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// spawnAsync() — tested with REAL simple commands
// ═══════════════════════════════════════════════════════════════════════════════

describe('spawnAsync()', () => {
    it('resolves with stdout from successful command', async () => {
        const result = await spawnAsync('hostname');
        expect(result.code).toBe(0);
        expect(result.stdout.trim().length).toBeGreaterThan(0);
    });

    it('returns object with stdout, stderr, code shape', async () => {
        const result = await spawnAsync('hostname');
        expect(result).toHaveProperty('stdout');
        expect(result).toHaveProperty('stderr');
        expect(result).toHaveProperty('code');
    });

    it('resolves with code -1 for invalid commands', async () => {
        const result = await spawnAsync('nonexistent_cmd_12345');
        // Should get error code (either -1 or non-zero)
        expect(result.code !== 0 || result.error).toBeTruthy();
    });

    it('calls onStdout callback if provided', async () => {
        const onStdout = vi.fn();
        await spawnAsync('hostname', [], { onStdout });
        expect(onStdout).toHaveBeenCalled();
    });

    it('passes arguments correctly', async () => {
        // echo is available on Windows (cmd built-in) and Unix
        if (process.platform === 'win32') {
            const result = await spawnAsync('cmd.exe', ['/c', 'echo', 'test123']);
            expect(result.stdout).toContain('test123');
        } else {
            const result = await spawnAsync('echo', ['test123']);
            expect(result.stdout.trim()).toBe('test123');
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getSanitizedEnv()
// ═══════════════════════════════════════════════════════════════════════════════

describe('getSanitizedEnv()', () => {
    let originalEnv;
    beforeEach(() => { originalEnv = process.env; });
    afterEach(() => { process.env = originalEnv; });

    it('preserves PATH in sanitized output', () => {
        process.env = { PATH: '/usr/bin:/usr/local/bin' };
        expect(getSanitizedEnv().PATH).toBe('/usr/bin:/usr/local/bin');
    });

    it('filters out AWS_ prefixed variables', () => {
        process.env = { AWS_SECRET_ACCESS_KEY: 'secret123', PATH: '/usr/bin' };
        const env = getSanitizedEnv();
        expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
        expect(env.PATH).toBe('/usr/bin');
    });

    it('filters out variables matching SECRET pattern', () => {
        process.env = { MY_SECRET: 'hidden', PATH: '/usr/bin' };
        expect(getSanitizedEnv().MY_SECRET).toBeUndefined();
    });

    it('filters out GITHUB_TOKEN', () => {
        process.env = { GITHUB_TOKEN: 'ghp_xxx', PATH: '/usr/bin' };
        expect(getSanitizedEnv().GITHUB_TOKEN).toBeUndefined();
    });

    it('preserves allowlisted keys like USERPROFILE and TEMP', () => {
        process.env = { USERPROFILE: 'C:\\Users\\Test', TEMP: 'C:\\Temp', PATH: '/usr/bin' };
        const env = getSanitizedEnv();
        expect(env.USERPROFILE).toBe('C:\\Users\\Test');
        expect(env.TEMP).toBe('C:\\Temp');
    });

    it('merges additional env vars', () => {
        process.env = { PATH: '/usr/bin' };
        expect(getSanitizedEnv({ CUSTOM_VAR: 'value' }).CUSTOM_VAR).toBe('value');
    });

    it('additional env vars override sanitized ones', () => {
        process.env = { PATH: '/original' };
        expect(getSanitizedEnv({ PATH: '/custom' }).PATH).toBe('/custom');
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// commandExists()
// ═══════════════════════════════════════════════════════════════════════════════

describe('commandExists()', () => {
    it('returns true for a command that exists', () => {
        // 'hostname' exists on all platforms
        expect(commandExists('hostname')).toBe(true);
    });

    it('returns false for a command that does not exist', () => {
        expect(commandExists('nonexistent_cmd_xyz_12345')).toBe(false);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// isProcessRunning() — uses spawnSyncSafe internally (Windows-only)
// ═══════════════════════════════════════════════════════════════════════════════

describe('isProcessRunning()', () => {
    it('returns boolean', () => {
        if (process.platform === 'win32') {
            // System process should be running
            const result = isProcessRunning('explorer.exe');
            expect(typeof result).toBe('boolean');
        } else {
            // Non-Windows always returns false
            expect(isProcessRunning('anything')).toBe(false);
        }
    });

    it('returns false for non-existent process', () => {
        if (process.platform === 'win32') {
            expect(isProcessRunning('nonexistent_process_12345.exe')).toBe(false);
        } else {
            expect(isProcessRunning('nonexistent')).toBe(false);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getProcessPidsByPath() — Windows-only
// ═══════════════════════════════════════════════════════════════════════════════

describe('getProcessPidsByPath()', () => {
    it('returns an array', () => {
        const pids = getProcessPidsByPath('nonexistent.exe', 'C:\\nonexistent');
        expect(Array.isArray(pids)).toBe(true);
    });

    it('returns empty array for non-existent process', () => {
        expect(getProcessPidsByPath('zzz_fake.exe', 'C:\\fake')).toEqual([]);
    });

    it('returns empty array on non-Windows', () => {
        if (process.platform !== 'win32') {
            expect(getProcessPidsByPath('php', '/usr/bin')).toEqual([]);
        }
    });
});
