import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
const path = require('path');
const fs = require('fs-extra');
const https = require('https');
const http = require('http');

// Provide Electron mock
require('../../helpers/mockElectronCjs');

// Mock specific internal utilities
vi.mock('../../../src/main/utils/SpawnUtils', () => ({
    spawnAsync: vi.fn()
}));

// Import the manager
const BinaryDownloadManager = require('../../../src/main/services/BinaryDownloadManager');

describe('BinaryDownloadManager', () => {
    let mgr;
    let mockManagers = {};

    beforeEach(() => {
        // Reset all mocks
        vi.clearAllMocks();

        mockManagers = {
            log: { systemError: vi.fn(), systemWarn: vi.fn(), systemInfo: vi.fn() }
        };

        // Spy on fs-extra
        vi.spyOn(fs, 'ensureDir').mockResolvedValue();
        vi.spyOn(fs, 'pathExists').mockResolvedValue(true);
        vi.spyOn(fs, 'readdir').mockResolvedValue([]);
        vi.spyOn(fs, 'readFile').mockResolvedValue('');
        vi.spyOn(fs, 'writeFile').mockResolvedValue();
        vi.spyOn(fs, 'readJson').mockResolvedValue({ config: { version: '1.0.0' } });
        vi.spyOn(fs, 'writeJson').mockResolvedValue();
        vi.spyOn(fs, 'remove').mockResolvedValue();

        mgr = new BinaryDownloadManager();
        mgr.managers = mockManagers;

        // Disable immediate progress throttling for test ease
        mgr.progressThrottleMs = 0;
        mgr.progressMinDelta = 0;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('Initialization', () => {
        it('ensures resource directories exist', async () => {
            vi.spyOn(mgr, 'loadCachedConfig').mockResolvedValue(true);
            vi.spyOn(mgr, 'enablePhpExtensions').mockResolvedValue();

            await mgr.initialize();

            expect(fs.ensureDir).toHaveBeenCalled();
            expect(fs.ensureDir).toHaveBeenCalledWith(mgr.resourcesPath);
            expect(mgr.loadCachedConfig).toHaveBeenCalled();
        });
    });

    describe('Config and Versioning', () => {
        it('compares versions correctly with isVersionNewer', () => {
            expect(mgr.isVersionNewer('1.0.1', '1.0.0')).toBe(true);
            expect(mgr.isVersionNewer('1.1.0', '1.0.9')).toBe(true);
            expect(mgr.isVersionNewer('2.0.0', '1.9.9')).toBe(true);
            expect(mgr.isVersionNewer('1.0.0', '1.0.0')).toBe(false);
            expect(mgr.isVersionNewer('0.9.9', '1.0.0')).toBe(false);
        });

        it('fetches remote config successfully', async () => {
            const mockConfig = { version: '2.0.0', downloads: {} };
            vi.spyOn(https, 'get').mockImplementation((url, options, cb) => {
                const res = {
                    statusCode: 200,
                    on: vi.fn((event, handler) => {
                        if (event === 'data') handler(JSON.stringify(mockConfig));
                        if (event === 'end') handler();
                    })
                };
                cb(res);
                return { on: vi.fn() };
            });

            const result = await mgr.fetchRemoteConfig();
            expect(result.version).toBe('2.0.0');
        });

        it('handles remote config fetch failure', async () => {
            vi.spyOn(https, 'get').mockImplementation((url, options, cb) => {
                const res = { statusCode: 404, on: vi.fn() };
                cb(res);
                return { on: vi.fn() };
            });

            await expect(mgr.fetchRemoteConfig()).rejects.toThrow('HTTP 404');
        });
    });

    describe('Binary Detection', () => {
        it('returns installed binaries', async () => {
            // Mock platform
            vi.spyOn(mgr, 'getPlatform').mockReturnValue('win');

            // Re-mock paths for PHP to simulate installed version
            vi.spyOn(fs, 'readdir').mockImplementation(async (dir) => {
                if (dir.includes('php')) return ['8.4'];
                return [];
            });
            vi.spyOn(fs, 'pathExists').mockImplementation(async (checkPath) => {
                if (checkPath.includes('php.exe') || checkPath.includes('php-cgi.exe')) return true;
                return false;
            });

            const installed = await mgr.getInstalledBinaries();
            expect(installed.php['8.4']).toBe(true);
        });
    });

    describe('Downloading and Cancellation', () => {
        it('downloads a file successfully', async () => {
            const destPath = path.join(__dirname, 'dummy_download.zip');

            vi.spyOn(https, 'get').mockImplementation((url, options, cb) => {
                const res = {
                    statusCode: 200,
                    headers: { 'content-length': '100' },
                    on: vi.fn((event, handler) => {
                        if (event === 'data') handler(Buffer.from('chunk')); // Simulate data
                    }),
                    pipe: vi.fn((fileStream) => {
                        // Manually write to the stream to simulate piping
                        fileStream.write(Buffer.from('chunk'));
                        fileStream.end();
                    })
                };
                cb(res);
                return { on: vi.fn(), destroy: vi.fn() };
            });

            const result = await mgr.downloadFile('https://example.com/file.zip', destPath, 'dl-1');
            expect(result).toBe(destPath);
            expect(mgr.activeDownloads.has('dl-1')).toBe(false);

            // Clean up
            await fs.remove(destPath);
        });

        it('cancels an active download', () => {
            const requestMock = { destroy: vi.fn() };
            const fileMock = { close: vi.fn() };

            mgr.activeDownloads.set('dl-2', {
                request: requestMock,
                file: fileMock,
                destPath: '/dummy/cancel.zip'
            });

            // For fs.unlink
            const nodeFs = require('fs');
            if (nodeFs.unlink) {
                vi.spyOn(nodeFs, 'unlink').mockImplementation((path, cb) => cb());
            }

            const cancelled = mgr.cancelDownload('dl-2');
            expect(cancelled).toBe(true);
            expect(requestMock.destroy).toHaveBeenCalled();
            expect(fileMock.close).toHaveBeenCalled();
            expect(mgr.cancelledDownloads.has('dl-2')).toBe(true);
        });
    });

    describe('Archive Extraction', () => {
        it('extracts a tar archive', async () => {
            const tar = require('tar');
            vi.spyOn(tar, 'x').mockResolvedValue();

            await mgr.extractArchive('file.tar.gz', '/dest/path', 'dl-tar');
            expect(tar.x).toHaveBeenCalledWith({
                file: 'file.tar.gz',
                cwd: '/dest/path',
                strip: 1
            });
        });

        it('extracts a zip archive using worker thread', async () => {
            vi.spyOn(mgr, 'validateZipFile').mockResolvedValue(true);
            vi.spyOn(mgr, 'extractZipAsync').mockResolvedValue();

            await mgr.extractArchive('file.zip', '/dest/path', 'dl-zip');
            expect(mgr.validateZipFile).toHaveBeenCalled();
            expect(mgr.extractZipAsync).toHaveBeenCalledWith('file.zip', '/dest/path', 'dl-zip');
        });

        it('handles zip validation failure', async () => {
            vi.spyOn(mgr, 'validateZipFile').mockResolvedValue(false);
            vi.spyOn(fs, 'readFile').mockResolvedValue('<!doctype html> error page');

            await expect(mgr.extractArchive('file.zip', '/dest/path', 'dl-err'))
                .rejects.toThrow('Downloaded file is HTML instead of ZIP');
        });
    });

    describe('Progress Tracking', () => {
        it('emits progress and respects throttling', () => {
            mgr.progressThrottleMs = 1000; // 1 second
            mgr.progressMinDelta = 10;

            const listener = vi.fn();
            mgr.addProgressListener(listener);

            // Initial emit (should pass)
            mgr.emitProgress('dl-prog', { status: 'downloading', progress: 5 });
            expect(listener).toHaveBeenCalledTimes(1);

            // Immediate small progress (should be throttled)
            mgr.emitProgress('dl-prog', { status: 'downloading', progress: 6 });
            expect(listener).toHaveBeenCalledTimes(1);

            // Large progress (should pass delta check)
            mgr.emitProgress('dl-prog', { status: 'downloading', progress: 20 });
            expect(listener).toHaveBeenCalledTimes(2);

            // Completed status (always passes)
            mgr.emitProgress('dl-prog', { status: 'completed', progress: 100 });
            expect(listener).toHaveBeenCalledTimes(3);
        });
    });
});
