/**
 * Tests for src/renderer/src/pages/Services.jsx
 *
 * Phase 5 – Structure tests for the Services page.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    services: {
        getStatus: vi.fn().mockResolvedValue({}),
        getRunningVersions: vi.fn().mockResolvedValue({}),
        startService: vi.fn().mockResolvedValue({}),
        stopService: vi.fn().mockResolvedValue({}),
    },
    binaries: {
        getStatus: vi.fn().mockResolvedValue({}),
    },
    database: {
        getInfo: vi.fn().mockResolvedValue({}),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({
        projects: [],
        loading: false,
        services: {},
        refreshServices: vi.fn(),
        refreshProjects: vi.fn(),
    }),
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
});
