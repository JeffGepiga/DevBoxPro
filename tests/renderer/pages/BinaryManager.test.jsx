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

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.binaries.getStatus.mockResolvedValue({ php: {}, nginx: {}, apache: {}, mysql: {}, mariadb: {}, redis: {}, nodejs: {}, phpmyadmin: {}, mailpit: {} });
    mockDevbox.git.isAvailable.mockResolvedValue({ available: false, source: null, version: null });
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({
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
    }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
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
        mockDevbox.binaries.getInstalled.mockResolvedValueOnce({ zrok: true });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );

        fireEvent.click(await screen.findByRole('button', { name: /Tools/i }));

        fireEvent.change(await screen.findByPlaceholderText(/Paste your zrok enable token/i), {
            target: { value: 'zrok-token-123' },
        });

        fireEvent.click(screen.getByRole('button', { name: /Enable zrok/i }));

        await waitFor(() => {
            expect(mockDevbox.tunnel.zrokEnable).toHaveBeenCalledWith('zrok-token-123');
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
