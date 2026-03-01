/**
 * Tests for src/renderer/src/pages/Settings.jsx
 *
 * Phase 5 – Testing Settings page tabs, inputs, and save/reset actions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Settings from '@/pages/Settings';
import * as AppContextModule from '@/context/AppContext';
import * as ModalContextModule from '@/context/ModalContext';

// Mock contexts
vi.mock('@/context/AppContext', () => ({
    useApp: vi.fn(),
}));
vi.mock('@/context/ModalContext', () => ({
    useModal: vi.fn(),
}));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

describe('Settings', () => {
    let mockRefreshSettings;
    let mockShowAlert;
    let mockShowConfirm;

    beforeEach(() => {
        mockRefreshSettings = vi.fn();
        mockShowAlert = vi.fn().mockResolvedValue(true);
        mockShowConfirm = vi.fn().mockResolvedValue(true);

        AppContextModule.useApp.mockReturnValue({
            settings: {
                settings: {
                    defaultProjectsPath: 'C:\\test\\projects',
                    dbUser: 'root',
                    dbPassword: '',
                    serverTimezone: 'UTC'
                }
            },
            refreshSettings: mockRefreshSettings,
        });

        ModalContextModule.useModal.mockReturnValue({
            showAlert: mockShowAlert,
            showConfirm: mockShowConfirm,
        });

        // Setup window.devbox mock for settings
        window.devbox = {
            ...window.devbox,
            settings: {
                set: vi.fn().mockResolvedValue(),
                reset: vi.fn().mockResolvedValue(),
                getAll: vi.fn().mockResolvedValue({ settings: {} }),
            },
            database: {
                syncCredentialsToAllVersions: vi.fn().mockResolvedValue(),
            },
            cli: {
                getStatus: vi.fn().mockResolvedValue({ installed: true, inPath: true }),
                getDirectShimsEnabled: vi.fn().mockResolvedValue(false),
            }
        };
    });

    it('renders General settings tab by default', () => {
        render(<Settings />);

        expect(screen.getByText('Default Projects Directory')).toBeInTheDocument();
        expect(screen.getByDisplayValue('C:\\test\\projects')).toBeInTheDocument();

        // Settings buttons
        expect(screen.getByRole('button', { name: /Save Changes/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Reset/i })).toBeInTheDocument();
    });

    it('switches to Network tab when clicked', () => {
        render(<Settings />);

        // Click Network tab
        fireEvent.click(screen.getByRole('button', { name: 'Network' }));

        // Should show Database Credentials section now
        expect(screen.getByText('MySQL & MariaDB Credentials')).toBeInTheDocument();
        expect(screen.getByDisplayValue('root')).toBeInTheDocument(); // dbUser
    });

    it('calls save API when Save Changes is clicked', async () => {
        render(<Settings />);

        // Click save
        fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

        await waitFor(() => {
            expect(window.devbox.settings.set).toHaveBeenCalledWith('settings.defaultProjectsPath', 'C:\\test\\projects');
            expect(window.devbox.settings.set).toHaveBeenCalledWith('settings.dbUser', 'root');
            expect(mockRefreshSettings).toHaveBeenCalled();
        });
    });

    it('triggers credentials sync if db user or password changed', async () => {
        render(<Settings />);

        // Switch to network
        fireEvent.click(screen.getByRole('button', { name: 'Network' }));

        // Change password
        const inputs = screen.getAllByRole('textbox');
        const passInput = inputs.find(el => el.type === 'password') || screen.getAllByPlaceholderText('Leave empty for no password')[0];
        fireEvent.change(passInput, { target: { value: 'newpass' } });

        // Save
        fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

        await waitFor(() => {
            expect(window.devbox.database.syncCredentialsToAllVersions).toHaveBeenCalledWith('root', 'newpass', '');
        });
    });

    it('calls reset API when Reset is clicked and confirmed', async () => {
        render(<Settings />);

        // Click reset
        fireEvent.click(screen.getByRole('button', { name: /Reset/i }));

        await waitFor(() => {
            expect(mockShowConfirm).toHaveBeenCalled();
            expect(window.devbox.settings.reset).toHaveBeenCalled();
            expect(mockRefreshSettings).toHaveBeenCalled();
        });
    });
});
