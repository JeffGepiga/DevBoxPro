/**
 * Tests for src/renderer/src/context/ModalContext.jsx
 *
 * Phase 5 – ModalContext tests. Tests the ModalProvider
 * and useModal hook (showAlert, showConfirm).
 */
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, renderHook, cleanup } from '@testing-library/react';
import { ModalProvider, useModal } from '@/context/ModalContext';

afterEach(() => {
    cleanup();
});

describe('ModalContext', () => {
    // ═══════════════════════════════════════════════════════════════════
    // useModal hook
    // ═══════════════════════════════════════════════════════════════════

    describe('useModal()', () => {
        it('throws when used outside ModalProvider', () => {
            expect(() => {
                renderHook(() => useModal());
            }).toThrow('useModal must be used within a ModalProvider');
        });

        it('provides showAlert and showConfirm functions', () => {
            const wrapper = ({ children }) => <ModalProvider>{children}</ModalProvider>;
            const { result } = renderHook(() => useModal(), { wrapper });
            expect(typeof result.current.showAlert).toBe('function');
            expect(typeof result.current.showConfirm).toBe('function');
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // AlertModal via showAlert
    // ═══════════════════════════════════════════════════════════════════

    describe('AlertModal', () => {
        it('renders alert with string message', async () => {
            function TestComponent() {
                const { showAlert } = useModal();
                return <button onClick={() => showAlert('Test message!')}>Show</button>;
            }

            render(
                <ModalProvider>
                    <TestComponent />
                </ModalProvider>
            );

            fireEvent.click(screen.getByText('Show'));
            expect(screen.getByText('Test message!')).toBeInTheDocument();
            expect(screen.getByText('OK')).toBeInTheDocument();
        });

        it('renders alert with options object', async () => {
            function TestComponent() {
                const { showAlert } = useModal();
                return (
                    <button onClick={() => showAlert({ title: 'Error!', message: 'Failed', type: 'error' })}>
                        Show
                    </button>
                );
            }

            render(
                <ModalProvider>
                    <TestComponent />
                </ModalProvider>
            );

            fireEvent.click(screen.getByText('Show'));
            expect(screen.getByText('Error!')).toBeInTheDocument();
            expect(screen.getByText('Failed')).toBeInTheDocument();
        });

        it('closes on OK click', () => {
            function TestComponent() {
                const { showAlert } = useModal();
                return <button onClick={() => showAlert('Click OK')}>Show</button>;
            }

            render(
                <ModalProvider>
                    <TestComponent />
                </ModalProvider>
            );

            fireEvent.click(screen.getByText('Show'));
            expect(screen.getByText('Click OK')).toBeInTheDocument();
            fireEvent.click(screen.getByText('OK'));
            expect(screen.queryByText('Click OK')).not.toBeInTheDocument();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // ConfirmModal via showConfirm
    // ═══════════════════════════════════════════════════════════════════

    describe('ConfirmModal', () => {
        it('renders confirm with string message', () => {
            function TestComponent() {
                const { showConfirm } = useModal();
                return <button onClick={() => showConfirm('Are you sure?')}>Ask</button>;
            }

            render(
                <ModalProvider>
                    <TestComponent />
                </ModalProvider>
            );

            fireEvent.click(screen.getByText('Ask'));
            expect(screen.getByText('Are you sure?')).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
            expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
        });

        it('renders confirm with custom options', () => {
            function TestComponent() {
                const { showConfirm } = useModal();
                return (
                    <button
                        onClick={() =>
                            showConfirm({
                                title: 'Delete?',
                                message: 'This cannot be undone.',
                                detail: 'All data will be lost.',
                                confirmText: 'Delete',
                                cancelText: 'Keep',
                                confirmStyle: 'danger',
                            })
                        }
                    >
                        Ask
                    </button>
                );
            }

            render(
                <ModalProvider>
                    <TestComponent />
                </ModalProvider>
            );

            fireEvent.click(screen.getByText('Ask'));
            expect(screen.getByText('Delete?')).toBeInTheDocument();
            expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
            expect(screen.getByText('All data will be lost.')).toBeInTheDocument();
            expect(screen.getByText('Delete')).toBeInTheDocument();
            expect(screen.getByText('Keep')).toBeInTheDocument();
        });

        it('closes on Cancel click', () => {
            function TestComponent() {
                const { showConfirm } = useModal();
                return <button onClick={() => showConfirm('Cancel me')}>Ask</button>;
            }

            render(
                <ModalProvider>
                    <TestComponent />
                </ModalProvider>
            );

            fireEvent.click(screen.getByText('Ask'));
            expect(screen.getByText('Cancel me')).toBeInTheDocument();
            fireEvent.click(screen.getByText('Cancel'));
            expect(screen.queryByText('Cancel me')).not.toBeInTheDocument();
        });

        it('closes on Confirm click', () => {
            function TestComponent() {
                const { showConfirm } = useModal();
                return <button onClick={() => showConfirm('Confirm me')}>Ask</button>;
            }

            render(
                <ModalProvider>
                    <TestComponent />
                </ModalProvider>
            );

            fireEvent.click(screen.getByText('Ask'));
            fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
            expect(screen.queryByText('Confirm me')).not.toBeInTheDocument();
        });
    });
});
