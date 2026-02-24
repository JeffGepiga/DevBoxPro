/**
 * Tests for src/main/services/CompatibilityManager.js
 *
 * Phase 3 – CompatibilityManager tests.
 * Tests pure logic (version comparison, condition evaluation, rule checking)
 * and file I/O (cached config) using temp files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';

const fs = require('fs-extra');
require('../../helpers/mockElectronCjs');
const CompatibilityManager = require('../../../src/main/services/CompatibilityManager');

describe('CompatibilityManager', () => {
    let cm;
    let tmpDir;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `compat-test-${Date.now()}`);
        await fs.ensureDir(tmpDir);
        cm = new CompatibilityManager();
        cm.localConfigPath = path.join(tmpDir, 'compat.json');
    });

    afterEach(async () => {
        await fs.remove(tmpDir).catch(() => { });
    });

    // ═══════════════════════════════════════════════════════════════════
    // isVersionNewer()
    // ═══════════════════════════════════════════════════════════════════

    describe('isVersionNewer()', () => {
        it('returns true when v1 major is greater', () => {
            expect(cm.isVersionNewer('2.0.0', '1.0.0')).toBe(true);
        });

        it('returns true when v1 minor is greater', () => {
            expect(cm.isVersionNewer('1.2.0', '1.1.0')).toBe(true);
        });

        it('returns true when v1 patch is greater', () => {
            expect(cm.isVersionNewer('1.0.2', '1.0.1')).toBe(true);
        });

        it('returns false when versions are equal', () => {
            expect(cm.isVersionNewer('1.2.3', '1.2.3')).toBe(false);
        });

        it('returns false when v1 is older', () => {
            expect(cm.isVersionNewer('1.0.0', '2.0.0')).toBe(false);
        });

        it('returns true when v2 is "built-in"', () => {
            expect(cm.isVersionNewer('1.0.0', 'built-in')).toBe(true);
        });

        it('returns true when v2 is null', () => {
            expect(cm.isVersionNewer('1.0.0', null)).toBe(true);
        });

        it('handles versions with different segment counts', () => {
            expect(cm.isVersionNewer('1.2', '1.1.9')).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // compareVersions()
    // ═══════════════════════════════════════════════════════════════════

    describe('compareVersions()', () => {
        it('returns -1 when v1 < v2', () => {
            expect(cm.compareVersions('5.7', '8.0')).toBe(-1);
        });

        it('returns 1 when v1 > v2', () => {
            expect(cm.compareVersions('8.4', '8.0')).toBe(1);
        });

        it('returns 0 when equal', () => {
            expect(cm.compareVersions('8.0', '8.0')).toBe(0);
        });

        it('returns 0 when either is null', () => {
            expect(cm.compareVersions(null, '8.0')).toBe(0);
        });

        it('handles multi-segment versions', () => {
            expect(cm.compareVersions('8.0.30', '8.0.29')).toBe(1);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getMajorVersion()
    // ═══════════════════════════════════════════════════════════════════

    describe('getMajorVersion()', () => {
        it('returns major from "8.3"', () => {
            expect(cm.getMajorVersion('8.3')).toBe(8);
        });

        it('returns major from "8.0.30"', () => {
            expect(cm.getMajorVersion('8.0.30')).toBe(8);
        });

        it('returns 0 for null/undefined', () => {
            expect(cm.getMajorVersion(null)).toBe(0);
            expect(cm.getMajorVersion(undefined)).toBe(0);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // evaluateCondition()
    // ═══════════════════════════════════════════════════════════════════

    describe('evaluateCondition()', () => {
        it('any=true returns true when value exists', () => {
            expect(cm.evaluateCondition('8.3', { any: true })).toBe(true);
        });

        it('any=true returns false when value is null', () => {
            expect(cm.evaluateCondition(null, { any: true })).toBe(false);
        });

        it('exact match succeeds', () => {
            expect(cm.evaluateCondition('8.3', { exact: '8.3' })).toBe(true);
        });

        it('exact match fails', () => {
            expect(cm.evaluateCondition('8.2', { exact: '8.3' })).toBe(false);
        });

        it('min only — value meets threshold', () => {
            expect(cm.evaluateCondition('8.3', { min: '8.0' })).toBe(true);
        });

        it('min only — value below threshold', () => {
            expect(cm.evaluateCondition('7.4', { min: '8.0' })).toBe(false);
        });

        it('max only — value within limit', () => {
            expect(cm.evaluateCondition('7.4', { max: '8.0' })).toBe(true);
        });

        it('max only — value exceeds limit', () => {
            expect(cm.evaluateCondition('8.3', { max: '8.0' })).toBe(false);
        });

        it('min + max range — value inside', () => {
            expect(cm.evaluateCondition('8.1', { min: '8.0', max: '8.3' })).toBe(true);
        });

        it('min + max range — value outside', () => {
            expect(cm.evaluateCondition('7.4', { min: '8.0', max: '8.3' })).toBe(false);
        });

        it('returns false when value is null with min/max', () => {
            expect(cm.evaluateCondition(null, { min: '8.0' })).toBe(false);
        });

        it('returns false for unknown condition type', () => {
            expect(cm.evaluateCondition('8.0', { unknown: true })).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getConfigValue()
    // ═══════════════════════════════════════════════════════════════════

    describe('getConfigValue()', () => {
        const config = {
            phpVersion: '8.3',
            nodeVersion: '20',
            type: 'laravel',
            webServer: 'nginx',
            webServerVersion: '1.26',
            services: { mysql: '8.4', redis: '7.2' },
        };

        it('returns phpVersion', () => {
            expect(cm.getConfigValue(config, 'phpVersion')).toBe('8.3');
        });

        it('returns nodeVersion for "nodejs" key', () => {
            expect(cm.getConfigValue(config, 'nodejs')).toBe('20');
        });

        it('returns mysql from services', () => {
            expect(cm.getConfigValue(config, 'mysql')).toBe('8.4');
        });

        it('returns redis from services', () => {
            expect(cm.getConfigValue(config, 'redis')).toBe('7.2');
        });

        it('returns nginx version when webServer is nginx', () => {
            expect(cm.getConfigValue(config, 'nginx')).toBe('1.26');
        });

        it('returns projectType for "projectType" key', () => {
            expect(cm.getConfigValue(config, 'projectType')).toBe('laravel');
        });

        it('returns undefined for missing service', () => {
            expect(cm.getConfigValue(config, 'mariadb')).toBeUndefined();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // interpolateMessage()
    // ═══════════════════════════════════════════════════════════════════

    describe('interpolateMessage()', () => {
        it('replaces all placeholders', () => {
            const config = {
                phpVersion: '8.3',
                nodeVersion: '20',
                type: 'laravel',
                webServer: 'nginx',
                webServerVersion: '1.26',
                services: { mysql: '8.4' },
            };
            const msg = '{phpVersion} + MySQL {mysqlVersion} on {webServer} {webServerVersion}';
            const result = cm.interpolateMessage(msg, config);
            expect(result).toBe('8.3 + MySQL 8.4 on nginx 1.26');
        });

        it('replaces missing values with empty string', () => {
            const config = { phpVersion: '8.3', services: {} };
            const msg = 'MySQL {mysqlVersion} version';
            expect(cm.interpolateMessage(msg, config)).toBe('MySQL  version');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // createRuleChecker()
    // ═══════════════════════════════════════════════════════════════════

    describe('createRuleChecker()', () => {
        it('creates a function that checks conditions', () => {
            const rule = {
                conditions: { phpVersion: { min: '8.0' }, mysql: { any: true } },
                result: {
                    level: 'warning',
                    message: 'PHP {phpVersion} + MySQL {mysqlVersion}',
                    suggestion: 'Upgrade',
                },
            };
            const checker = cm.createRuleChecker(rule);
            const result = checker({ phpVersion: '8.3', services: { mysql: '8.4' } });
            expect(result).not.toBeNull();
            expect(result.level).toBe('warning');
            expect(result.message).toContain('8.3');
        });

        it('returns null when conditions not met', () => {
            const rule = {
                conditions: { phpVersion: { min: '9.0' } },
                result: { level: 'info', message: 'test', suggestion: '' },
            };
            const checker = cm.createRuleChecker(rule);
            expect(checker({ phpVersion: '8.3' })).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // checkCompatibility() — built-in rules
    // ═══════════════════════════════════════════════════════════════════

    describe('checkCompatibility()', () => {
        it('returns valid with no issues for compatible config', () => {
            const result = cm.checkCompatibility({
                phpVersion: '8.3',
                type: 'laravel',
                services: { mysql: '8.4' },
            });
            expect(result.valid).toBe(true);
        });

        it('returns shape with valid, warnings, errors, hasIssues', () => {
            const result = cm.checkCompatibility({ phpVersion: '8.3', services: {} });
            expect(result).toHaveProperty('valid');
            expect(result).toHaveProperty('warnings');
            expect(result).toHaveProperty('errors');
            expect(result).toHaveProperty('hasIssues');
        });

        it('detects PHP 7.4 EOL warning', () => {
            const result = cm.checkCompatibility({ phpVersion: '7.4', services: {} });
            const eol = result.warnings.find((w) => w.id === 'php74-deprecated');
            expect(eol).toBeDefined();
            expect(eol.message).toContain('end-of-life');
        });

        it('detects PHP 8.0 EOL warning', () => {
            const result = cm.checkCompatibility({ phpVersion: '8.0', services: {} });
            const eol = result.warnings.find((w) => w.id === 'php80-deprecated');
            expect(eol).toBeDefined();
        });

        it('detects MySQL/MariaDB port conflict', () => {
            const result = cm.checkCompatibility({
                phpVersion: '8.3',
                services: { mysql: '8.4', mariadb: '11.4' },
            });
            const conflict = result.warnings.find((w) => w.id === 'mysql-mariadb-conflict');
            expect(conflict).toBeDefined();
        });

        it('detects Laravel PHP version requirement', () => {
            const result = cm.checkCompatibility({
                phpVersion: '8.1',
                type: 'laravel',
                services: {},
            });
            const laravel = result.warnings.find((w) => w.id === 'laravel-php-version');
            expect(laravel).toBeDefined();
            expect(laravel.message).toContain('Laravel 11 requires PHP 8.2');
        });

        it('detects Redis PHP extension note', () => {
            const result = cm.checkCompatibility({
                phpVersion: '8.3',
                services: { redis: '7.2' },
            });
            const redis = result.warnings.find((w) => w.id === 'redis-php-extension');
            expect(redis).toBeDefined();
        });

        it('detects PHP 8 + MySQL 5.7 auth issue', () => {
            const result = cm.checkCompatibility({
                phpVersion: '8.3',
                services: { mysql: '5.7' },
            });
            const auth = result.warnings.find((w) => w.id === 'php8-mysql57-auth');
            expect(auth).toBeDefined();
            expect(auth.message).toContain('legacy authentication');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // hasKnownIssues()
    // ═══════════════════════════════════════════════════════════════════

    describe('hasKnownIssues()', () => {
        it('returns true for PHP 8 + MySQL 5.7', () => {
            expect(cm.hasKnownIssues('8.3', 'mysql', '5.7')).toBe(true);
        });

        it('returns false for PHP 8 + MySQL 8.4', () => {
            expect(cm.hasKnownIssues('8.3', 'mysql', '8.4')).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // compareConfigs()
    // ═══════════════════════════════════════════════════════════════════

    describe('compareConfigs()', () => {
        it('detects new rules', () => {
            const remote = {
                version: '2.0.0',
                rules: [{ id: 'brand-new-rule', name: 'New Rule' }],
            };
            const result = cm.compareConfigs(remote);
            expect(result.newRules).toHaveLength(1);
            expect(result.newRules[0].id).toBe('brand-new-rule');
        });

        it('detects updated rules (existing ID in remote)', () => {
            const remote = {
                version: '2.0.0',
                rules: [{ id: 'php74-deprecated', name: 'PHP 7.4 EOL Updated' }],
            };
            const result = cm.compareConfigs(remote);
            expect(result.updatedRules.some((r) => r.id === 'php74-deprecated')).toBe(true);
        });

        it('detects version change', () => {
            cm.configVersion = '1.0.0';
            const result = cm.compareConfigs({ version: '2.0.0', rules: [] });
            expect(result.versionChange).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // saveCachedConfig / loadCachedConfig
    // ═══════════════════════════════════════════════════════════════════

    describe('saveCachedConfig()', () => {
        it('writes config to file', async () => {
            const config = { version: '1.0.0', rules: [] };
            const result = await cm.saveCachedConfig(config);
            expect(result).toBe(true);
            expect(await fs.pathExists(cm.localConfigPath)).toBe(true);
        });
    });

    describe('loadCachedConfig()', () => {
        it('loads saved config and applies rules', async () => {
            const config = {
                version: '2.0.0',
                rules: [
                    {
                        id: 'test-cached-rule',
                        name: 'Test Cached',
                        enabled: true,
                        conditions: { phpVersion: { min: '8.0' } },
                        result: { level: 'info', message: 'Cached rule', suggestion: '' },
                    },
                ],
            };
            await fs.writeJson(cm.localConfigPath, { config }, { spaces: 2 });
            const loaded = await cm.loadCachedConfig();
            expect(loaded).toBe(true);
            expect(cm.configVersion).toBe('2.0.0');
            expect(cm.rules.some((r) => r.id === 'test-cached-rule')).toBe(true);
        });

        it('returns false when no cached file', async () => {
            expect(await cm.loadCachedConfig()).toBe(false);
        });

        it('handles corrupted cache file gracefully', async () => {
            await fs.writeFile(cm.localConfigPath, 'not json!!!');
            expect(await cm.loadCachedConfig()).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getConfigInfo / getDeprecationInfo / getFrameworkRequirements
    // ═══════════════════════════════════════════════════════════════════

    describe('getConfigInfo()', () => {
        it('returns correct shape', () => {
            const info = cm.getConfigInfo();
            expect(info).toHaveProperty('version');
            expect(info).toHaveProperty('ruleCount');
            expect(info).toHaveProperty('lastCheck');
            expect(info).toHaveProperty('hasRemoteConfig');
            expect(info.version).toBe('built-in');
            expect(info.ruleCount).toBeGreaterThan(0);
        });
    });

    describe('getDeprecationInfo()', () => {
        it('returns null when no deprecation info', () => {
            expect(cm.getDeprecationInfo('php', '8.3')).toBeNull();
        });
    });

    describe('getFrameworkRequirements()', () => {
        it('returns null when no framework requirements', () => {
            expect(cm.getFrameworkRequirements('laravel', '11')).toBeNull();
        });
    });

    describe('getRules()', () => {
        it('returns array of rule definitions with id and name', () => {
            const rules = cm.getRules();
            expect(Array.isArray(rules)).toBe(true);
            expect(rules.length).toBeGreaterThan(0);
            expect(rules[0]).toHaveProperty('id');
            expect(rules[0]).toHaveProperty('name');
        });
    });
});
