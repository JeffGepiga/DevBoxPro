/**
 * Tests for src/shared/serviceConfig.js
 *
 * Phase 1 – Pure logic, zero mocks required.
 */
import { describe, it, expect } from 'vitest';

const {
    SERVICE_VERSIONS,
    VERSION_PORT_OFFSETS,
    DEFAULT_PORTS,
    SERVICE_INFO,
    getServicePort,
    getDefaultVersion,
} = require('../../src/shared/serviceConfig');

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE_VERSIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('SERVICE_VERSIONS', () => {
    const expectedServices = ['php', 'mysql', 'mariadb', 'redis', 'nginx', 'apache', 'nodejs', 'postgresql', 'python', 'mongodb', 'sqlite', 'minio', 'memcached'];

    it('contains all expected service keys', () => {
        for (const service of expectedServices) {
            expect(SERVICE_VERSIONS).toHaveProperty(service);
        }
    });

    it('each service has a non-empty array of version strings', () => {
        for (const [service, versions] of Object.entries(SERVICE_VERSIONS)) {
            expect(Array.isArray(versions), `${service} should be an array`).toBe(true);
            expect(versions.length, `${service} should not be empty`).toBeGreaterThan(0);
            for (const v of versions) {
                expect(typeof v, `${service} version entry should be a string`).toBe('string');
                expect(v.trim().length, `${service} version should not be blank`).toBeGreaterThan(0);
            }
        }
    });

    it('PHP versions include historically important entries', () => {
        expect(SERVICE_VERSIONS.php).toContain('8.5');
        expect(SERVICE_VERSIONS.php).toContain('8.4');
        expect(SERVICE_VERSIONS.php).toContain('7.4');
    });

    it('MySQL versions include both 8.x and 5.7', () => {
        expect(SERVICE_VERSIONS.mysql).toContain('8.0');
        expect(SERVICE_VERSIONS.mysql).toContain('5.7');
    });

    it('PostgreSQL versions include 17 and 14', () => {
        expect(SERVICE_VERSIONS.postgresql).toContain('17');
        expect(SERVICE_VERSIONS.postgresql).toContain('14');
    });

    it('MongoDB versions include 8.0 and 6.0', () => {
        expect(SERVICE_VERSIONS.mongodb).toContain('8.0');
        expect(SERVICE_VERSIONS.mongodb).toContain('6.0');
    });

    it('Python versions include 3.13 and 3.10', () => {
        expect(SERVICE_VERSIONS.python).toContain('3.13');
        expect(SERVICE_VERSIONS.python).toContain('3.10');
    });

    it('Memcached versions include 1.6', () => {
        expect(SERVICE_VERSIONS.memcached).toContain('1.6');
    });

    it('Node.js versions are in descending order', () => {
        const nums = SERVICE_VERSIONS.nodejs.map(Number);
        for (let i = 1; i < nums.length; i++) {
            expect(nums[i - 1]).toBeGreaterThan(nums[i]);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// VERSION_PORT_OFFSETS
// ═══════════════════════════════════════════════════════════════════════════════

describe('VERSION_PORT_OFFSETS', () => {
    it('all offset keys correspond to a key in SERVICE_VERSIONS', () => {
        for (const service of Object.keys(VERSION_PORT_OFFSETS)) {
            expect(SERVICE_VERSIONS).toHaveProperty(service);
        }
    });

    it('offset values are non-negative integers', () => {
        for (const [service, offsets] of Object.entries(VERSION_PORT_OFFSETS)) {
            for (const [version, offset] of Object.entries(offsets)) {
                expect(Number.isInteger(offset), `${service}@${version} offset should be integer`).toBe(true);
                expect(offset, `${service}@${version} offset should be >= 0`).toBeGreaterThanOrEqual(0);
            }
        }
    });

    it('offset versions match SERVICE_VERSIONS entries', () => {
        for (const [service, offsets] of Object.entries(VERSION_PORT_OFFSETS)) {
            for (const version of Object.keys(offsets)) {
                expect(
                    SERVICE_VERSIONS[service],
                    `${service}@${version} in offsets but not in SERVICE_VERSIONS`
                ).toContain(version);
            }
        }
    });

    it('each service has unique offset values (no port collisions)', () => {
        for (const [service, offsets] of Object.entries(VERSION_PORT_OFFSETS)) {
            const values = Object.values(offsets);
            const unique = new Set(values);
            expect(unique.size, `${service} has duplicate port offsets`).toBe(values.length);
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT_PORTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('DEFAULT_PORTS', () => {
    it('all port values are positive integers', () => {
        for (const [name, port] of Object.entries(DEFAULT_PORTS)) {
            expect(Number.isInteger(port), `${name} should be an integer`).toBe(true);
            expect(port, `${name} should be > 0`).toBeGreaterThan(0);
        }
    });

    it('well-known ports have expected values', () => {
        expect(DEFAULT_PORTS.mysql).toBe(3306);
        expect(DEFAULT_PORTS.redis).toBe(6379);
        expect(DEFAULT_PORTS.nginx).toBe(80);
        expect(DEFAULT_PORTS.phpmyadmin).toBe(8080);
    });

    it('MariaDB base port does not overlap with MySQL port range', () => {
        const mysqlMax = DEFAULT_PORTS.mysql + Math.max(
            ...Object.values(VERSION_PORT_OFFSETS.mysql)
        );
        expect(DEFAULT_PORTS.mariadb).toBeGreaterThan(mysqlMax);
    });

    it('all ports are unique across services', () => {
        const ports = Object.values(DEFAULT_PORTS);
        const unique = new Set(ports);
        expect(unique.size).toBe(ports.length);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE_INFO
// ═══════════════════════════════════════════════════════════════════════════════

describe('SERVICE_INFO', () => {
    it('every service in SERVICE_VERSIONS has a SERVICE_INFO entry', () => {
        for (const service of Object.keys(SERVICE_VERSIONS)) {
            expect(SERVICE_INFO, `Missing SERVICE_INFO for ${service}`).toHaveProperty(service);
        }
    });

    it('each entry has required fields: name, description, color, versioned', () => {
        for (const [service, info] of Object.entries(SERVICE_INFO)) {
            expect(info).toHaveProperty('name');
            expect(info).toHaveProperty('description');
            expect(info).toHaveProperty('color');
            expect(info).toHaveProperty('versioned');
            expect(typeof info.name).toBe('string');
            expect(typeof info.description).toBe('string');
            expect(typeof info.color).toBe('string');
            expect(typeof info.versioned).toBe('boolean');
        }
    });

    it('non-versioned services have a defaultPort and/or webUrl (unless embedded)', () => {
        for (const [service, info] of Object.entries(SERVICE_INFO)) {
            if (!info.versioned && !info.embedded) {
                expect(
                    info.defaultPort !== undefined || info.webUrl !== undefined,
                    `Non-versioned service ${service} should have defaultPort or webUrl`
                ).toBe(true);
            }
        }
    });

    it('mailpit and phpmyadmin have webUrl pointing to correct port', () => {
        expect(SERVICE_INFO.mailpit.webUrl).toContain(String(DEFAULT_PORTS.mailpit));
        expect(SERVICE_INFO.phpmyadmin.webUrl).toContain(String(DEFAULT_PORTS.phpmyadmin));
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getServicePort()
// ═══════════════════════════════════════════════════════════════════════════════

describe('getServicePort()', () => {
    it('returns correct port for known service + version', () => {
        // mysql 8.4 → 3306 + 0 = 3306
        expect(getServicePort('mysql', '8.4')).toBe(3306);
        // mysql 8.0 → 3306 + 1 = 3307
        expect(getServicePort('mysql', '8.0')).toBe(3307);
    });

    it('mysql 5.7 → 3306 + 2 = 3308', () => {
        expect(getServicePort('mysql', '5.7')).toBe(3308);
    });

    it('apache 2.4 → 8081 + 0 = 8081', () => {
        expect(getServicePort('apache', '2.4')).toBe(8081);
    });

    it('redis versions have correct port offsets', () => {
        expect(getServicePort('redis', '7.4')).toBe(6379);
        expect(getServicePort('redis', '7.2')).toBe(6380);
        expect(getServicePort('redis', '6.2')).toBe(6381);
    });

    it('nginx versions have correct port offsets', () => {
        expect(getServicePort('nginx', '1.28')).toBe(80);
        expect(getServicePort('nginx', '1.26')).toBe(81);
        expect(getServicePort('nginx', '1.24')).toBe(82);
    });

    it('mariadb versions have correct port offsets', () => {
        expect(getServicePort('mariadb', '11.4')).toBe(3310);
        expect(getServicePort('mariadb', '10.11')).toBe(3311);
        expect(getServicePort('mariadb', '10.6')).toBe(3312);
    });

    it('returns null for unknown service', () => {
        expect(getServicePort('unknown', '1.0')).toBeNull();
        expect(getServicePort('postgres', '16')).toBeNull();
    });

    it('falls back to offset 0 for unknown version of known service', () => {
        // redis has a default port, unknown version → offset 0
        expect(getServicePort('redis', 'nonexistent')).toBe(6379);
        expect(getServicePort('mysql', '99.99')).toBe(3306);
    });

    it('returns null when serviceName is null or undefined', () => {
        expect(getServicePort(null, null)).toBeNull();
        expect(getServicePort(undefined, undefined)).toBeNull();
    });

    it('returns null for services with no DEFAULT_PORTS entry (php, nodejs)', () => {
        // php and nodejs have no DEFAULT_PORTS entry
        expect(getServicePort('php', '8.4')).toBeNull();
        expect(getServicePort('nodejs', '20')).toBeNull();
    });

    it('returns base port for services without VERSION_PORT_OFFSETS (mailpit)', () => {
        expect(getServicePort('mailpit', 'any')).toBe(DEFAULT_PORTS.mailpit);
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getDefaultVersion()
// ═══════════════════════════════════════════════════════════════════════════════

describe('getDefaultVersion()', () => {
    it('returns the first version for known services', () => {
        expect(getDefaultVersion('php')).toBe('8.5');
        expect(getDefaultVersion('mysql')).toBe('8.4');
        expect(getDefaultVersion('mariadb')).toBe('11.4');
        expect(getDefaultVersion('redis')).toBe('7.4');
        expect(getDefaultVersion('nginx')).toBe('1.28');
        expect(getDefaultVersion('apache')).toBe('2.4');
        expect(getDefaultVersion('nodejs')).toBe('24');
    });

    it('returns null for unknown service', () => {
        expect(getDefaultVersion('unknown')).toBeNull();
        expect(getDefaultVersion('postgres')).toBeNull();
    });

    it('returns null for null/undefined input', () => {
        expect(getDefaultVersion(null)).toBeNull();
        expect(getDefaultVersion(undefined)).toBeNull();
    });

    it('returns null for empty string', () => {
        expect(getDefaultVersion('')).toBeNull();
    });
});
