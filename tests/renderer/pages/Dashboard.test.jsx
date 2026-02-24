/**
 * Tests for src/renderer/src/pages/Dashboard.jsx
 *
 * Phase 5 – Testing the Dashboard page rendering, empty states, and actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, act, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Dashboard from '@/pages/Dashboard';
import * as AppContextModule from '@/context/AppContext';

// Mock the useApp hook
vi.mock('@/context/AppContext', () => ({
    useApp: vi.fn(),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Dashboard', () => {
    let mockRefreshServices;
    let mockRefreshProjects;
    let mockStartProject;
    let mockStopProject;

    beforeEach(() => {
        mockRefreshServices = vi.fn();
        mockRefreshProjects = vi.fn();
        mockStartProject = vi.fn();
        mockStopProject = vi.fn();

        // Default mock implementation
        AppContextModule.useApp.mockReturnValue({
            projects: [],
            services: {},
            resourceUsage: { total: { cpu: 0, memory: 0 }, services: {} },
            loading: false,
            projectLoadingStates: {},
            setProjectLoading: vi.fn(),
            startProject: mockStartProject,
            stopProject: mockStopProject,
            refreshServices: mockRefreshServices,
            refreshProjects: mockRefreshProjects,
        });

        // Setup window.devbox mock for Dashboard component
        window.devbox = {
            ...window.devbox,
            binaries: {
                getStatus: vi.fn().mockResolvedValue({}),
                getServiceConfig: vi.fn().mockResolvedValue({
                    versions: {},
                    portOffsets: {},
                    defaultPorts: { mysql: 3306, mariadb: 3306, redis: 6379, nginx: 80, apache: 8081, mailpit: 8025, phpmyadmin: 8080 },
                    serviceInfo: {}
                })
            },
            services: {
                getRunningVersions: vi.fn().mockResolvedValue({})
            }
        };
    });

    it('renders loading spinner when loading is true', async () => {
        AppContextModule.useApp.mockReturnValue({
            projects: [],
            services: {},
            resourceUsage: { total: { cpu: 0, memory: 0 }, services: {} },
            loading: true,
            projectLoadingStates: {},
            setProjectLoading: vi.fn(),
            startProject: mockStartProject,
            stopProject: mockStopProject,
            refreshServices: mockRefreshServices,
            refreshProjects: mockRefreshProjects,
        });
        const { container } = render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Dashboard />
            </MemoryRouter>
        );
        // Look for the spinner div - it has the animate-spin class but no text
        expect(container.querySelector('.animate-spin')).toBeInTheDocument();
        expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
        await act(async () => { });
    });

    it('renders empty state when no projects or services', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Dashboard />
            </MemoryRouter>
        );

        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Total Projects')).toBeInTheDocument();
        expect(screen.getAllByText('0').length).toBeGreaterThanOrEqual(1);

        expect(screen.getByText('No projects yet')).toBeInTheDocument();
        expect(screen.getByText('Create your first project')).toBeInTheDocument();

        // Simple services are always rendered
        expect(screen.getByText('Mailpit')).toBeInTheDocument();
        expect(screen.getByText('phpMyAdmin')).toBeInTheDocument();

        await act(async () => { });
    });

    it('renders populated state with projects and formatting', async () => {
        AppContextModule.useApp.mockReturnValue({
            projects: [
                { id: 'p1', name: 'App One', type: 'laravel', phpVersion: '8.2', isRunning: true },
                { id: 'p2', name: 'App Two', type: 'wordpress', phpVersion: '8.1', isRunning: false },
            ],
            services: {
                mailpit: { status: 'running', port: 8025 }
            },
            resourceUsage: { total: { cpu: 25.4, memory: 512 }, services: {} },
            loading: false,
            projectLoadingStates: {},
            setProjectLoading: vi.fn(),
            startProject: mockStartProject,
            stopProject: mockStopProject,
            refreshServices: mockRefreshServices,
            refreshProjects: mockRefreshProjects,
        });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Dashboard />
            </MemoryRouter>
        );

        // App names should be links
        expect(screen.getByText('App One')).toBeInTheDocument();
        expect(screen.getByText('App Two')).toBeInTheDocument();

        // Formatted subtext
        expect(screen.getByText('PHP 8.2 • laravel')).toBeInTheDocument();

        // Ensure rounded CPU usage
        expect(screen.getByText('25%')).toBeInTheDocument();

        // Simple services
        expect(screen.getByText('Mailpit')).toBeInTheDocument();
        expect(screen.getByText('Port: 8025')).toBeInTheDocument();

        await act(async () => { });
    });

    it('calls startProject and stopProject actions', async () => {
        AppContextModule.useApp.mockReturnValue({
            projects: [
                { id: 'p1', name: 'App One', type: 'laravel', phpVersion: '8.2', isRunning: false },
                { id: 'p2', name: 'App Two', type: 'wordpress', phpVersion: '8.1', isRunning: true },
            ],
            services: {},
            resourceUsage: { total: { cpu: 0, memory: 0 }, services: {} },
            loading: false,
            projectLoadingStates: {},
            setProjectLoading: vi.fn(),
            startProject: mockStartProject,
            stopProject: mockStopProject,
            refreshServices: mockRefreshServices,
            refreshProjects: mockRefreshProjects,
        });

        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Dashboard />
            </MemoryRouter>
        );

        // Start button for non-running project
        const startBtn = screen.getByTitle('Start');
        fireEvent.click(startBtn);
        expect(mockStartProject).toHaveBeenCalledWith('p1');

        // Stop button for running project
        const stopBtn = screen.getByTitle('Stop');
        fireEvent.click(stopBtn);
        expect(mockStopProject).toHaveBeenCalledWith('p2');

        await act(async () => { });
    });

    it('triggers refresh on mount', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Dashboard />
            </MemoryRouter>
        );
        expect(mockRefreshProjects).toHaveBeenCalled();
        expect(mockRefreshServices).toHaveBeenCalled();

        await act(async () => { });
    });
});
