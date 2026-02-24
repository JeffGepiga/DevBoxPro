/**
 * Global test setup file.
 *
 * - Extends expect with jest-dom matchers for DOM assertions
 * - Sets up global window.devbox mock for renderer tests
 */
import '@testing-library/jest-dom';

// Mock window.devbox API for renderer tests (only in jsdom env)
if (typeof window !== 'undefined') {
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
