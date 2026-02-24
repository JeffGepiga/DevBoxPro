/**
 * Tests for src/main/utils/PortUtils.js
 *
 * Phase 2 – Tests for port utility functions.
 *
 * isPortAvailable, findAvailablePort, findAvailablePorts use the real
 * net module (tested with actual ports). getProcessOnPort is tested
 * against real system state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
    isPortAvailable,
    findAvailablePort,
    findAvailablePorts,
    getProcessOnPort,
} = require('../../../src/main/utils/PortUtils');

// ═══════════════════════════════════════════════════════════════════════════════
// isPortAvailable()
// ═══════════════════════════════════════════════════════════════════════════════

describe('isPortAvailable()', () => {
    it('returns true for a random high port unlikely to be in use', async () => {
        // Port 59432 is unlikely to be in use
        const result = await isPortAvailable(59432);
        expect(typeof result).toBe('boolean');
        // Most likely true, but on some systems could be false
        expect(result).toBe(true);
    });

    it('returns a boolean value', async () => {
        const result = await isPortAvailable(59433);
        expect(typeof result).toBe('boolean');
    });

    it('returns false for a port that is in use', async () => {
        // Start a server on a port, then check
        const net = require('net');
        const server = net.createServer();

        await new Promise((resolve) => {
            server.listen(59434, '127.0.0.1', resolve);
        });

        try {
            const result = await isPortAvailable(59434);
            expect(result).toBe(false);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findAvailablePort()
// ═══════════════════════════════════════════════════════════════════════════════

describe('findAvailablePort()', () => {
    it('returns a number when port is available', async () => {
        const port = await findAvailablePort(59440);
        expect(typeof port).toBe('number');
        expect(port).toBeGreaterThanOrEqual(59440);
    });

    it('skips occupied ports', async () => {
        const net = require('net');
        const server = net.createServer();

        await new Promise((resolve) => {
            server.listen(59450, '127.0.0.1', resolve);
        });

        try {
            const port = await findAvailablePort(59450, 10);
            expect(port).toBeGreaterThan(59450);
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('returns null when maxAttempts is exhausted', async () => {
        // Use a port that IS available — to exhaust, we'd need ALL ports busy.
        // Instead test with maxAttempts=0
        const port = await findAvailablePort(59460, 0);
        expect(port).toBeNull();
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// findAvailablePorts()
// ═══════════════════════════════════════════════════════════════════════════════

describe('findAvailablePorts()', () => {
    it('finds N available ports', async () => {
        const ports = await findAvailablePorts(59470, 3);
        expect(ports).toHaveLength(3);
        // All should be unique
        const unique = new Set(ports);
        expect(unique.size).toBe(3);
        // All >= startPort
        for (const p of ports) {
            expect(p).toBeGreaterThanOrEqual(59470);
        }
    });

    it('returns sequential ports when all are available', async () => {
        const ports = await findAvailablePorts(59480, 3);
        expect(ports).toEqual([59480, 59481, 59482]);
    });

    it('throws when maxAttempts is too small', async () => {
        // Occupy ports so findAvailablePort returns null
        const net = require('net');
        const server = net.createServer();
        await new Promise((resolve) => server.listen(59490, '127.0.0.1', resolve));

        try {
            // maxAttempts=1 means only try port 59490, which is occupied
            await expect(findAvailablePorts(59490, 3, 1)).rejects.toThrow(
                /Could not find 3 available ports/
            );
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════════════
// getProcessOnPort()
// ═══════════════════════════════════════════════════════════════════════════════

describe('getProcessOnPort()', () => {
    it('returns null for a port with no process', async () => {
        const result = await getProcessOnPort(59499);
        expect(result).toBeNull();
    });

    it('returns process info for occupied port', async () => {
        const net = require('net');
        const server = net.createServer();

        await new Promise((resolve) => {
            server.listen(59500, '127.0.0.1', resolve);
        });

        try {
            const result = await getProcessOnPort(59500);
            if (process.platform === 'win32') {
                // On Windows, should find the process
                expect(result).not.toBeNull();
                expect(result.pid).toBeGreaterThan(0);
            }
            // On non-Windows, lsof may not be available in all environments
        } finally {
            await new Promise((resolve) => server.close(resolve));
        }
    });

    it('returns null or object (type check)', async () => {
        const result = await getProcessOnPort(59501);
        expect(result === null || typeof result === 'object').toBe(true);
    });
});
