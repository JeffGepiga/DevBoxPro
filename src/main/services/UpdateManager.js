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
     * Fetch the list of GitHub releases for version history / rollback
     * @returns {Promise<Object>} List of releases
     */
    async fetchReleasesHistory() {
        const https = require('https');
        const currentVersion = app.getVersion();
        const owner = 'JeffGepiga';
        const repo = 'DevBoxPro';

        return new Promise((resolve) => {
            const options = {
                hostname: 'api.github.com',
                path: `/repos/${owner}/${repo}/releases?per_page=15`,
                headers: {
                    'User-Agent': 'DevBoxPro-App',
                    'Accept': 'application/vnd.github.v3+json',
                },
            };

            const req = https.get(options, (res) => {
                let data = '';
                res.on('data', (chunk) => { data += chunk; });
                res.on('end', () => {
                    try {
                        const releases = JSON.parse(data);
                        if (!Array.isArray(releases)) {
                            resolve({ success: false, error: releases.message || 'Failed to fetch releases', releases: [] });
                            return;
                        }
                        const formatted = releases.map((release) => ({
                            version: release.tag_name.replace(/^v/, ''),
                            tagName: release.tag_name,
                            releaseName: release.name || release.tag_name,
                            releaseDate: release.published_at,
                            releaseNotes: release.body || '',
                            isCurrent: release.tag_name.replace(/^v/, '') === currentVersion,
                            isPrerelease: release.prerelease,
                            assets: release.assets.map((a) => ({
                                name: a.name,
                                downloadUrl: a.browser_download_url,
                                size: a.size,
                            })),
                        }));
                        resolve({ success: true, releases: formatted, currentVersion });
                    } catch (err) {
                        resolve({ success: false, error: 'Failed to parse releases response', releases: [] });
                    }
                });
            });

            req.on('error', (err) => {
                resolve({ success: false, error: err.message, releases: [] });
            });

            req.setTimeout(15000, () => {
                req.destroy();
                resolve({ success: false, error: 'Request timed out', releases: [] });
            });
        });
    }

    /**
     * Download and install a specific version (rollback or manual version install)
     * @param {string} version - Version string (e.g., "1.2.0")
     * @param {string} downloadUrl - Direct download URL for the installer asset
     * @returns {Promise<Object>} Result
     */
    async downloadAndInstallVersion(version, downloadUrl) {
        if (!app.isPackaged) {
            return { success: false, error: 'Cannot install versions in development mode' };
        }

        const path = require('path');
        const fs = require('fs');
        const os = require('os');

        const ext = path.extname(new URL(downloadUrl).pathname) || '.exe';
        const fileName = `DevBoxPro-rollback-${version}${ext}`;
        const destPath = path.join(os.tmpdir(), fileName);

        return new Promise((resolve) => {
            const file = fs.createWriteStream(destPath);

            const downloadWithRedirects = (url, redirectCount = 0) => {
                if (redirectCount > 5) {
                    resolve({ success: false, error: 'Too many redirects during download' });
                    return;
                }

                const urlObj = new URL(url);
                const mod = urlObj.protocol === 'https:' ? require('https') : require('http');

                mod.get(url, { headers: { 'User-Agent': 'DevBoxPro-App' } }, (res) => {
                    if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
                        downloadWithRedirects(res.headers.location, redirectCount + 1);
                        return;
                    }

                    if (res.statusCode !== 200) {
                        file.close();
                        fs.unlink(destPath, () => {});
                        resolve({ success: false, error: `Download failed with status ${res.statusCode}` });
                        return;
                    }

                    const total = parseInt(res.headers['content-length'] || '0', 10);
                    let downloaded = 0;

                    res.on('data', (chunk) => {
                        downloaded += chunk.length;
                        if (total > 0) {
                            this._sendEvent('update:rollbackProgress', {
                                percent: (downloaded / total) * 100,
                                downloaded,
                                total,
                            });
                        }
                    });

                    res.pipe(file);

                    file.on('finish', () => {
                        file.close();
                        this.managers?.log?.systemInfo?.(`Rollback installer downloaded: ${destPath}`);

                        const { spawn } = require('child_process');
                        app.isQuitting = true;

                        if (process.platform === 'win32') {
                            spawn(destPath, ['/S'], {
                                detached: true,
                                stdio: 'ignore',
                                windowsHide: false,
                            }).unref();
                        } else if (process.platform === 'darwin') {
                            const { shell } = require('electron');
                            shell.openPath(destPath);
                        }

                        setTimeout(() => app.quit(), 1500);
                        resolve({ success: true });
                    });

                    file.on('error', (err) => {
                        fs.unlink(destPath, () => {});
                        resolve({ success: false, error: err.message });
                    });
                }).on('error', (err) => {
                    fs.unlink(destPath, () => {});
                    resolve({ success: false, error: err.message });
                });
            };

            downloadWithRedirects(downloadUrl);
        });
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
