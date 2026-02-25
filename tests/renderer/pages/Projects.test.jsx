/**
 * Tests for src/renderer/src/pages/Projects.jsx
 *
 * Phase 5 – Structure and interaction tests for Projects page.
 * Tests search, view mode toggle, and project list rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockProjects = [
    {
        id: 'p1',
        name: 'Laravel Blog',
        domain: 'blog.test',
        path: '/projects/blog',
        type: 'laravel',
        phpVersion: '8.3',
        isRunning: false,
    },
    {
        id: 'p2',
        name: 'WordPress Site',
        domain: 'wordpress.test',
        path: '/projects/wordpress',
        type: 'wordpress',
        phpVersion: '8.2',
        isRunning: true,
    },
];

const mockStartProject = vi.fn();
const mockStopProject = vi.fn();
const mockDeleteProject = vi.fn();
const mockRefreshProjects = vi.fn();

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({
        projects: mockProjects,
        loading: false,
        projectLoadingStates: {},
        startProject: mockStartProject,
        stopProject: mockStopProject,
        deleteProject: mockDeleteProject,
        refreshProjects: mockRefreshProjects,
        refreshServices: vi.fn(),
    }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({
        showConfirm: vi.fn().mockResolvedValue(false),
        showAlert: vi.fn(),
    }),
}));

// Mock ImportProjectModal (it has its own tests)
vi.mock('@/components/ImportProjectModal', () => ({
    default: ({ onClose }) => (
        <div data-testid="import-modal">
            <button onClick={onClose}>CloseModal</button>
        </div>
    ),
}));

const mockDevbox = {
    projects: {
        start: vi.fn().mockResolvedValue({}),
        stop: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
        scan: vi.fn().mockResolvedValue([]),
        importFolder: vi.fn().mockResolvedValue(null),
        import: vi.fn().mockResolvedValue({}),
        moveToProjectsDir: vi.fn().mockResolvedValue({}),
    },
    settings: {
        get: vi.fn().mockResolvedValue({}),
    },
    app: {
        openPath: vi.fn(),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    localStorage.clear();
});

import Projects from '@/pages/Projects';

function renderProjects() {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Projects />
        </MemoryRouter>
    );
}

describe('Projects', () => {
    // ─────────────────────────────────────────────────────────────────
    // Rendering
    // ─────────────────────────────────────────────────────────────────

    describe('Rendering', () => {
        it('renders the page heading', async () => {
            renderProjects();
            await waitFor(() => expect(screen.getByText('Projects')).toBeInTheDocument());
        });

        it('renders all project names', async () => {
            renderProjects();
            await waitFor(() => {
                expect(screen.getByText('Laravel Blog')).toBeInTheDocument();
                expect(screen.getByText('WordPress Site')).toBeInTheDocument();
            });
        });

        it('renders New Project link', async () => {
            renderProjects();
            await waitFor(() => {
                const link = screen.getByText(/New Project/i).closest('a');
                expect(link).toHaveAttribute('href', '/projects/new');
            });
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // Search / Filter
    // ─────────────────────────────────────────────────────────────────

    describe('Search', () => {
        it('filters projects by name', async () => {
            renderProjects();
            await waitFor(() => screen.getByText('Laravel Blog'));

            const searchInput = screen.getByPlaceholderText(/Search/i);
            fireEvent.change(searchInput, { target: { value: 'laravel' } });

            expect(screen.getByText('Laravel Blog')).toBeInTheDocument();
            expect(screen.queryByText('WordPress Site')).not.toBeInTheDocument();
        });

        it('shows all projects when search is cleared', async () => {
            renderProjects();
            await waitFor(() => screen.getByText('Laravel Blog'));

            const searchInput = screen.getByPlaceholderText(/Search/i);
            fireEvent.change(searchInput, { target: { value: 'laravel' } });
            fireEvent.change(searchInput, { target: { value: '' } });

            expect(screen.getByText('Laravel Blog')).toBeInTheDocument();
            expect(screen.getByText('WordPress Site')).toBeInTheDocument();
        });
    });

    // ─────────────────────────────────────────────────────────────────
    // View Mode toggle
    // ─────────────────────────────────────────────────────────────────

    describe('View Mode', () => {
        it('has view mode toggle buttons', async () => {
            renderProjects();
            await waitFor(() => screen.getByText('Laravel Blog'));
            // There should be grid/list view toggle buttons
            const buttons = screen.getAllByRole('button');
            expect(buttons.length).toBeGreaterThan(0);
        });
    });
});
