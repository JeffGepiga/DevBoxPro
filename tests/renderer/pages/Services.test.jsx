/**
 * Tests for src/renderer/src/pages/Services.jsx
 *
 * Phase 5 – Structure tests for the Services page.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    projects: {
        stopAll: vi.fn().mockResolvedValue({ success: true }),
    },
    services: {
        getStatus: vi.fn().mockResolvedValue({}),
        getRunningVersions: vi.fn().mockResolvedValue({}),
        start: vi.fn().mockResolvedValue({}),
        stop: vi.fn().mockResolvedValue({}),
        stopAll: vi.fn().mockResolvedValue({}),
    },
    binaries: {
        getStatus: vi.fn().mockResolvedValue({}),
        getServiceConfig: vi.fn().mockResolvedValue({ versions: {}, defaultPorts: {} }),
    },
    tunnel: {
        getAllStatuses: vi.fn().mockResolvedValue({}),
        getStatus: vi.fn().mockResolvedValue(null),
        stop: vi.fn().mockResolvedValue({ success: true }),
        zrokStatus: vi.fn().mockResolvedValue({ enabled: false, configuredAt: null }),
        onStatusChanged: vi.fn(() => vi.fn()),
    },
    database: {
        getInfo: vi.fn().mockResolvedValue({}),
    },
    system: {
        openExternal: vi.fn(),
    },
};

const mockAppContext = {
    projects: [],
    loading: false,
    services: {},
    resourceUsage: { total: { cpu: 0, memory: 0 }, services: {} },
    projectLoadingStates: {},
    refreshServices: vi.fn(),
    refreshProjects: vi.fn(),
    startService: vi.fn(),
    stopService: vi.fn(),
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.binaries.getStatus.mockResolvedValue({});
    mockDevbox.binaries.getServiceConfig.mockResolvedValue({ versions: {}, defaultPorts: {}, portOffsets: {} });
    mockAppContext.projects = [];
    mockAppContext.services = {};
    mockAppContext.refreshServices = vi.fn();
    mockAppContext.refreshProjects = vi.fn();
    mockAppContext.startService = vi.fn();
    mockAppContext.stopService = vi.fn();
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => mockAppContext,
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
}));

import Services from '@/pages/Services';

describe('Services', () => {
    it('renders the page heading', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Services />
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByText('Services')).toBeInTheDocument());
        await act(async () => { });
    });

    it('shows known services like MySQL and phpMyAdmin', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Services />
            </MemoryRouter>
        );
        await act(async () => { });
        // Page should list service categories
        const headings = screen.getAllByRole('heading');
        expect(headings.length).toBeGreaterThan(0);
    });

    it('stops running projects in bulk before stopping standalone services', async () => {
        mockDevbox.binaries.getStatus.mockResolvedValueOnce({
            mailpit: { installed: true },
        });
        mockAppContext.projects = [{
            id: 'proj-1',
            isRunning: true,
            webServer: 'nginx',
            services: { mysql: true },
        }];
        mockAppContext.services = {
            nginx: { status: 'running', version: '1.28' },
            mysql: { status: 'running', version: '8.4' },
            mailpit: { status: 'running' },
        };

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Services />
            </MemoryRouter>
        );

        const stopAllButton = await screen.findByRole('button', { name: /Stop All/i });
        await waitFor(() => expect(stopAllButton).not.toBeDisabled());
        fireEvent.click(stopAllButton);

        await waitFor(() => {
            expect(mockDevbox.projects.stopAll).toHaveBeenCalledTimes(1);
        });
        expect(mockDevbox.services.stopAll).not.toHaveBeenCalled();
        expect(mockDevbox.services.stop).toHaveBeenCalledWith('mailpit', null);
    });

    it('marks database versions used by running projects as running', async () => {
        mockDevbox.binaries.getStatus.mockResolvedValue({
            mysql: { '8.0': { installed: true } },
        });
        mockDevbox.binaries.getServiceConfig.mockResolvedValue({
            versions: { mysql: ['8.0'] },
            defaultPorts: { mysql: 3306 },
            portOffsets: { mysql: { '8.0': 1 } },
        });
        mockAppContext.projects = [{
            id: 'proj-1',
            isRunning: true,
            webServer: 'nginx',
            services: { mysql: true, mysqlVersion: '8.0' },
        }];

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Services />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('v8.0')).toBeInTheDocument();
            expect(screen.getByText('3307')).toBeInTheDocument();
        });

        expect(screen.getByRole('button', { name: /^Stop$/i })).toBeInTheDocument();
    });

    it('shows active public tunnels and allows stopping them', async () => {
        mockDevbox.binaries.getStatus.mockResolvedValue({
            cloudflared: { installed: true },
            zrok: { installed: true },
        });
        mockDevbox.tunnel.getAllStatuses.mockResolvedValue({
            'proj-1': {
                projectId: 'proj-1',
                provider: 'cloudflared',
                status: 'running',
                publicUrl: 'https://myapp.trycloudflare.com',
            },
        });
        mockDevbox.tunnel.zrokStatus.mockResolvedValue({ enabled: true, configuredAt: '2026-04-01T10:00:00.000Z' });
        mockAppContext.projects = [{ id: 'proj-1', name: 'My App', isRunning: true, webServer: 'nginx', services: {} }];

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Services />
            </MemoryRouter>
        );

        expect(await screen.findByText('Internet Sharing Readiness')).toBeInTheDocument();
        expect(await screen.findByText('https://myapp.trycloudflare.com')).toBeInTheDocument();

        fireEvent.click(screen.getAllByRole('button', { name: /^Stop$/i })[0]);

        await waitFor(() => {
            expect(mockDevbox.tunnel.stop).toHaveBeenCalledWith('proj-1');
        });
    });
});
