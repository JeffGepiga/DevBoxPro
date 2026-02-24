/**
 * Tests for src/shared/appConfig.js
 *
 * Phase 1 – Verifies exported shape.
 * Build-time constants are injected via vitest.config.js define.
 */
import { describe, it, expect } from 'vitest';
import { APP_VERSION, APP_NAME } from '../../src/shared/appConfig';
import appConfig from '../../src/shared/appConfig';

describe('appConfig exports', () => {
    describe('APP_VERSION', () => {
        it('is a string', () => {
            expect(typeof APP_VERSION).toBe('string');
        });

        it('is non-empty', () => {
            expect(APP_VERSION.length).toBeGreaterThan(0);
        });

        it('matches the vitest-defined test value', () => {
            // Vitest config defines __APP_VERSION__ as '1.0.0-test'
            expect(APP_VERSION).toBe('1.0.0-test');
        });
    });

    describe('APP_NAME', () => {
        it('is "DevBox Pro"', () => {
            expect(APP_NAME).toBe('DevBox Pro');
        });
    });

    describe('default export', () => {
        it('has version and name keys', () => {
            expect(appConfig).toHaveProperty('version');
            expect(appConfig).toHaveProperty('name');
        });

        it('version matches APP_VERSION', () => {
            expect(appConfig.version).toBe(APP_VERSION);
        });

        it('name matches APP_NAME', () => {
            expect(appConfig.name).toBe(APP_NAME);
        });
    });
});
