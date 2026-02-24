/**
 * Tests for src/main/services/UpdateManager.js
 *
 * Phase 3 – UpdateManager tests. Tests state management, event handler setup,
 * and method behavior in different states. Uses mock electron-updater injected
 * via mockElectronCjs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAutoUpdater } = require('../../helpers/mockElectronCjs');
const { UpdateManager } = require('../../../src/main/services/UpdateManager');

describe('UpdateManager', () => {
    let um;
    let mockManagers;

    beforeEach(() => {
        // Reset autoUpdater mock
        mockAutoUpdater.on = vi.fn();
        mockAutoUpdater.checkForUpdates = vi.fn(async () => null);
        mockAutoUpdater.downloadUpdate = vi.fn(async () => { });
        mockAutoUpdater.quitAndInstall = vi.fn();

        mockManagers = {
            log: {
                systemInfo: vi.fn(),
                systemError: vi.fn(),
            },
        };
        um = new UpdateManager(mockManagers);
    });

    // ═══════════════════════════════════════════════════════════════════
    // Constructor
    // ═══════════════════════════════════════════════════════════════════

    describe('constructor', () => {
        it('initializes default state', () => {
            expect(um.isCheckingForUpdate).toBe(false);
            expect(um.isDownloading).toBe(false);
            expect(um.updateDownloaded).toBe(false);
            expect(um.updateInfo).toBeNull();
            expect(um.downloadProgress).toBeNull();
        });

        it('sets up autoUpdater event handlers', () => {
            expect(mockAutoUpdater.on).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // setMainWindow()
    // ═══════════════════════════════════════════════════════════════════

    describe('setMainWindow()', () => {
        it('stores window reference', () => {
            const mockWindow = { webContents: { send: vi.fn() } };
            um.setMainWindow(mockWindow);
            expect(um.mainWindow).toBe(mockWindow);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // initialize()
    // ═══════════════════════════════════════════════════════════════════

    describe('initialize()', () => {
        it('logs initialization', async () => {
            await um.initialize();
            expect(mockManagers.log.systemInfo).toHaveBeenCalledWith('UpdateManager initialized');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // checkForUpdates()
    // ═══════════════════════════════════════════════════════════════════

    describe('checkForUpdates()', () => {
        it('returns disabled message in dev mode (isPackaged=false)', async () => {
            const result = await um.checkForUpdates();
            expect(result.success).toBe(true);
            expect(result.updateAvailable).toBe(false);
            expect(result.message).toContain('disabled in development');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // downloadUpdate()
    // ═══════════════════════════════════════════════════════════════════

    describe('downloadUpdate()', () => {
        it('returns error when no update available', async () => {
            const result = await um.downloadUpdate();
            expect(result.success).toBe(false);
            expect(result.error).toContain('No update available');
        });

        it('returns error in dev mode', async () => {
            um.updateInfo = { version: '2.0.0' };
            const result = await um.downloadUpdate();
            expect(result.success).toBe(false);
            expect(result.error).toContain('development mode');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // quitAndInstall()
    // ═══════════════════════════════════════════════════════════════════

    describe('quitAndInstall()', () => {
        it('does nothing when update not downloaded', () => {
            um.updateDownloaded = false;
            um.quitAndInstall();
            expect(mockAutoUpdater.quitAndInstall).not.toHaveBeenCalled();
        });

        it('calls autoUpdater when update downloaded', () => {
            um.updateDownloaded = true;
            um.quitAndInstall();
            expect(mockAutoUpdater.quitAndInstall).toHaveBeenCalled();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // getStatus()
    // ═══════════════════════════════════════════════════════════════════

    describe('getStatus()', () => {
        it('returns correct shape with defaults', () => {
            const status = um.getStatus();
            expect(status.currentVersion).toBe('1.0.0-test');
            expect(status.isCheckingForUpdate).toBe(false);
            expect(status.isDownloading).toBe(false);
            expect(status.updateDownloaded).toBe(false);
            expect(status.updateInfo).toBeNull();
            expect(status.downloadProgress).toBeNull();
            expect(status.isDevelopment).toBe(true);
        });

        it('includes update info when available', () => {
            um.updateInfo = { version: '2.0.0', releaseDate: '2025-01-01', releaseNotes: 'Fix' };
            const status = um.getStatus();
            expect(status.updateInfo).toEqual({
                version: '2.0.0',
                releaseDate: '2025-01-01',
                releaseNotes: 'Fix',
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // _sendEvent()
    // ═══════════════════════════════════════════════════════════════════

    describe('_sendEvent()', () => {
        it('sends to window when available', () => {
            const mockWindow = {
                isDestroyed: () => false,
                webContents: { send: vi.fn() },
            };
            um.mainWindow = mockWindow;
            um._sendEvent('update:status', { status: 'checking' });
            expect(mockWindow.webContents.send).toHaveBeenCalledWith('update:status', { status: 'checking' });
        });

        it('no-ops when window is null', () => {
            um.mainWindow = null;
            expect(() => um._sendEvent('update:status', {})).not.toThrow();
        });

        it('no-ops when window is destroyed', () => {
            um.mainWindow = { isDestroyed: () => true, webContents: { send: vi.fn() } };
            um._sendEvent('update:status', {});
            expect(um.mainWindow.webContents.send).not.toHaveBeenCalled();
        });
    });
});
