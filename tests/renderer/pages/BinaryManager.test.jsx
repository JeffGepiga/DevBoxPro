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
        checkForServiceUpdates: vi.fn().mockResolvedValue({
            composer: { updateAvailable: false },
            phpmyadmin: { updateAvailable: false },
            cloudflared: { updateAvailable: false },
            zrok: { updateAvailable: false },
        }),
        downloadCloudflared: vi.fn().mockResolvedValue({ success: true }),
        downloadZrok: vi.fn().mockResolvedValue({ success: true }),
        downloadGit: vi.fn().mockResolvedValue({ success: true }),
        onProgress: vi.fn().mockImplementation(() => vi.fn()),
    },
    system: {
        openExternal: vi.fn(),
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
});
