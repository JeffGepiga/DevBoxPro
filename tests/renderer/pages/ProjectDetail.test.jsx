/**
 * Tests for src/renderer/src/pages/ProjectDetail.jsx
 *
 * Phase 5 – Structure tests for ProjectDetail page.
 * Tests that the detail page renders project info and action tabs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

afterEach(cleanup);

const MOCK_PROJECT = {
    id: 'proj-1',
    name: 'My Laravel App',
    domain: 'myapp.test',
    path: '/projects/myapp',
    type: 'laravel',
    phpVersion: '8.3',
    isRunning: true,
    port: 8080,
};

const mockDevbox = {
    projects: {
        start: vi.fn().mockResolvedValue({}),
        stop: vi.fn().mockResolvedValue({}),
        openFolder: vi.fn(),
        openEditor: vi.fn(),
        getPhpIni: vi.fn().mockResolvedValue(''),
    },
    binaries: {
        getStatus: vi.fn().mockResolvedValue({ php: { '8.3': { installed: true } } }),
    },
    database: {
        listDatabases: vi.fn().mockResolvedValue([]),
    },
    supervisor: {
        getProcesses: vi.fn().mockResolvedValue([]),
    },
    logs: {
        getProjectLogs: vi.fn().mockResolvedValue([]),
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
        refreshProjects: vi.fn(),
        startProject: vi.fn(),
        stopProject: vi.fn(),
    }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
}));

// Mock XTerminal & ProjectTerminal (they require canvas)
vi.mock('@/components/XTerminal', () => ({ default: () => null }));
vi.mock('@/components/ProjectTerminal', () => ({ default: () => <div data-testid="project-terminal" /> }));
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
            await waitFor(() => expect(screen.getByText(/myapp\.test/i)).toBeInTheDocument());
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
    });

    describe('Not Found', () => {
        it('shows not found state for nonexistent project', async () => {
            renderProjectDetail('nonexistent-id');
            await act(async () => { });
            expect(document.body.textContent.toLowerCase()).toMatch(/not found|404|no project/i);
        });
    });
});
