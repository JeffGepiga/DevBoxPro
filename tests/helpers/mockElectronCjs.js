/**
 * Injects mock Electron modules into Node's require cache
 * so that CJS services can `require('electron')` without the real Electron.
 *
 * Must be called BEFORE requiring any source module that depends on Electron.
 *
 * Usage (at the top of a test file):
 *   require('../../helpers/mockElectronCjs');
 *   const MyService = require('../../../src/main/services/MyService');
 */
const os = require('os');
const path = require('path');

// Build a fake 'electron' module
const mockApp = {
    getPath: (name) => {
        const paths = {
            userData: path.join(os.tmpdir(), 'devboxpro-test-userdata'),
            home: os.homedir(),
            appData: path.join(os.tmpdir(), 'devboxpro-test-appdata'),
            temp: os.tmpdir(),
        };
        return paths[name] || path.join(os.tmpdir(), `devboxpro-test-${name}`);
    },
    getVersion: () => '1.0.0-test',
    isPackaged: false,
    quit: () => { },
    isQuitting: false,
    on: () => { },
};

const mockDialog = {
    showOpenDialog: async () => ({ canceled: false, filePaths: ['/mock/file'] }),
    showSaveDialog: async () => ({ canceled: false, filePath: '/mock/save' }),
    showMessageBox: async () => ({ response: 0 }),
    showErrorBox: () => { },
};

const mockShell = {
    openExternal: async () => { },
    openPath: async () => '',
    showItemInFolder: () => { },
};

const mockBrowserWindow = function () {
    return {
        loadURL: async () => { },
        on: () => { },
        once: () => { },
        show: () => { },
        hide: () => { },
        close: () => { },
        destroy: () => { },
        isDestroyed: () => false,
        webContents: { send: () => { }, on: () => { }, openDevTools: () => { } },
        setMenu: () => { },
    };
};
mockBrowserWindow.getAllWindows = () => [];

const mockIpcMain = {
    handle: () => { },
    on: () => { },
    removeHandler: () => { },
};

const electronModule = {
    app: mockApp,
    ipcMain: mockIpcMain,
    dialog: mockDialog,
    shell: mockShell,
    BrowserWindow: mockBrowserWindow,
    nativeImage: { createFromPath: () => ({}) },
    nativeTheme: { shouldUseDarkColors: false, themeSource: 'system' },
    Menu: { buildFromTemplate: () => ({}), setApplicationMenu: () => { } },
    Tray: function () { return { setToolTip: () => { }, setContextMenu: () => { }, on: () => { }, destroy: () => { } }; },
};

// Build a fake 'electron-updater' module
const mockAutoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: () => { },
    checkForUpdates: async () => null,
    downloadUpdate: async () => { },
    quitAndInstall: () => { },
};

const electronUpdaterModule = {
    autoUpdater: mockAutoUpdater,
};

// Inject into require cache
function injectModule(name, exports) {
    const resolvedPath = name; // Use the bare specifier
    const mod = new module.constructor();
    mod.id = name;
    mod.filename = name;
    mod.loaded = true;
    mod.exports = exports;
    require.cache[name] = mod;
}

// For `require('electron')` and `require('electron-updater')`
// Node resolves bare specifiers by looking them up in node_modules, which
// won't exist for Electron in a test environment. We need to intercept before
// that resolution happens. We do this by patching Module._resolveFilename.
const Module = require('module');
const _originalResolveFilename = Module._resolveFilename;

const MOCK_MODULES = {
    'electron': electronModule,
    'electron-updater': electronUpdaterModule,
};

Module._resolveFilename = function (request, parent, isMain, options) {
    if (MOCK_MODULES[request]) {
        return request; // Return bare name so cache lookup works
    }
    return _originalResolveFilename.call(this, request, parent, isMain, options);
};

// Pre-populate the cache
for (const [name, exports] of Object.entries(MOCK_MODULES)) {
    injectModule(name, exports);
}

// Export the mocks so tests can access them
module.exports = {
    mockApp,
    mockDialog,
    mockShell,
    mockAutoUpdater,
    electronModule,
    electronUpdaterModule,
};
