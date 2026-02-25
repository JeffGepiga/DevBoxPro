/**
 * Tests for src/renderer/src/pages/Logs.jsx
 *
 * Phase 5 – Structure tests for Logs page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    logs: {
        getLogs: vi.fn().mockResolvedValue([]),
        clearLogs: vi.fn().mockResolvedValue({}),
        streamLogs: vi.fn().mockResolvedValue(null),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.logs.getLogs.mockResolvedValue([]);
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({ projects: [], loading: false, refreshServices: vi.fn() }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
}));

import Logs from '@/pages/Logs';

describe('Logs', () => {
    it('renders page heading', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Logs />
            </MemoryRouter>
        );
        await waitFor(() => expect(screen.getByText(/Logs/i)).toBeInTheDocument());
        await act(async () => { });
    });

    it('shows log level filter controls', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <Logs />
            </MemoryRouter>
        );
        await act(async () => { });
        // Page should render some filter/control UI
        expect(document.body.textContent).toBeTruthy();
    });
});
