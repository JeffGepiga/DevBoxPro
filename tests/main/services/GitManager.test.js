/**
 * Tests for src/main/services/GitManager.js
 *
 * Phase 3 – GitManager tests. Focuses on URL validation (pure logic),
 * progress listener pattern, and SSH key path helpers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

const fs = require('fs-extra');
require('../../helpers/mockElectronCjs');
const { GitManager } = require('../../../src/main/services/GitManager');

describe('GitManager', () => {
    let gm;
    let tmpDir;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `gitmgr-test-${Date.now()}`);
        await fs.ensureDir(tmpDir);
        const mockConfigStore = { get: vi.fn(() => ({})), set: vi.fn() };
        gm = new GitManager(mockConfigStore, {});
        gm.sshKeyPath = path.join(tmpDir, 'ssh');
        gm.resourcesPath = path.join(tmpDir, 'resources');
    });

    afterEach(async () => {
        await fs.remove(tmpDir).catch(() => { });
    });

    // ═══════════════════════════════════════════════════════════════════
    // validateRepositoryUrl()
    // ═══════════════════════════════════════════════════════════════════

    describe('validateRepositoryUrl()', () => {
        it('accepts GitHub HTTPS URL with .git', () => {
            const r = gm.validateRepositoryUrl('https://github.com/user/repo.git');
            expect(r.valid).toBe(true);
            expect(r.type).toBe('https');
        });

        it('accepts GitHub HTTPS URL without .git', () => {
            const r = gm.validateRepositoryUrl('https://github.com/user/repo');
            expect(r.valid).toBe(true);
            expect(r.type).toBe('https');
        });

        it('accepts GitLab HTTPS URL', () => {
            const r = gm.validateRepositoryUrl('https://gitlab.com/user/repo.git');
            expect(r.valid).toBe(true);
            expect(r.type).toBe('https');
        });

        it('accepts Bitbucket HTTPS URL', () => {
            const r = gm.validateRepositoryUrl('https://bitbucket.org/user/repo.git');
            expect(r.valid).toBe(true);
        });

        it('accepts custom domain HTTPS URL', () => {
            const r = gm.validateRepositoryUrl('https://my-gitlab.example.com/group/repo.git');
            expect(r.valid).toBe(true);
        });

        it('accepts SSH URL with .git', () => {
            const r = gm.validateRepositoryUrl('git@github.com:user/repo.git');
            expect(r.valid).toBe(true);
            expect(r.type).toBe('ssh');
        });

        it('accepts SSH URL without .git', () => {
            const r = gm.validateRepositoryUrl('git@github.com:user/repo');
            expect(r.valid).toBe(true);
            expect(r.type).toBe('ssh');
        });

        it('rejects empty URL', () => {
            const r = gm.validateRepositoryUrl('');
            expect(r.valid).toBe(false);
            expect(r.error).toContain('required');
        });

        it('rejects null', () => {
            const r = gm.validateRepositoryUrl(null);
            expect(r.valid).toBe(false);
        });

        it('rejects invalid format', () => {
            const r = gm.validateRepositoryUrl('not-a-url');
            expect(r.valid).toBe(false);
            expect(r.type).toBe('unknown');
        });

        it('rejects plain domain without path', () => {
            const r = gm.validateRepositoryUrl('https://github.com');
            expect(r.valid).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // onProgress / emitProgress
    // ═══════════════════════════════════════════════════════════════════

    describe('onProgress() / emitProgress()', () => {
        it('registers and calls listener', () => {
            const listener = vi.fn();
            gm.onProgress(listener);
            gm.emitProgress({ percent: 42, text: 'Receiving objects' });
            expect(listener).toHaveBeenCalledWith({ percent: 42, text: 'Receiving objects' });
        });

        it('cleanup function removes listener', () => {
            const listener = vi.fn();
            const cleanup = gm.onProgress(listener);
            cleanup();
            gm.emitProgress({ percent: 100 });
            expect(listener).not.toHaveBeenCalled();
        });

        it('handles listener errors gracefully', () => {
            gm.onProgress(() => { throw new Error('boom'); });
            expect(() => gm.emitProgress({ percent: 50 })).not.toThrow();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getSshPublicKey()
    // ═══════════════════════════════════════════════════════════════════

    describe('getSshPublicKey()', () => {
        it('returns { exists: false } when no key file', async () => {
            const result = await gm.getSshPublicKey();
            expect(result.exists).toBe(false);
        });

        it('returns public key when file exists', async () => {
            await fs.ensureDir(gm.sshKeyPath);
            await fs.writeFile(path.join(gm.sshKeyPath, 'devboxpro_rsa.pub'), 'ssh-ed25519 AAAA testkey');
            const result = await gm.getSshPublicKey();
            expect(result.exists).toBe(true);
            expect(result.publicKey).toContain('ssh-ed25519');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // isGitAvailable() — when gitPath is null
    // ═══════════════════════════════════════════════════════════════════

    describe('isGitAvailable()', () => {
        it('returns available shape when git is found on system', async () => {
            const result = await gm.isGitAvailable();
            // On CI or systems without git, this may return unavailable
            expect(result).toHaveProperty('available');
            expect(result).toHaveProperty('path');
            expect(result).toHaveProperty('source');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // cloneRepository() — without actual git
    // ═══════════════════════════════════════════════════════════════════

    describe('cloneRepository()', () => {
        it('returns error when git not available', async () => {
            gm.gitPath = null;
            const result = await gm.cloneRepository('https://github.com/user/repo.git', '/tmp/dest');
            expect(result.success).toBe(false);
            expect(result.error).toContain('not available');
        });

        it('rejects invalid URL', async () => {
            gm.gitPath = '/usr/bin/git'; // fake path
            const result = await gm.cloneRepository('invalid', '/tmp/dest');
            expect(result.success).toBe(false);
        });
    });
});
