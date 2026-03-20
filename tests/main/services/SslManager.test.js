/**
 * Tests for src/main/services/SslManager.js
 *
 * Phase 3 – SslManager tests. Tests path construction, trust instructions,
 * status shape, and certificate CRUD with real node-forge crypto + temp dirs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import os from 'os';
import forge from 'node-forge';

const fs = require('fs-extra');
require('../../helpers/mockElectronCjs');
const { SslManager } = require('../../../src/main/services/SslManager');

describe('SslManager', () => {
    let ssl;
    let tmpDir;
    let mockConfigStore;
    let configData;

    beforeEach(async () => {
        tmpDir = path.join(os.tmpdir(), `sslmgr-test-${Date.now()}`);
        await fs.ensureDir(tmpDir);

        configData = {};
        mockConfigStore = {
            get: vi.fn((key, def) => configData[key] !== undefined ? configData[key] : def),
            set: vi.fn((key, val) => { configData[key] = val; }),
        };

        ssl = new SslManager(tmpDir, mockConfigStore, {});
        ssl.certsPath = path.join(tmpDir, 'certs');
        ssl.caPath = path.join(tmpDir, 'ca');
        await fs.ensureDir(ssl.certsPath);
        await fs.ensureDir(ssl.caPath);
    });

    afterEach(async () => {
        await fs.remove(tmpDir).catch(() => { });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════════

    describe('constructor', () => {
        it('initializes with null CA state', () => {
            expect(ssl.caKey).toBeNull();
            expect(ssl.caCert).toBeNull();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getTrustInstructions()
    // ═══════════════════════════════════════════════════════════════════

    describe('getTrustInstructions()', () => {
        it('returns a string with instructions', () => {
            const instructions = ssl.getTrustInstructions();
            expect(typeof instructions).toBe('string');
            expect(instructions).toContain('DevBox Pro');
        });

        it('includes the CA cert path', () => {
            const instructions = ssl.getTrustInstructions();
            expect(instructions).toContain('rootCA.pem');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getStatus()
    // ═══════════════════════════════════════════════════════════════════

    describe('getStatus()', () => {
        it('returns correct shape', () => {
            const status = ssl.getStatus();
            expect(status).toHaveProperty('initialized');
            expect(status).toHaveProperty('certsPath');
            expect(status).toHaveProperty('caPath');
        });

        it('reports uninitialized when no CA', () => {
            expect(ssl.getStatus().initialized).toBe(false);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // isAvailable()
    // ═══════════════════════════════════════════════════════════════════

    describe('isAvailable()', () => {
        it('returns false when CA not initialized', () => {
            expect(ssl.isAvailable()).toBe(false);
        });

        it('returns true after CA is created', async () => {
            await ssl.createRootCA();
            expect(ssl.isAvailable()).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // createRootCA()
    // ═══════════════════════════════════════════════════════════════════

    describe('createRootCA()', () => {
        it('generates CA key and cert PEM files', async () => {
            const result = await ssl.createRootCA();
            expect(result).toHaveProperty('keyPath');
            expect(result).toHaveProperty('certPath');
            expect(await fs.pathExists(result.keyPath)).toBe(true);
            expect(await fs.pathExists(result.certPath)).toBe(true);
        });

        it('sets in-memory caKey and caCert', async () => {
            await ssl.createRootCA();
            expect(ssl.caKey).not.toBeNull();
            expect(ssl.caCert).not.toBeNull();
        });

        it('status becomes initialized after creation', async () => {
            await ssl.createRootCA();
            expect(ssl.getStatus().initialized).toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // createCertificate()
    // ═══════════════════════════════════════════════════════════════════

    describe('createCertificate()', () => {
        it('throws when CA not initialized', async () => {
            await expect(ssl.createCertificate(['example.test'])).rejects.toThrow('Root CA not initialized');
        });

        it('generates domain cert + key files', async () => {
            await ssl.createRootCA();
            const result = await ssl.createCertificate(['example.test']);
            expect(result.domain).toBe('example.test');
            expect(await fs.pathExists(result.certPath)).toBe(true);
            expect(await fs.pathExists(result.keyPath)).toBe(true);
        });

        it('stores certificate info in configStore', async () => {
            await ssl.createRootCA();
            await ssl.createCertificate(['site.test']);
            expect(mockConfigStore.set).toHaveBeenCalledWith('certificates', expect.objectContaining({
                'site.test': expect.objectContaining({
                    domains: ['site.test'],
                }),
            }));
        });

        it('handles multiple domains (SANs)', async () => {
            await ssl.createRootCA();
            const result = await ssl.createCertificate(['example.test', '*.example.test']);
            expect(result.domains).toEqual(['example.test', '*.example.test']);
        });

        it('writes an authority key identifier that matches the current root CA', async () => {
            await ssl.createRootCA();
            const result = await ssl.createCertificate(['example.test']);

            const certPem = await fs.readFile(result.certPath, 'utf8');
            const leafCert = forge.pki.certificateFromPem(certPem);

            expect(ssl.getAuthorityKeyIdentifierHex(leafCert)).toBe(
                ssl.getSubjectKeyIdentifierHex(ssl.caCert)
            );
        });

        it('throws for empty domains array', async () => {
            await ssl.createRootCA();
            await expect(ssl.createCertificate([])).rejects.toThrow('At least one domain');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getCertificate() / getCertificatePaths()
    // ═══════════════════════════════════════════════════════════════════

    describe('getCertificate()', () => {
        it('returns null when no certificate stored', () => {
            expect(ssl.getCertificate('unknown.test')).toBeNull();
        });

        it('returns stored certificate info', async () => {
            await ssl.createRootCA();
            await ssl.createCertificate(['mysite.test']);
            const cert = ssl.getCertificate('mysite.test');
            expect(cert).not.toBeNull();
            expect(cert.domains).toEqual(['mysite.test']);
        });
    });

    describe('getCertificatePaths()', () => {
        it('returns null when no certificate exists', () => {
            expect(ssl.getCertificatePaths('missing.test')).toBeNull();
        });

        it('returns key and cert paths when certificate exists', async () => {
            await ssl.createRootCA();
            await ssl.createCertificate(['paths.test']);
            const paths = ssl.getCertificatePaths('paths.test');
            expect(paths).not.toBeNull();
            expect(paths.key).toContain('key.pem');
            expect(paths.cert).toContain('cert.pem');
        });
    });

    describe('certificateMatchesCurrentCA()', () => {
        it('rejects legacy certificates whose authority key identifier points at the leaf key', async () => {
            await ssl.createRootCA();

            const domainDir = path.join(tmpDir, 'example.test');
            await fs.ensureDir(domainDir);

            const leafKeys = forge.pki.rsa.generateKeyPair(2048);
            const cert = forge.pki.createCertificate();
            cert.publicKey = leafKeys.publicKey;
            cert.serialNumber = '02';
            cert.validity.notBefore = new Date();
            cert.validity.notAfter = new Date();
            cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + 30);
            cert.setSubject([{ name: 'commonName', value: 'example.test' }]);
            cert.setIssuer(ssl.caCert.subject.attributes);
            cert.setExtensions([
                { name: 'basicConstraints', cA: false },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, nonRepudiation: true },
                { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
                { name: 'subjectAltName', altNames: [{ type: 2, value: 'example.test' }] },
                { name: 'subjectKeyIdentifier' },
                { name: 'authorityKeyIdentifier', keyIdentifier: true },
            ]);
            cert.sign(ssl.caKey, forge.md.sha256.create());

            await fs.writeFile(path.join(domainDir, 'cert.pem'), forge.pki.certificateToPem(cert));
            await fs.writeFile(path.join(domainDir, 'key.pem'), forge.pki.privateKeyToPem(leafKeys.privateKey));

            await expect(ssl.certificateMatchesCurrentCA('example.test')).resolves.toBe(false);
        });

        it('accepts certificates issued by the current root CA', async () => {
            await ssl.createRootCA();
            await ssl.createCertificate(['example.test']);

            await expect(ssl.certificateMatchesCurrentCA('example.test')).resolves.toBe(true);
        });

        it('reuses cached authority-match results when the certificate file is unchanged', async () => {
            await ssl.createRootCA();
            const result = await ssl.createCertificate(['example.test']);
            const readFileSpy = vi.spyOn(fs, 'readFile');

            await expect(ssl.certificateMatchesCurrentCA('example.test')).resolves.toBe(true);
            const readsAfterFirstCheck = readFileSpy.mock.calls.filter(([filePath]) => filePath === result.certPath).length;

            await expect(ssl.certificateMatchesCurrentCA('example.test')).resolves.toBe(true);
            const readsAfterSecondCheck = readFileSpy.mock.calls.filter(([filePath]) => filePath === result.certPath).length;

            expect(readsAfterFirstCheck).toBeGreaterThan(0);
            expect(readsAfterSecondCheck).toBe(readsAfterFirstCheck);
        });
    });

    describe('repairCertificates()', () => {
        it('regenerates stored certificates that do not match the current root CA', async () => {
            await ssl.createRootCA();

            const domainDir = path.join(tmpDir, 'example.test');
            await fs.ensureDir(domainDir);

            const leafKeys = forge.pki.rsa.generateKeyPair(2048);
            const cert = forge.pki.createCertificate();
            cert.publicKey = leafKeys.publicKey;
            cert.serialNumber = '02';
            cert.validity.notBefore = new Date();
            cert.validity.notAfter = new Date();
            cert.validity.notAfter.setDate(cert.validity.notBefore.getDate() + 30);
            cert.setSubject([{ name: 'commonName', value: 'example.test' }]);
            cert.setIssuer(ssl.caCert.subject.attributes);
            cert.setExtensions([
                { name: 'basicConstraints', cA: false },
                { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, nonRepudiation: true },
                { name: 'extKeyUsage', serverAuth: true, clientAuth: true },
                { name: 'subjectAltName', altNames: [{ type: 2, value: 'example.test' }] },
                { name: 'subjectKeyIdentifier' },
                { name: 'authorityKeyIdentifier', keyIdentifier: true },
            ]);
            cert.sign(ssl.caKey, forge.md.sha256.create());

            await fs.writeFile(path.join(domainDir, 'cert.pem'), forge.pki.certificateToPem(cert));
            await fs.writeFile(path.join(domainDir, 'key.pem'), forge.pki.privateKeyToPem(leafKeys.privateKey));
            mockConfigStore.set('certificates', {
                'example.test': {
                    domains: ['example.test'],
                    certPath: path.join(domainDir, 'cert.pem'),
                    keyPath: path.join(domainDir, 'key.pem'),
                },
            });

            await ssl.repairCertificates();

            await expect(ssl.certificateMatchesCurrentCA('example.test')).resolves.toBe(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // deleteCertificate()
    // ═══════════════════════════════════════════════════════════════════

    describe('deleteCertificate()', () => {
        it('removes cert files and config entry', async () => {
            await ssl.createRootCA();
            const created = await ssl.createCertificate(['todelete.test']);
            expect(await fs.pathExists(created.certPath)).toBe(true);

            const result = await ssl.deleteCertificate('todelete.test');
            expect(result.success).toBe(true);
            expect(await fs.pathExists(created.certPath)).toBe(false);
        });

        it('throws when certificate not found', async () => {
            await expect(ssl.deleteCertificate('nonexistent.test')).rejects.toThrow('not found');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // listCertificates()
    // ═══════════════════════════════════════════════════════════════════

    describe('listCertificates()', () => {
        it('returns empty object when no certificates', () => {
            const certs = ssl.listCertificates();
            expect(certs).toEqual({});
        });

        it('returns stored certificates after creation', async () => {
            await ssl.createRootCA();
            await ssl.createCertificate(['site1.test']);
            await ssl.createCertificate(['site2.test']);
            const certs = ssl.listCertificates();
            expect(Object.keys(certs).length).toBe(2);
            expect(certs['site1.test']).toBeDefined();
            expect(certs['site2.test']).toBeDefined();
        });
    });
});
