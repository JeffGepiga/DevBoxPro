/**
 * Tests for src/renderer/src/pages/Databases.jsx
 *
 * Phase 5 – Structure tests for Databases page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    database: {
        listDatabases: vi.fn().mockResolvedValue([]),
        getInfo: vi.fn().mockResolvedValue({ type: 'mysql', version: '8.4', host: '127.0.0.1', port: 3306, user: 'root', password: '' }),
        isServiceRunning: vi.fn().mockReturnValue(true),
        getRunningOperations: vi.fn().mockResolvedValue([]),
    },
    services: {
        getStatus: vi.fn().mockResolvedValue({}),
        getRunningVersions: vi.fn().mockResolvedValue({}),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.database.listDatabases.mockResolvedValue([]);
    mockDevbox.database.getInfo.mockResolvedValue({ type: 'mysql', version: '8.4', host: '127.0.0.1', port: 3306 });
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({ projects: [], loading: false, services: {}, refreshServices: vi.fn() }),
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
        await waitFor(() => expect(screen.getByText(/Databases/i)).toBeInTheDocument());
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
});
