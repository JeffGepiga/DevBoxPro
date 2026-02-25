/**
 * Tests for src/renderer/src/components/PhpIniEditor.jsx
 *
 * Phase 5 – PhpIniEditor component tests. Tests rendering, loading state,
 * edit mode, and save/cancel behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ModalProvider } from '@/context/ModalContext';
import PhpIniEditor from '@/components/PhpIniEditor';

afterEach(cleanup);

// Mock window.devbox
const mockDevbox = {
    binaries: {
        getPhpIni: vi.fn(),
        savePhpIni: vi.fn(),
        resetPhpIni: vi.fn(),
    },
    projects: {
        getAll: vi.fn(),
        restart: vi.fn(),
    },
};

beforeEach(() => {
    Object.defineProperty(window, 'devbox', { value: mockDevbox, writable: true, configurable: true });
    vi.clearAllMocks();
});

function renderEditor(props = {}) {
    return render(
        <ModalProvider>
            <PhpIniEditor version="8.3" isOpen={true} onClose={vi.fn()} {...props} />
        </ModalProvider>
    );
}

describe('PhpIniEditor', () => {
    // ═══════════════════════════════════════════════════════════════════
    // Rendering
    // ═══════════════════════════════════════════════════════════════════

    describe('Rendering', () => {
        it('renders nothing when isOpen=false', () => {
            render(
                <ModalProvider>
                    <PhpIniEditor version="8.3" isOpen={false} onClose={vi.fn()} />
                </ModalProvider>
            );
            expect(screen.queryByText(/PHP 8.3/)).not.toBeInTheDocument();
        });

        it('renders the header with version', async () => {
            mockDevbox.binaries.getPhpIni.mockResolvedValue('[PHP]\nmemory_limit=128M');
            renderEditor();
            await waitFor(() => expect(screen.getByText(/PHP 8.3 Configuration/)).toBeInTheDocument());
        });

        it('shows loading indicator initially', () => {
            mockDevbox.binaries.getPhpIni.mockReturnValue(new Promise(() => { })); // never resolves
            renderEditor();
            // Loading spinner should be visible
            const spinner = document.querySelector('.animate-spin');
            expect(spinner).toBeTruthy();
        });

        it('shows textarea with INI content after loading', async () => {
            const iniContent = '[PHP]\nmemory_limit=256M\nmax_execution_time=30';
            mockDevbox.binaries.getPhpIni.mockResolvedValue(iniContent);
            renderEditor();
            await waitFor(() => {
                const textarea = screen.getByRole('textbox');
                expect(textarea.value).toContain('memory_limit=256M');
            });
        });

        it('shows error when getPhpIni fails', async () => {
            mockDevbox.binaries.getPhpIni.mockRejectedValue(new Error('File not found'));
            renderEditor();
            await waitFor(() => expect(screen.getByText('File not found')).toBeInTheDocument());
        });

        it('shows error when INI returns null', async () => {
            mockDevbox.binaries.getPhpIni.mockResolvedValue(null);
            renderEditor();
            await waitFor(() => expect(screen.getByText('php.ini file not found')).toBeInTheDocument());
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Edit / Save Actions
    // ═══════════════════════════════════════════════════════════════════

    describe('Edit and Save', () => {
        it('Save button is disabled when content is unchanged', async () => {
            mockDevbox.binaries.getPhpIni.mockResolvedValue('[PHP]\n');
            renderEditor();
            await waitFor(() => screen.getByRole('textbox'));
            const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
            expect(saveBtn).toBeDisabled();
        });

        it('Save button enabled after content change', async () => {
            mockDevbox.binaries.getPhpIni.mockResolvedValue('[PHP]\nmemory_limit=128M');
            renderEditor();
            await waitFor(() => screen.getByRole('textbox'));

            const textarea = screen.getByRole('textbox');
            fireEvent.change(textarea, { target: { value: '[PHP]\nmemory_limit=512M' } });

            const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
            expect(saveBtn).not.toBeDisabled();
        });

        it('calls savePhpIni when save is clicked', async () => {
            mockDevbox.binaries.getPhpIni.mockResolvedValue('[PHP]\n');
            mockDevbox.binaries.savePhpIni.mockResolvedValue(undefined);
            mockDevbox.projects.getAll.mockResolvedValue([]);
            renderEditor();

            await waitFor(() => screen.getByRole('textbox'));
            const textarea = screen.getByRole('textbox');
            fireEvent.change(textarea, { target: { value: '[PHP]\nupdated=true' } });

            fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
            await waitFor(() => expect(mockDevbox.binaries.savePhpIni).toHaveBeenCalledWith('8.3', '[PHP]\nupdated=true'));
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Reset
    // ═══════════════════════════════════════════════════════════════════

    describe('Reset', () => {
        it('Reset to Default button is visible', async () => {
            mockDevbox.binaries.getPhpIni.mockResolvedValue('[PHP]\n');
            renderEditor();
            await waitFor(() => screen.getByRole('textbox'));
            expect(screen.getByRole('button', { name: /Reset to Default/i })).toBeInTheDocument();
        });
    });
});
