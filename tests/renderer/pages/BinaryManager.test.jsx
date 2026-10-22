/**
 * Tests for src/renderer/src/pages/BinaryManager.jsx
 *
 * Phase 5 – Structure tests for BinaryManager page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    binaries: {
        getStatus: vi.fn().mockResolvedValue({
            php: {},
            nginx: {},
            apache: {},
            mysql: {},
            mariadb: {},
            redis: {},
            nodejs: {},
            phpmyadmin: {},
            mailpit: {},
        }),
        install: vi.fn().mockResolvedValue({}),
        uninstall: vi.fn().mockResolvedValue({}),
        getInstalledBinaries: vi.fn().mockResolvedValue({ php: {}, nginx: {}, mysql: {}, mariadb: {}, redis: {} }),
        getInstalled: vi.fn().mockResolvedValue({}),
        getDownloadUrls: vi.fn().mockResolvedValue({}),
        getServiceConfig: vi.fn().mockResolvedValue({}),
        importBinary: vi.fn().mockResolvedValue({ success: true }),
        checkForServiceUpdates: vi.fn().mockResolvedValue({
            composer: { updateAvailable: false },
            phpmyadmin: { updateAvailable: false },
            cloudflared: { updateAvailable: false },
            zrok: { updateAvailable: false },
        }),
        downloadCloudflared: vi.fn().mockResolvedValue({ success: true }),
        downloadZrok: vi.fn().mockResolvedValue({ success: true }),
        downloadGit: vi.fn().mockResolvedValue({ success: true }),
        getAllPhpVersionDetails: vi.fn().mockResolvedValue({}),
        checkPhpModifications: vi.fn().mockResolvedValue({ hasModifications: false, modifiedFiles: [] }),
        getRunningConflicts: vi.fn().mockResolvedValue({ hasConflicts: false, items: [] }),
        updatePhp: vi.fn().mockResolvedValue({ success: true }),
        onProgress: vi.fn().mockImplementation(() => vi.fn()),
    },
    system: {
        openExternal: vi.fn(),
        selectFile: vi.fn().mockResolvedValue(null),
    },
    git: {
        isAvailable: vi.fn().mockResolvedValue({ available: false, source: null, version: null }),
    },
    tunnel: {
        zrokStatus: vi.fn().mockResolvedValue({ enabled: false, configuredAt: null }),
        zrokEnable: vi.fn().mockResolvedValue({ success: true }),
    },
};

const appContextMock = {
    projects: [],
    loading: false,
    services: {},
    downloading: {},
    downloadProgress: {},
    projectLoadingStates: {},
    setDownloading: vi.fn(),
    setDownloadProgress: vi.fn(),
    clearDownload: vi.fn(),
    refreshServices: vi.fn(),
};

const modalMock = {
    showAlert: vi.fn(),
    showConfirm: vi.fn().mockResolvedValue(false),
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.binaries.getStatus.mockResolvedValue({ php: {}, nginx: {}, apache: {}, mysql: {}, mariadb: {}, redis: {}, nodejs: {}, phpmyadmin: {}, mailpit: {} });
    mockDevbox.git.isAvailable.mockResolvedValue({ available: false, source: null, version: null });
    mockDevbox.binaries.getInstalled.mockResolvedValue({});
    mockDevbox.system.selectFile.mockResolvedValue(null);
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => appContextMock,
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => modalMock,
}));

import BinaryManager from '@/pages/BinaryManager';

describe('BinaryManager', () => {
    it('renders page heading', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );
        await act(async () => { });
        expect(document.body.textContent.toLowerCase()).toMatch(/binary|binaries|manager/i);
    });

    it('shows category tabs (PHP, Nginx, MySQL, etc.)', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );
        await act(async () => { });
        // Should have some section labels about binaries
        expect(document.body.textContent).toBeTruthy();
    });

    it('shows Git in tools and starts the portable Git download', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        fireEvent.click(await screen.findByRole('button', { name: /Tools/i }));

        const gitName = await screen.findByText('Git');
        const gitRow = gitName.closest('div.flex.items-center.justify-between');
        const gitDownloadButton = gitRow ? within(gitRow).getByRole('button', { name: /Download/i }) : null;

        expect(gitDownloadButton).toBeTruthy();
        fireEvent.click(gitDownloadButton);

        await waitFor(() => {
            expect(mockDevbox.binaries.downloadGit).toHaveBeenCalledTimes(1);
        });
    });

    it('preserves the ts suffix when importing a PHP archive', async () => {
        mockDevbox.system.selectFile.mockResolvedValueOnce('C:\\Downloads\\php-8.4.21-ts-Win32-vs17-x64.zip');

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        const importButtons = await screen.findAllByRole('button', { name: /Import ZIP/i });
        fireEvent.click(importButtons[0]);

        expect(await screen.findByText(/Detected version:/i)).toBeInTheDocument();
        expect(screen.getByText(/8\.4\.21 TS/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));

        await waitFor(() => {
            expect(mockDevbox.binaries.importBinary).toHaveBeenCalledWith(
                'php',
                '8.4.21-ts',
                'C:\\Downloads\\php-8.4.21-ts-Win32-vs17-x64.zip'
            );
        });
    });

    it('treats official Windows TS PHP zip names without an explicit ts suffix as thread-safe', async () => {
        mockDevbox.system.selectFile.mockResolvedValueOnce('C:\\Downloads\\php-8.3.31-Win32-vs16-x64.zip');

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        const importButtons = await screen.findAllByRole('button', { name: /Import ZIP/i });
        fireEvent.click(importButtons[0]);

        expect(await screen.findByText(/Detected version:/i)).toBeInTheDocument();
        expect(screen.getByText(/8\.3\.31 TS/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));

        await waitFor(() => {
            expect(mockDevbox.binaries.importBinary).toHaveBeenCalledWith(
                'php',
                '8.3.31-ts',
                'C:\\Downloads\\php-8.3.31-Win32-vs16-x64.zip'
            );
        });
    });

    it('keeps patch-level NTS imports as distinct PHP versions', async () => {
        mockDevbox.system.selectFile.mockResolvedValueOnce('C:\\Downloads\\php-8.2.28-nts-Win32-vs17-x64.zip');

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        const importButtons = await screen.findAllByRole('button', { name: /Import ZIP/i });
        fireEvent.click(importButtons[0]);

        const detectedVersionLine = await screen.findByText(/Detected version:/i);
        expect(detectedVersionLine).toBeInTheDocument();
        expect(within(detectedVersionLine).getByText(/8\.2\.28/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));

        await waitFor(() => {
            expect(mockDevbox.binaries.importBinary).toHaveBeenCalledWith(
                'php',
                '8.2.28',
                'C:\\Downloads\\php-8.2.28-nts-Win32-vs17-x64.zip'
            );
        });
    });

    it('shows tunnel tools and downloads cloudflared', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        fireEvent.click(await screen.findByRole('button', { name: /Tools/i }));

        const cloudflareName = await screen.findByText('Cloudflare Tunnel');
        const row = cloudflareName.closest('div.flex.items-center.justify-between');
        const downloadButton = row ? within(row).getByRole('button', { name: /Download/i }) : null;

        expect(downloadButton).toBeTruthy();
        fireEvent.click(downloadButton);

        await waitFor(() => {
            expect(mockDevbox.binaries.downloadCloudflared).toHaveBeenCalledTimes(1);
        });
    });

    it('enables zrok app-wide from the tools tab', async () => {
        mockDevbox.binaries.getInstalled.mockResolvedValue({ zrok: true });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        fireEvent.click(await screen.findByRole('button', { name: /Tools/i }));

        fireEvent.click(await screen.findByRole('button', { name: /Configure zrok app-wide setup/i }));

        expect(await screen.findByText('zrok App-Wide Setup')).toBeInTheDocument();
        expect(screen.getByText(/Sign in at myzrok\.io/i)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Open myzrok\.io/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Open API Console/i })).toBeInTheDocument();

        fireEvent.change(await screen.findByPlaceholderText(/Paste your zrok enable token/i), {
            target: { value: 'zrok-token-123' },
        });

        fireEvent.click(screen.getByRole('button', { name: /Enable zrok/i }));

        await waitFor(() => {
            expect(mockDevbox.tunnel.zrokEnable).toHaveBeenCalledWith('zrok-token-123');
        });
    });

    it('opens the zrok token help links from the setup modal', async () => {
        mockDevbox.binaries.getInstalled.mockResolvedValue({ zrok: true });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        fireEvent.click(await screen.findByRole('button', { name: /Tools/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Configure zrok app-wide setup/i }));

        fireEvent.click(await screen.findByRole('button', { name: /Open myzrok\.io/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Open API Console/i }));

        expect(mockDevbox.system.openExternal).toHaveBeenCalledWith('https://myzrok.io/');
        expect(mockDevbox.system.openExternal).toHaveBeenCalledWith('https://api-v2.zrok.io/');
    });

    it('shows tunnel update checks when the binaries are installed', async () => {
        mockDevbox.binaries.getInstalled.mockResolvedValue({ cloudflared: true, zrok: true });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        fireEvent.click(await screen.findByRole('button', { name: /Tools/i }));

        const cloudflareRow = (await screen.findByText('Cloudflare Tunnel')).closest('div.flex.items-center.justify-between');
        const zrokRow = (await screen.findByText('zrok')).closest('div.flex.items-center.justify-between');

        expect(cloudflareRow ? within(cloudflareRow).getByRole('button', { name: /Check Updates/i }) : null).toBeTruthy();
        expect(zrokRow ? within(zrokRow).getByRole('button', { name: /Check Updates/i }) : null).toBeTruthy();
        expect(zrokRow ? within(zrokRow).getByRole('button', { name: /Configure zrok app-wide setup/i }) : null).toBeTruthy();

        fireEvent.click(within(cloudflareRow).getByRole('button', { name: /Check Updates/i }));

        await waitFor(() => {
            expect(mockDevbox.binaries.checkForServiceUpdates).toHaveBeenCalledTimes(1);
        });
    });

    it('treats system Git as available without showing a remove action', async () => {
        mockDevbox.git.isAvailable.mockResolvedValueOnce({
            available: true,
            source: 'system',
            version: '2.49.0',
        });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        fireEvent.click(await screen.findByRole('button', { name: /Tools/i }));

        expect(await screen.findByText('Git 2.49.0')).toBeInTheDocument();
        await screen.findByText(/Available in PATH/i);
        expect(screen.getByText(/System PATH/i)).toBeInTheDocument();
        expect(screen.queryByTitle('Remove')).not.toBeInTheDocument();
    });

    it('shows update badge and opens safe update modal with modification inspection for PHP', async () => {
        mockDevbox.binaries.getInstalled.mockResolvedValueOnce({
            php: { '8.2': true },
        });
        mockDevbox.binaries.getServiceConfig.mockResolvedValueOnce({
            versions: { php: ['8.2'] },
        });
        mockDevbox.binaries.getAllPhpVersionDetails.mockResolvedValueOnce({
            '8.2': {
                version: '8.2',
                installed: true,
                installedVersion: '8.2.14',
                configuredVersion: '8.2.35',
                hasUpdate: true,
            },
        });
        mockDevbox.binaries.checkPhpModifications.mockResolvedValueOnce({
            hasModifications: true,
            modifiedFiles: ['php.ini', 'ext/php_xdebug.dll'],
            hasCustomIni: true,
            customExtensions: ['php_xdebug.dll'],
            customFiles: [],
        });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        // Language tab is default, expand PHP section
        const phpCard = await screen.findByText(/PHP scripting language/i);
        fireEvent.click(phpCard);

        // Update available badge and Update button should be visible
        expect(await screen.findByText(/Update available \(8.2.35\)/i)).toBeInTheDocument();
        const updateBtn = screen.getByTitle(/Safely update to PHP 8.2.35/i);
        expect(updateBtn).toBeInTheDocument();

        // Click Update to open modal
        fireEvent.click(updateBtn);

        // Modal should open
        expect(await screen.findByText('Safe PHP Version Update')).toBeInTheDocument();
        expect(screen.getByText('v8.2.14')).toBeInTheDocument();
        expect(screen.getByText('v8.2.35')).toBeInTheDocument();

        // Inspector should show custom modifications
        expect(await screen.findByText(/Custom modifications detected in this PHP installation/i)).toBeInTheDocument();
        expect(screen.getAllByText(/php\.ini/i).length).toBeGreaterThan(0);
        expect(screen.getByText(/ext\/php_xdebug\.dll/i)).toBeInTheDocument();

        // Checkbox to preserve modifications should be checked by default
        const preserveCheckbox = screen.getByRole('checkbox');
        expect(preserveCheckbox).toBeChecked();

        // Click Update to execute
        const confirmBtn = screen.getByRole('button', { name: /Update to v8.2.35/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(mockDevbox.binaries.updatePhp).toHaveBeenCalledWith('8.2', {
                preserveModifications: true,
                force: true,
            });
        });
    });

    it('displays update badge and modal for Node.js with package preservation option', async () => {
        mockDevbox.binaries.getInstalled.mockResolvedValueOnce({
            nodejs: { '20': true },
        });
        mockDevbox.binaries.getServiceConfig.mockResolvedValueOnce({
            versions: { nodejs: ['20'] },
        });
        mockDevbox.binaries.getAllPackageVersionDetails = vi.fn().mockResolvedValue({
            nodejs: {
                '20': {
                    service: 'nodejs',
                    version: '20',
                    installed: true,
                    installedVersion: '20.20.1',
                    configuredVersion: '20.20.8',
                    hasUpdate: true,
                },
            },
        });
        mockDevbox.binaries.checkPackageModifications = vi.fn().mockResolvedValue({
            hasModifications: true,
            reasons: ['2 global npm package(s) installed (e.g. pnpm, yarn)'],
            customPackages: ['pnpm', 'yarn'],
            customFiles: ['.npmrc'],
            modifiedFiles: ['node_modules', '.npmrc'],
        });
        mockDevbox.binaries.updatePackage = vi.fn().mockResolvedValue({
            success: true,
            service: 'nodejs',
            version: '20',
            newVersion: '20.20.8',
        });

        render(<BinaryManager />);

        // Switch to language tab and expand Node.js section
        const nodeCardHeader = await screen.findByText('Node.js');
        fireEvent.click(nodeCardHeader);

        // Should display update badge for Node.js 20
        expect(await screen.findByText(/Update available \(20\.20\.8\)/i)).toBeInTheDocument();

        // Click the update button for Node.js
        const updateBtn = screen.getByRole('button', { name: /^Update$/i });
        fireEvent.click(updateBtn);

        // Safe Node.js Update Modal should open
        expect(await screen.findByText(/Safe Node\.js Version Update/i)).toBeInTheDocument();
        expect(screen.getByText('v20.20.1')).toBeInTheDocument();
        expect(screen.getByText('v20.20.8')).toBeInTheDocument();
        expect(await screen.findByText(/pnpm, yarn/i)).toBeInTheDocument();

        // Confirm update
        const confirmBtn = screen.getByRole('button', { name: /Update to v20.20.8/i });
        fireEvent.click(confirmBtn);

        await waitFor(() => {
            expect(mockDevbox.binaries.updatePackage).toHaveBeenCalledWith('nodejs', '20', {
                preserveModifications: true,
                force: true,
            });
        });
    });

    it('displays update badges on category tabs, service card headers, and version pills when updates are available', async () => {
        mockDevbox.binaries.getInstalled.mockResolvedValue({
            mysql: { '8.4': true, '8.0': true },
        });
        mockDevbox.binaries.getAllPackageVersionDetails.mockResolvedValue({
            mysql: {
                '8.4': {
                    hasUpdate: true,
                    installedVersion: '8.4.1',
                    configuredVersion: '8.4.4',
                },
                '8.0': {
                    hasUpdate: false,
                    installedVersion: '8.0.40',
                    configuredVersion: '8.0.40',
                },
            },
        });

        render(<BinaryManager />);

        // Databases tab should display count '1'
        const dbTabBadge = await screen.findByText('1');
        expect(dbTabBadge).toBeInTheDocument();

        // Switch to Databases tab
        const dbTab = screen.getByRole('button', { name: /Databases/i });
        fireEvent.click(dbTab);

        // Header of MySQL card should show "Update Available"
        expect(await screen.findByText(/Update Available/i)).toBeInTheDocument();

        // Pill for 8.4 should show "Update" badge while collapsed
        expect(screen.getByText(/^Update$/i)).toBeInTheDocument();
        expect(screen.getByText('View Update')).toBeInTheDocument();
    });
});


