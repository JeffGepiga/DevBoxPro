/**
 * Renderer-specific test setup.
 *
 * Sets up jest-dom matchers and window.devbox mock for renderer tests.
 * This is separate from the main setup.js because the renderer project
 * uses different resolve aliases that can conflict with the main setup.
 */
import '@testing-library/jest-dom';

// Mock window.devbox API for renderer tests
if (typeof window !== 'undefined') {
    // Suppress specific harmless React/Router warnings from cluttering the test output
    const originalConsoleError = console.error;
    console.error = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('Warning: An update to')) return;
        if (typeof args[0] === 'string' && args[0].includes('Warning: A component is changing')) return;
        if (typeof args[0] === 'string' && args[0].includes('useModal must be used within a ModalProvider')) return;
        originalConsoleError(...args);
    };

    const originalConsoleWarn = console.warn;
    console.warn = (...args) => {
        if (typeof args[0] === 'string' && args[0].includes('React Router Future Flag Warning')) return;
        originalConsoleWarn(...args);
    };

    // Filter out the intentional 'useModal must be used within a ModalProvider' error
    // which React throws to the uncaughtException listener in Node/JSDOM environments
    const isModalError = (err) => {
        if (!err) return false;
        if (err.message && err.message.includes('useModal must be used within a ModalProvider')) return true;
        if (err.error && err.error.message && err.error.message.includes('useModal must be used within a ModalProvider')) return true;
        return false;
    };

    if (typeof window !== 'undefined') {
        const originalDispatch = window.dispatchEvent;
        window.dispatchEvent = function (event) {
            if (event.type === 'error' && isModalError(event)) {
                event.preventDefault();
                return false;
            }
            return originalDispatch.call(this, event);
        };
    }

    window.devbox = {
        projects: {
            getAll: async () => [],
            getById: async () => null,
            create: async () => ({}),
            update: async () => ({}),
            delete: async () => ({}),
            start: async () => ({}),
            stop: async () => ({}),
            restart: async () => ({}),
            getStatus: async () => ({}),
            openInEditor: async () => ({}),
            openInBrowser: async () => ({}),
            openFolder: async () => ({}),
            move: async () => ({}),
            switchWebServer: async () => ({}),
            regenerateVhost: async () => ({}),
            scanUnregistered: async () => [],
            registerExisting: async () => ({}),
            detectType: async () => 'generic',
            exportConfig: async () => ({}),
            getServiceVersions: async () => ({}),
            updateServiceVersions: async () => ({}),
            checkCompatibility: async () => ({ warnings: [] }),
            getCompatibilityRules: async () => ({}),
            readEnv: async () => '',
        },
        compatibility: {
            checkForUpdates: async () => ({}),
            applyUpdates: async () => ({}),
            getConfigInfo: async () => ({}),
        },
        php: {
            getVersions: async () => [],
            getExtensions: async () => [],
            toggleExtension: async () => ({}),
            runCommand: async () => ({}),
            runArtisan: async () => ({}),
        },
        services: {
            getStatus: async () => ({}),
            start: async () => ({}),
            stop: async () => ({}),
            restart: async () => ({}),
            startAll: async () => ({}),
            stopAll: async () => ({}),
            getResourceUsage: async () => ({ total: { cpu: 0, memory: 0 }, services: {} }),
            getRunningVersions: async () => [],
            isVersionRunning: async () => false,
            getWebServerPorts: async () => ({}),
            getProjectNetworkPort: async () => null,
        },
        database: {
            getConnections: async () => [],
            getDatabases: async () => [],
            createDatabase: async () => ({}),
            deleteDatabase: async () => ({}),
            importDatabase: async () => ({}),
            exportDatabase: async () => ({}),
            runQuery: async () => ({}),
        },
        binaries: {
            getInstalled: async () => ({}),
            getServiceConfig: async () => ({}),
            download: async () => ({}),
            cancelDownload: async () => ({}),
            uninstall: async () => ({}),
            getActiveDownloads: async () => ({}),
        },
        settings: {
            getAll: async () => ({ settings: {} }),
            update: async () => ({}),
            reset: async () => ({}),
            exportConfig: async () => ({}),
            importConfig: async () => ({}),
        },
        logs: {
            getAll: async () => [],
            getProject: async () => [],
            getService: async () => [],
            getSystem: async () => [],
            clear: async () => ({}),
        },
        git: {
            isAvailable: async () => ({ available: false }),
            validateUrl: async () => ({ valid: false }),
            clone: async () => ({}),
            getSshPublicKey: async () => ({ exists: false }),
            generateSshKey: async () => ({}),
            testAuth: async () => ({}),
        },
        updates: {
            check: async () => ({}),
            download: async () => ({}),
            install: async () => ({}),
            getStatus: async () => ({}),
        },
        system: {
            getInfo: async () => ({}),
            openExternal: async () => ({}),
        },
    };
}
