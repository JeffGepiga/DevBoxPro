/**
 * Reusable Electron API mocks for testing main process modules.
 *
 * Usage:
 *   vi.mock('electron', () => require('../../tests/helpers/mockElectron').electronMock);
 *   vi.mock('electron-updater', () => require('../../tests/helpers/mockElectron').electronUpdaterMock);
 */
import { vi } from 'vitest';

// ── electron mock ────────────────────────────────────────────────────────────

export const appMock = {
    getPath: vi.fn((name) => {
        const paths = {
            userData: '/mock/userData',
            home: '/mock/home',
            appData: '/mock/appData',
            temp: '/mock/temp',
        };
        return paths[name] || `/mock/${name}`;
    }),
    getVersion: vi.fn(() => '1.0.0-test'),
    isPackaged: false,
    quit: vi.fn(),
    isQuitting: false,
    requestSingleInstanceLock: vi.fn(() => true),
    whenReady: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
};

export const ipcMainMock = {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
};

export const dialogMock = {
    showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: ['/mock/file'] })),
    showSaveDialog: vi.fn(() => Promise.resolve({ canceled: false, filePath: '/mock/save' })),
    showMessageBox: vi.fn(() => Promise.resolve({ response: 0 })),
    showErrorBox: vi.fn(),
};

export const shellMock = {
    openExternal: vi.fn(() => Promise.resolve()),
    openPath: vi.fn(() => Promise.resolve('')),
    showItemInFolder: vi.fn(),
};

export const BrowserWindowMock = vi.fn().mockImplementation(() => ({
    loadURL: vi.fn(() => Promise.resolve()),
    loadFile: vi.fn(() => Promise.resolve()),
    on: vi.fn(),
    once: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    close: vi.fn(),
    destroy: vi.fn(),
    isDestroyed: vi.fn(() => false),
    webContents: {
        send: vi.fn(),
        on: vi.fn(),
        openDevTools: vi.fn(),
    },
    setMenu: vi.fn(),
}));
BrowserWindowMock.getAllWindows = vi.fn(() => []);

export const nativeImageMock = {
    createFromPath: vi.fn(() => ({})),
};

export const nativeThemeMock = {
    shouldUseDarkColors: false,
    themeSource: 'system',
};

export const MenuMock = {
    buildFromTemplate: vi.fn(() => ({})),
    setApplicationMenu: vi.fn(),
};

export const TrayMock = vi.fn().mockImplementation(() => ({
    setToolTip: vi.fn(),
    setContextMenu: vi.fn(),
    on: vi.fn(),
    destroy: vi.fn(),
}));

export const electronMock = {
    app: appMock,
    ipcMain: ipcMainMock,
    dialog: dialogMock,
    shell: shellMock,
    BrowserWindow: BrowserWindowMock,
    nativeImage: nativeImageMock,
    nativeTheme: nativeThemeMock,
    Menu: MenuMock,
    Tray: TrayMock,
};

// ── electron-updater mock ────────────────────────────────────────────────────

export const autoUpdaterMock = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(() => Promise.resolve(null)),
    downloadUpdate: vi.fn(() => Promise.resolve()),
    quitAndInstall: vi.fn(),
};

export const electronUpdaterMock = {
    autoUpdater: autoUpdaterMock,
};

// ── electron-store mock ──────────────────────────────────────────────────────

export function createMockStore(defaults = {}) {
    const data = { ...defaults };

    return vi.fn().mockImplementation(() => ({
        get: vi.fn((key) => {
            const keys = key.split('.');
            let value = data;
            for (const k of keys) {
                if (value && typeof value === 'object' && k in value) {
                    value = value[k];
                } else {
                    return undefined;
                }
            }
            return value;
        }),
        set: vi.fn((key, value) => {
            const keys = key.split('.');
            let obj = data;
            for (let i = 0; i < keys.length - 1; i++) {
                if (!(keys[i] in obj)) obj[keys[i]] = {};
                obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = value;
        }),
        delete: vi.fn((key) => {
            delete data[key];
        }),
        has: vi.fn((key) => key in data),
        clear: vi.fn(() => {
            for (const key of Object.keys(data)) {
                delete data[key];
            }
        }),
        store: data,
    }));
}
