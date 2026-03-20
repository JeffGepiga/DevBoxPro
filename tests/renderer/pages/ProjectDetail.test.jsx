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
        openFolder: vi.fn(),
        openEditor: vi.fn(),
        getPhpIni: vi.fn().mockResolvedValue(''),
    },
    binaries: {
        getStatus: vi.fn().mockResolvedValue({ php: { '8.3': { installed: true } } }),
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
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
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
});
