/**
 * Tests for src/renderer/src/components/ImportProjectModal.jsx
 *
 * Phase 5 – Component tests. Tests rendering, loading, form fields,
 * mutual-exclusion of databases, missing binary warnings, and submit.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import ImportProjectModal from '@/components/ImportProjectModal';

afterEach(cleanup);

const mockDevbox = {
    binaries: {
        getStatus: vi.fn(),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
});

const BASE_PROJECT = {
    name: 'My App',
    path: '/projects/myapp',
    type: 'laravel',
};

const STATUS_WITH_PHP = {
    php: { '8.3': { installed: true }, '8.1': { installed: true } },
    nginx: { '1.28': { installed: true } },
    apache: {},
    mysql: { '8.4': { installed: true } },
    mariadb: {},
    redis: {},
    nodejs: {},
};

function renderModal(projectOverrides = {}, onImport = vi.fn(), onClose = vi.fn()) {
    return render(
        <ImportProjectModal
            project={{ ...BASE_PROJECT, ...projectOverrides }}
            onImport={onImport}
            onClose={onClose}
        />
    );
}

describe('ImportProjectModal', () => {
    // ═══════════════════════════════════════════════════════════════════
    // Loading State
    // ═══════════════════════════════════════════════════════════════════

    describe('Loading State', () => {
        it('shows loading spinner while fetching binaries', () => {
            mockDevbox.binaries.getStatus.mockReturnValue(new Promise(() => { })); // never resolves
            renderModal();
            expect(screen.getByText(/Loading binaries/i)).toBeInTheDocument();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Rendering
    // ═══════════════════════════════════════════════════════════════════

    describe('Rendering after loading', () => {
        beforeEach(() => {
            mockDevbox.binaries.getStatus.mockResolvedValue(STATUS_WITH_PHP);
        });

        it('renders Import Project header', async () => {
            renderModal();
            await waitFor(() => expect(screen.getByText('Import Project')).toBeInTheDocument());
        });

        it('renders project name field prefilled', async () => {
            renderModal();
            await waitFor(() => {
                const input = screen.getByPlaceholderText('My Project');
                expect(input.value).toBe('My App');
            });
        });

        it('renders path field as read-only', async () => {
            renderModal();
            await waitFor(() => {
                const pathInput = screen.getByDisplayValue('/projects/myapp');
                expect(pathInput).toBeDisabled();
            });
        });

        it('shows Cancel button', async () => {
            renderModal();
            await waitFor(() => expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument());
        });

        it('shows Import Project button', async () => {
            renderModal();
            await waitFor(() => expect(screen.getByRole('button', { name: /Import Project/i })).toBeInTheDocument());
        });

        it('shows PHP version select with installed versions', async () => {
            renderModal();
            await waitFor(() => {
                expect(screen.getByText('PHP 8.3')).toBeInTheDocument();
            });
        });

        it('shows No PHP installed when no PHP is available', async () => {
            mockDevbox.binaries.getStatus.mockResolvedValue({
                ...STATUS_WITH_PHP,
                php: {},
            });
            renderModal();
            await waitFor(() => expect(screen.getByText(/No PHP installed/i)).toBeInTheDocument());
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Optional Services (MySQL/MariaDB mutual exclusion)
    // ═══════════════════════════════════════════════════════════════════

    describe('Optional Services', () => {
        beforeEach(() => {
            mockDevbox.binaries.getStatus.mockResolvedValue({
                ...STATUS_WITH_PHP,
                mysql: { '8.4': { installed: true } },
                mariadb: { '11.4': { installed: true } },
            });
        });

        it('shows Optional Services section when services are available', async () => {
            renderModal({ type: 'laravel' });
            await waitFor(() => {
                expect(screen.getByText(/Optional Services/i)).toBeInTheDocument();
            });
        });

        it('expands optional services when clicked', async () => {
            renderModal({ type: 'laravel' });
            await waitFor(() => screen.getByText(/Optional Services/i));

            fireEvent.click(screen.getByText(/Optional Services/i));
            await waitFor(() => {
                expect(screen.getByText('MySQL')).toBeInTheDocument();
                expect(screen.getByText('MariaDB')).toBeInTheDocument();
            });
        });

        it('selecting MySQL disables MariaDB', async () => {
            renderModal({ type: 'laravel' });
            await waitFor(() => screen.getByText(/Optional Services/i));

            fireEvent.click(screen.getByText(/Optional Services/i));
            await waitFor(() => screen.getByText('MySQL'));

            const mysqlCheckbox = screen.getByRole('checkbox', { name: /mysql/i });
            fireEvent.click(mysqlCheckbox);
            expect(mysqlCheckbox).toBeChecked();

            const mariadbCheckbox = screen.getByRole('checkbox', { name: /mariadb/i });
            expect(mariadbCheckbox).not.toBeChecked();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Missing Binary Warning
    // ═══════════════════════════════════════════════════════════════════

    describe('Missing Binary Warning', () => {
        it('shows warning for missing PHP version when isConfigImport', async () => {
            mockDevbox.binaries.getStatus.mockResolvedValue({
                php: { '8.1': { installed: true } }, // 8.3 not installed
                nginx: { '1.28': { installed: true } },
                apache: {},
                mysql: {},
                mariadb: {},
                redis: {},
                nodejs: {},
            });

            renderModal({
                isConfigImport: true,
                phpVersion: '8.3',
            });

            await waitFor(() => {
                expect(screen.getByText(/Missing Required Binaries/i)).toBeInTheDocument();
                expect(screen.getByText(/PHP 8.3/i)).toBeInTheDocument();
            });
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Submit
    // ═══════════════════════════════════════════════════════════════════

    describe('Form Submit', () => {
        it('calls onImport when form is submitted', async () => {
            mockDevbox.binaries.getStatus.mockResolvedValue(STATUS_WITH_PHP);
            const onImport = vi.fn().mockResolvedValue(true);
            renderModal({}, onImport);

            await waitFor(() => screen.getByRole('button', { name: /Import Project/i }));

            fireEvent.click(screen.getByRole('button', { name: /Import Project/i }));
            await waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
        });

        it('calls onClose when Cancel clicked', async () => {
            mockDevbox.binaries.getStatus.mockResolvedValue(STATUS_WITH_PHP);
            const onClose = vi.fn();
            renderModal({}, vi.fn(), onClose);

            await waitFor(() => screen.getByRole('button', { name: /Cancel/i }));
            fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('Import button disabled when project has no name', async () => {
            mockDevbox.binaries.getStatus.mockResolvedValue(STATUS_WITH_PHP);
            renderModal({ name: '' });

            await waitFor(() => {
                const btn = screen.getByRole('button', { name: /Import Project/i });
                expect(btn).toBeDisabled();
            });
        });
    });
});
