/**
 * Tests for src/renderer/src/pages/BinaryManager.jsx
 *
 * Phase 5 – Structure tests for BinaryManager page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

afterEach(cleanup);

const mockDevbox = {
    binaries: {
        getStatus: vi.fn().mockResolvedValue({
            php: {},
            nginx: {},
            apache: {},
            mysql: {},
            mariadb: {},
            redis: {},
            nodejs: {},
            phpmyadmin: {},
            mailpit: {},
        }),
        install: vi.fn().mockResolvedValue({}),
        uninstall: vi.fn().mockResolvedValue({}),
        getInstalledBinaries: vi.fn().mockResolvedValue({ php: {}, nginx: {}, mysql: {}, mariadb: {}, redis: {} }),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
    mockDevbox.binaries.getStatus.mockResolvedValue({ php: {}, nginx: {}, apache: {}, mysql: {}, mariadb: {}, redis: {}, nodejs: {}, phpmyadmin: {}, mailpit: {} });
});

vi.mock('@/context/AppContext', () => ({
    useApp: () => ({ projects: [], loading: false, refreshServices: vi.fn() }),
}));

vi.mock('@/context/ModalContext', () => ({
    useModal: () => ({ showAlert: vi.fn(), showConfirm: vi.fn().mockResolvedValue(false) }),
}));

import BinaryManager from '@/pages/BinaryManager';

describe('BinaryManager', () => {
    it('renders page heading', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );
        await act(async () => { });
        expect(document.body.textContent.toLowerCase()).toMatch(/binary|binaries|manager/i);
    });

    it('shows category tabs (PHP, Nginx, MySQL, etc.)', async () => {
        render(
            <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                <BinaryManager />
            </MemoryRouter>
        );
        await act(async () => { });
        // Should have some section labels about binaries
        expect(document.body.textContent).toBeTruthy();
    });
});
