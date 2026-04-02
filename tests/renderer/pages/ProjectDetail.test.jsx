/**
 * Tests for src/renderer/src/pages/ProjectDetail.jsx
 *
 * Phase 5 – Structure tests for ProjectDetail page.
 * Tests that the detail page renders project info and action tabs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

afterEach(cleanup);

const MOCK_PROJECT = {
    id: 'proj-1',
    name: 'My Laravel App',
    domain: 'myapp.test',
    domains: ['myapp.test'],
    path: '/projects/myapp',
    type: 'laravel',
    phpVersion: '8.3',
    isRunning: true,
    port: 8080,
    ssl: false,
    networkAccess: false,
    services: {
        mysql: true,
        mysqlVersion: '8.4',
    },
};

const mockDevbox = {
    projects: {
        start: vi.fn().mockResolvedValue({}),
        stop: vi.fn().mockResolvedValue({}),
        getAll: vi.fn().mockResolvedValue([MOCK_PROJECT]),
        update: vi.fn().mockResolvedValue({ success: true }),
        openFolder: vi.fn(),
        openEditor: vi.fn(),
        getPhpIni: vi.fn().mockResolvedValue(''),
    },
    binaries: {
        getStatus: vi.fn().mockResolvedValue({
            php: { '8.3': { installed: true } },
            mysql: { '8.4': { installed: true }, '8.0': { installed: true } },
            cloudflared: { installed: true },
            zrok: { installed: true },
        }),
        getServiceConfig: vi.fn().mockResolvedValue({
            defaultPorts: { mysql: 3306 },
            portOffsets: { mysql: { '8.4': 0, '8.0': 1 } },
        }),
        onProgress: vi.fn(() => vi.fn()),
    },
    database: {
        listDatabases: vi.fn().mockResolvedValue([]),
        getPhpMyAdminUrl: vi.fn().mockResolvedValue('http://localhost:8080/index.php?server=1'),
    },
    supervisor: {
        getProcesses: vi.fn().mockResolvedValue([]),
    },
    logs: {
        getProjectLogs: vi.fn().mockResolvedValue([]),
    },
    services: {
        getWebServerPorts: vi.fn().mockResolvedValue({ httpPort: 80, sslPort: 443 }),
        getProjectLocalAccessPorts: vi.fn().mockResolvedValue({ httpPort: 80, sslPort: 443 }),
        getProjectNetworkPort: vi.fn().mockResolvedValue({ httpPort: 80, sslPort: 443 }),
    },
    system: {
        getLocalIpAddresses: vi.fn().mockResolvedValue([]),
        openExternal: vi.fn(),
    },
    tunnel: {
        getStatus: vi.fn().mockResolvedValue(null),
        getAllStatuses: vi.fn().mockResolvedValue({}),
        start: vi.fn().mockResolvedValue({
            projectId: 'proj-1',
            provider: 'cloudflared',
            status: 'running',
            publicUrl: 'https://myapp.trycloudflare.com',
        }),
        stop: vi.fn().mockResolvedValue({ success: true }),
        zrokStatus: vi.fn().mockResolvedValue({ enabled: true, configuredAt: '2026-04-01T10:00:00.000Z' }),
        onStatusChanged: vi.fn(() => vi.fn()),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.binaries.getStatus.mockResolvedValue({
        php: { '8.3': { installed: true } },
        mysql: { '8.4': { installed: true }, '8.0': { installed: true } },
        cloudflared: { installed: true },
        zrok: { installed: true },
    });
    mockDevbox.binaries.getServiceConfig.mockResolvedValue({
        defaultPorts: { mysql: 3306 },
        portOffsets: { mysql: { '8.4': 0, '8.0': 1 } },
    });
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({
        projects: [MOCK_PROJECT],
        loading: false,
        services: {},
        projectLoadingStates: {},
        settings: { settings: { defaultTld: 'test' } },
        refreshProjects: vi.fn(),
        startProject: vi.fn(),
        stopProject: vi.fn(),
    }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
}));

// Mock XTerminal (requires canvas)
vi.mock('@/components/XTerminal', () => ({ default: () => null }));
vi.mock('@/components/PhpIniEditor', () => ({ default: () => null }));

import ProjectDetail from '@/pages/ProjectDetail';

function renderProjectDetail(projectId = 'proj-1') {
    return render(
        <MemoryRouter
            initialEntries={[`/projects/${projectId}`]}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
        >
            <Routes>
                <Route path="/projects/:id" element={<ProjectDetail />} />
            </Routes>
        </MemoryRouter>
    );
}

describe('ProjectDetail', () => {
    describe('Rendering', () => {
        it('renders project name', async () => {
            renderProjectDetail();
            await waitFor(() => expect(screen.getByText('My Laravel App')).toBeInTheDocument());
        });

        it('shows project domain', async () => {
            renderProjectDetail();
            await waitFor(() => expect(screen.getAllByText(/myapp\.test/i).length).toBeGreaterThan(0));
        });

        it('shows project type and PHP version', async () => {
            renderProjectDetail();
            await act(async () => { });
            expect(document.body.textContent).toMatch(/8\.3/);
        });

        it('renders action tabs', async () => {
            renderProjectDetail();
            await act(async () => { });
            // Should render navigation tabs like Overview, Terminal, Logs, etc.
            const buttons = screen.getAllByRole('button');
            expect(buttons.length).toBeGreaterThan(0);
        });

        it('keeps the local domain portless while LAN URLs use backend ports', async () => {
            MOCK_PROJECT.networkAccess = true;
            mockDevbox.system.getLocalIpAddresses.mockResolvedValue(['192.168.1.20']);
            mockDevbox.services.getProjectLocalAccessPorts.mockResolvedValue({ httpPort: 80, sslPort: 443 });
            mockDevbox.services.getProjectNetworkPort.mockResolvedValue({ httpPort: 8084, sslPort: 8446 });

            renderProjectDetail();

            await waitFor(() => expect(screen.getByRole('button', { name: /^myapp\.test$/i })).toBeInTheDocument());
            expect(mockDevbox.services.getProjectLocalAccessPorts).toHaveBeenCalledWith('proj-1');
            expect(mockDevbox.services.getProjectNetworkPort).toHaveBeenCalledWith('proj-1');
            MOCK_PROJECT.networkAccess = false;
        });

        it('derives service ports from shared service config', async () => {
            MOCK_PROJECT.services.mysqlVersion = '8.0';

            renderProjectDetail();

            await waitFor(() => {
                expect(screen.getByText(':3307')).toBeInTheDocument();
            });

            MOCK_PROJECT.services.mysqlVersion = '8.4';
        });
    });

    describe('Not Found', () => {
        it('shows not found state for nonexistent project', async () => {
            renderProjectDetail('nonexistent-id');
            await act(async () => { });
            expect(document.body.textContent.toLowerCase()).toMatch(/not found|404|no project/i);
        });
    });

    describe('phpMyAdmin launch', () => {
        it('shows a loading state while phpMyAdmin is starting', async () => {
            let resolvePhpMyAdminUrl;
            mockDevbox.database.getPhpMyAdminUrl.mockImplementation(() => new Promise((resolve) => {
                resolvePhpMyAdminUrl = resolve;
            }));

            renderProjectDetail();

            const openButton = await screen.findByRole('button', { name: /Open phpMyAdmin/i });
            fireEvent.click(openButton);

            expect(screen.getByRole('button', { name: /Starting phpMyAdmin/i })).toBeDisabled();
            expect(mockDevbox.database.getPhpMyAdminUrl).toHaveBeenCalledWith('mysql', '8.4');

            resolvePhpMyAdminUrl('http://localhost:8080/index.php?server=1');

            await waitFor(() => {
                expect(mockDevbox.system.openExternal).toHaveBeenCalledWith('http://localhost:8080/index.php?server=1');
            });
        });
    });

    describe('Internet sharing', () => {
        it('shows internet sharing controls and starts a cloudflared tunnel', async () => {
            MOCK_PROJECT.shareOnInternet = true;
            MOCK_PROJECT.tunnelProvider = 'cloudflared';

            renderProjectDetail();

            const startButton = await screen.findByRole('button', { name: /Start Sharing/i });
            fireEvent.click(startButton);

            await waitFor(() => {
                expect(mockDevbox.tunnel.start).toHaveBeenCalledWith('proj-1', 'cloudflared');
            });

            expect(await screen.findByText('https://myapp.trycloudflare.com')).toBeInTheDocument();

            MOCK_PROJECT.shareOnInternet = undefined;
            MOCK_PROJECT.tunnelProvider = undefined;
        });
    });
});
