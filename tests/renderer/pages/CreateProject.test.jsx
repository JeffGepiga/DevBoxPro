/**
 * Tests for src/renderer/src/pages/CreateProject.jsx
 *
 * Phase 5 – Structure tests for CreateProject page.
 * Tests form rendering, field interactions and navigation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    projects: {
        create: vi.fn().mockResolvedValue({ id: 'new-project' }),
        registerExisting: vi.fn().mockResolvedValue({ id: 'imported-project' }),
        detectType: vi.fn().mockResolvedValue({ name: 'Imported App', type: 'laravel' }),
        importFolder: vi.fn().mockResolvedValue(null),
        import: vi.fn().mockResolvedValue({}),
    },
    binaries: {
        getStatus: vi.fn().mockResolvedValue({
            php: { '8.3': { installed: true } },
            nginx: { '1.28': { installed: true } },
            apache: {},
            mysql: {},
            mariadb: {},
            redis: {},
            nodejs: {},
        }),
    },
    settings: {
        get: vi.fn().mockResolvedValue({ projectsPath: '/projects' }),
    },
    system: {
        selectDirectory: vi.fn().mockResolvedValue('/projects/existing-app'),
    },
    git: {
        isAvailable: vi.fn().mockResolvedValue({ available: false, source: null, version: null }),
        getSshPublicKey: vi.fn().mockResolvedValue({ exists: false }),
        testAuth: vi.fn(),
        generateSshKey: vi.fn(),
        regenerateSshKey: vi.fn(),
    },
};

const mockShowAlert = vi.fn();

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.binaries.getStatus.mockResolvedValue({
        php: { '8.3': { installed: true } },
        nginx: { '1.28': { installed: true } },
        apache: {},
        mysql: {},
        mariadb: {},
        redis: {},
        nodejs: {},
    });
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({
        projects: [{ id: 'existing-1', name: 'Existing App', path: '/projects/existing-app' }],
        loading: false,
        projectLoadingStates: {},
        refreshProjects: vi.fn(),
    }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: mockShowAlert, showConfirm: vi.fn().mockResolvedValue(false) }),
}));

vi.mock('@/components/ImportProjectModal', () => ({
    default: ({ onImport, onClose }) => (
        <div data-testid="import-modal">
            <button onClick={() => onImport({ name: 'Imported App', path: '/projects/fresh-app', type: 'laravel' })}>SubmitImport</button>
            <button onClick={onClose}>CloseImport</button>
        </div>
    ),
}));

import CreateProject from '@/pages/CreateProject';

function renderCreate() {
    return render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <CreateProject />
        </MemoryRouter>
    );
}

describe('CreateProject', () => {
    describe('Rendering', () => {
        it('renders the page heading', async () => {
            renderCreate();
            await act(async () => { });
            expect(document.body.textContent.toLowerCase()).toMatch(/create|new project/i);
        });

        it('renders project name input', async () => {
            renderCreate();
            // Wait for loading to finish and Go to step 2 (Details)
            const nextButton = await screen.findByRole('button', { name: /^Next$/i });
            fireEvent.click(nextButton);

            await waitFor(() => {
                const nameInput = document.querySelector('input[type="text"], input[placeholder*="name" i], input[placeholder*="project" i]');
                expect(nameInput).toBeTruthy();
            });
        });
    });

    describe('Form fields', () => {
        it('renders project type selector', async () => {
            renderCreate();
            await waitFor(() => {
                const laravelButton = screen.getByText('Laravel');
                expect(laravelButton).toBeInTheDocument();
            });
        });

        it('shows an alert when importing a folder that is already registered', async () => {
            renderCreate();

            fireEvent.click(await screen.findByRole('button', { name: /Import Project/i }));

            await waitFor(() => {
                expect(mockShowAlert).toHaveBeenCalledWith(expect.objectContaining({
                    title: 'Already Registered',
                    type: 'warning',
                }));
            });
            expect(mockDevbox.projects.detectType).not.toHaveBeenCalled();
        });

        it('hides clone repository when git is unavailable and shows install guidance', async () => {
            renderCreate();

            fireEvent.click(await screen.findByRole('button', { name: /^Next$/i }));

            await waitFor(() => {
                expect(screen.queryByText('Clone Repository')).not.toBeInTheDocument();
            });

            expect(screen.getByText('Git is not installed')).toBeInTheDocument();
            expect(screen.getByRole('link', { name: 'Binary Manager' })).toHaveAttribute('href', '/binaries');
        });

        it('registers an imported project through the existing-project flow', async () => {
            mockDevbox.system.selectDirectory.mockResolvedValueOnce('/projects/fresh-app');
            renderCreate();

            fireEvent.click(await screen.findByRole('button', { name: /Import Project/i }));
            await waitFor(() => expect(screen.getByTestId('import-modal')).toBeInTheDocument());

            fireEvent.click(screen.getByRole('button', { name: 'SubmitImport' }));

            await waitFor(() => {
                expect(mockDevbox.projects.registerExisting).toHaveBeenCalledWith(expect.objectContaining({
                    name: 'Imported App',
                    path: '/projects/fresh-app',
                }));
            });
            expect(mockDevbox.projects.create).not.toHaveBeenCalled();
        });
    });
});
