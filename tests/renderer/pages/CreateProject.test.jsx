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
};

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
        projects: [],
        loading: false,
        projectLoadingStates: {},
        refreshProjects: vi.fn(),
    }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
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
    });
});
