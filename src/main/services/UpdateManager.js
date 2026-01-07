/**
 * UpdateManager - Handles application auto-updates using electron-updater
 * 
 * Uses GitHub Releases as the update source (configured in electron-builder.config.js)
 */

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

class UpdateManager {
    constructor(managers) {
        this.managers = managers;
        this.mainWindow = null;
        this.updateInfo = null;
        this.downloadProgress = null;
        this.isCheckingForUpdate = false;
        this.isDownloading = false;
        this.updateDownloaded = false;

        // Configure auto-updater
        autoUpdater.autoDownload = false; // We'll trigger download manually
        autoUpdater.autoInstallOnAppQuit = true;

        // Set up event handlers
        this._setupEventHandlers();
    }

    /**
     * Set the main window reference for sending IPC events
     */
    setMainWindow(mainWindow) {
        this.mainWindow = mainWindow;
    }

    /**
     * Initialize the update manager
     */
    async initialize() {
        // Log initialization
        this.managers?.log?.systemInfo?.('UpdateManager initialized');
    }

    /**
     * Set up auto-updater event handlers
     */
    _setupEventHandlers() {
        autoUpdater.on('checking-for-update', () => {
            this.isCheckingForUpdate = true;
            this._sendEvent('update:status', { status: 'checking' });
        });

        autoUpdater.on('update-available', (info) => {
            this.isCheckingForUpdate = false;
            this.updateInfo = info;
            this._sendEvent('update:status', {
                status: 'available',
                info: {
                    version: info.version,
                    releaseDate: info.releaseDate,
                    releaseNotes: info.releaseNotes,
                }
            });
        });

        autoUpdater.on('update-not-available', (info) => {
            this.isCheckingForUpdate = false;
            this.updateInfo = null;
            this._sendEvent('update:status', {
                status: 'not-available',
                currentVersion: app.getVersion()
            });
        });

        autoUpdater.on('download-progress', (progress) => {
            this.isDownloading = true;
            this.downloadProgress = progress;
            this._sendEvent('update:progress', {
                percent: progress.percent,
                bytesPerSecond: progress.bytesPerSecond,
                transferred: progress.transferred,
                total: progress.total,
            });
        });

        autoUpdater.on('update-downloaded', (info) => {
            this.isDownloading = false;
            this.updateDownloaded = true;
            this.downloadProgress = null;
            this._sendEvent('update:status', {
                status: 'downloaded',
                info: {
                    version: info.version,
                    releaseDate: info.releaseDate,
                }
            });
        });

        autoUpdater.on('error', (error) => {
            this.isCheckingForUpdate = false;
            this.isDownloading = false;
            this._sendEvent('update:status', {
                status: 'error',
                error: error.message || 'Unknown error occurred'
            });
            this.managers?.log?.systemError?.('Auto-updater error', { error: error.message });
        });
    }

    /**
     * Send an event to the renderer process
     */
    _sendEvent(channel, data) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send(channel, data);
        }
    }

    /**
     * Check for updates
     * @returns {Promise<Object>} Update check result
     */
    async checkForUpdates() {
        try {
            // In development, there's no update to check
            if (!app.isPackaged) {
                return {
                    success: true,
                    updateAvailable: false,
                    currentVersion: app.getVersion(),
                    message: 'Update checking is disabled in development mode'
                };
            }

            this.isCheckingForUpdate = true;
            const result = await autoUpdater.checkForUpdates();

            if (result && result.updateInfo) {
                const hasUpdate = result.updateInfo.version !== app.getVersion();
                return {
                    success: true,
                    updateAvailable: hasUpdate,
                    currentVersion: app.getVersion(),
                    latestVersion: result.updateInfo.version,
                    releaseDate: result.updateInfo.releaseDate,
                    releaseNotes: result.updateInfo.releaseNotes,
                };
            }

            return {
                success: true,
                updateAvailable: false,
                currentVersion: app.getVersion(),
            };
        } catch (error) {
            this.isCheckingForUpdate = false;
            return {
                success: false,
                error: error.message || 'Failed to check for updates',
                currentVersion: app.getVersion(),
            };
        }
    }

    /**
     * Download the available update
     * @returns {Promise<Object>} Download result
     */
    async downloadUpdate() {
        try {
            if (!this.updateInfo) {
                return {
                    success: false,
                    error: 'No update available to download'
                };
            }

            if (!app.isPackaged) {
                return {
                    success: false,
                    error: 'Cannot download updates in development mode'
                };
            }

            this.isDownloading = true;
            await autoUpdater.downloadUpdate();

            return {
                success: true,
                message: 'Update downloaded successfully'
            };
        } catch (error) {
            this.isDownloading = false;
            return {
                success: false,
                error: error.message || 'Failed to download update'
            };
        }
    }

    /**
     * Install the downloaded update and restart the app
     */
    quitAndInstall() {
        if (this.updateDownloaded) {
            // Set the quitting flag so graceful shutdown proceeds
            app.isQuitting = true;
            autoUpdater.quitAndInstall(false, true);
        }
    }

    /**
     * Get the current update status
     * @returns {Object} Current status
     */
    getStatus() {
        return {
            currentVersion: app.getVersion(),
            isCheckingForUpdate: this.isCheckingForUpdate,
            isDownloading: this.isDownloading,
            updateDownloaded: this.updateDownloaded,
            updateInfo: this.updateInfo ? {
                version: this.updateInfo.version,
                releaseDate: this.updateInfo.releaseDate,
                releaseNotes: this.updateInfo.releaseNotes,
            } : null,
            downloadProgress: this.downloadProgress,
            isDevelopment: !app.isPackaged,
        };
    }
}

module.exports = { UpdateManager };
