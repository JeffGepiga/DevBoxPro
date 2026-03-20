/**
 * Tests for src/renderer/src/pages/Databases.jsx
 *
 * Phase 5 – Structure tests for Databases page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    binaries: {
        getStatus: vi.fn().mockResolvedValue({
            mysql: { '8.4': { installed: true } },
            mariadb: {},
            postgresql: {},
            mongodb: {},
        }),
        getServiceConfig: vi.fn().mockResolvedValue({
            defaultPorts: { mysql: 3306, mariadb: 3310, postgresql: 5432, mongodb: 27017 },
            portOffsets: { mysql: { '8.4': 0, '8.0': 1 } },
        }),
    },
    database: {
        listDatabases: vi.fn().mockResolvedValue([]),
        getDatabases: vi.fn().mockResolvedValue([]),
        getDatabaseInfo: vi.fn().mockResolvedValue({ type: 'mysql', version: '8.4', host: '127.0.0.1', port: 3306, user: 'root', password: '' }),
        getPhpMyAdminUrl: vi.fn().mockResolvedValue('http://localhost:8080/index.php?server=1'),
        getRunningOperations: vi.fn().mockResolvedValue([]),
        setActiveDatabaseType: vi.fn().mockResolvedValue({ success: true }),
    },
    services: {
        getStatus: vi.fn().mockResolvedValue({
            mysql: { runningVersions: { '8.4': { pid: 1234 } } },
            mariadb: { runningVersions: {} },
            postgresql: { runningVersions: {} },
            mongodb: { runningVersions: {} },
        }),
        getRunningVersions: vi.fn().mockResolvedValue({}),
        start: vi.fn().mockResolvedValue({}),
        stop: vi.fn().mockResolvedValue({}),
    },
    system: {
        openExternal: vi.fn().mockResolvedValue(true),
    },
};

const mockAppContext = {
    projects: [],
    loading: false,
    services: {},
    databaseOperations: {},
    projectLoadingStates: {},
    refreshServices: vi.fn(),
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.database.listDatabases.mockResolvedValue([]);
    mockDevbox.database.getDatabases.mockResolvedValue([]);
    mockDevbox.database.getDatabaseInfo.mockResolvedValue({ type: 'mysql', version: '8.4', host: '127.0.0.1', port: 3306 });
    mockDevbox.database.setActiveDatabaseType.mockResolvedValue({ success: true });
    mockDevbox.binaries.getStatus.mockResolvedValue({
        mysql: { '8.4': { installed: true } },
        mariadb: {},
        postgresql: {},
        mongodb: {},
    });
    mockDevbox.binaries.getServiceConfig.mockResolvedValue({
        defaultPorts: { mysql: 3306, mariadb: 3310, postgresql: 5432, mongodb: 27017 },
        portOffsets: { mysql: { '8.4': 0, '8.0': 1 } },
    });
    mockDevbox.services.getStatus.mockResolvedValue({
        mysql: { runningVersions: { '8.4': { pid: 1234 } } },
        mariadb: { runningVersions: {} },
        postgresql: { runningVersions: {} },
        mongodb: { runningVersions: {} },
    });
    mockAppContext.projects = [];
    mockAppContext.databaseOperations = {};
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => mockAppContext,
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
}));

import Databases from '@/pages/Databases';

describe('Databases', () => {
    it('renders page heading', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Databases />
            </MemoryRouter>
        );
        await waitFor(() => {
            const headings = screen.getAllByRole('heading', { name: /Databases/i });
            expect(headings.length).toBeGreaterThan(0);
        });
        await act(async () => { });
    });

    it('shows connection info section', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Databases />
            </MemoryRouter>
        );
        await act(async () => { });
        // The page should have some database-related text
        expect(document.body.textContent.toLowerCase()).toMatch(/database|mysql|connection/i);
    });

    it('shows a loading state while phpMyAdmin is starting', async () => {
        let resolvePhpMyAdminUrl;
        mockDevbox.database.getPhpMyAdminUrl.mockImplementation(() => new Promise((resolve) => {
            resolvePhpMyAdminUrl = resolve;
        }));

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Databases />
            </MemoryRouter>
        );

        const phpMyAdminButton = await screen.findByRole('button', { name: /phpMyAdmin/i });
        fireEvent.click(phpMyAdminButton);

        expect(screen.getByRole('button', { name: /Starting phpMyAdmin/i })).toBeDisabled();
        expect(mockDevbox.database.getPhpMyAdminUrl).toHaveBeenCalledWith('mysql', '8.4');

        resolvePhpMyAdminUrl('http://localhost:8080/index.php?server=1');

        await waitFor(() => {
            expect(mockDevbox.system.openExternal).toHaveBeenCalledWith('http://localhost:8080/index.php?server=1');
        });
    });

    it('treats a running project database version as running and refreshes its port info', async () => {
        mockAppContext.projects = [{
            id: 'proj-1',
            isRunning: true,
            services: {
                mysql: true,
                mysqlVersion: '8.0',
            },
        }];
        mockDevbox.binaries.getStatus.mockResolvedValue({
            mysql: { '8.0': { installed: true } },
            mariadb: {},
            postgresql: {},
            mongodb: {},
        });
        mockDevbox.services.getStatus.mockResolvedValue({
            mysql: { runningVersions: {} },
            mariadb: { runningVersions: {} },
            postgresql: { runningVersions: {} },
            mongodb: { runningVersions: {} },
        });
        mockDevbox.database.getDatabaseInfo.mockResolvedValue({
            type: 'mysql',
            version: '8.0',
            host: '127.0.0.1',
            port: 3307,
            user: 'root',
            password: '',
        });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Databases />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('Running')).toBeInTheDocument();
            expect(screen.getByText('Port: 3307')).toBeInTheDocument();
        });
        expect(screen.queryByText(/is not running/i)).not.toBeInTheDocument();
    });

    it('shows engine card ports from shared service config', async () => {
        mockDevbox.binaries.getStatus.mockResolvedValue({
            mysql: { '8.4': { installed: true }, '8.0': { installed: true } },
            mariadb: {},
            postgresql: {},
            mongodb: {},
        });
        mockDevbox.services.getStatus.mockResolvedValue({
            mysql: {
                runningVersions: {
                    '8.4': { pid: 1234, port: 3307 },
                    '8.0': { pid: 5678, port: 3307 },
                },
            },
            mariadb: { runningVersions: {} },
            postgresql: { runningVersions: {} },
            mongodb: { runningVersions: {} },
        });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Databases />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText('MySQL 8.4')).toBeInTheDocument();
            expect(screen.getByText('MySQL 8.0')).toBeInTheDocument();
        });

        const portLabels = screen.getAllByText(/Port: 330[67]/i).map((node) => node.textContent);
        expect(portLabels).toContain('Port: 3306');
        expect(portLabels).toContain('Port: 3307');
    });

    it('does not show a stop action for versions used by a running project', async () => {
        mockAppContext.projects = [{
            id: 'proj-1',
            isRunning: true,
            services: {
                mysql: true,
                mysqlVersion: '8.0',
            },
        }];
        mockDevbox.binaries.getStatus.mockResolvedValue({
            mysql: { '8.0': { installed: true } },
            mariadb: {},
            postgresql: {},
            mongodb: {},
        });
        mockDevbox.services.getStatus.mockResolvedValue({
            mysql: { runningVersions: {} },
            mariadb: { runningVersions: {} },
            postgresql: { runningVersions: {} },
            mongodb: { runningVersions: {} },
        });
        mockDevbox.database.getDatabaseInfo.mockResolvedValue({
            type: 'mysql',
            version: '8.0',
            host: '127.0.0.1',
            port: 3307,
            user: 'root',
            password: '',
        });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Databases />
            </MemoryRouter>
        );

        await waitFor(() => {
            expect(screen.getByText(/Currently Used/i)).toBeInTheDocument();
        });
        expect(screen.queryByRole('button', { name: /Stop/i })).not.toBeInTheDocument();
        expect(mockDevbox.services.stop).not.toHaveBeenCalled();
    });
});
