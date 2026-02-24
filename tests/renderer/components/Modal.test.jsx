/**
 * Tests for src/renderer/src/components/Modal.jsx
 *
 * Phase 5 – Modal component tests. Tests AlertModal and ConfirmModal
 * directly with props (not via context).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AlertModal, ConfirmModal } from '@/components/Modal';

afterEach(() => {
    cleanup();
});

describe('AlertModal', () => {
    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <AlertModal isOpen={false} onClose={() => { }} title="Test" message="Hello" />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders title and message when open', () => {
        render(
            <AlertModal isOpen={true} onClose={() => { }} title="Warning" message="Something happened" />
        );
        expect(screen.getByText('Warning')).toBeInTheDocument();
        expect(screen.getByText('Something happened')).toBeInTheDocument();
    });

    it('has an OK button', () => {
        render(
            <AlertModal isOpen={true} onClose={() => { }} title="T" message="M" />
        );
        expect(screen.getByText('OK')).toBeInTheDocument();
    });

    it('calls onClose when OK clicked', () => {
        const onClose = vi.fn();
        render(
            <AlertModal isOpen={true} onClose={onClose} title="T" message="M" />
        );
        fireEvent.click(screen.getByText('OK'));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose when backdrop clicked', () => {
        const onClose = vi.fn();
        const { container } = render(
            <AlertModal isOpen={true} onClose={onClose} title="T" message="M" />
        );
        // The backdrop is the first div child with absolute positioning
        const backdrop = container.querySelector('.absolute');
        fireEvent.click(backdrop);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onClose on Escape key', () => {
        const onClose = vi.fn();
        render(
            <AlertModal isOpen={true} onClose={onClose} title="T" message="M" />
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('ConfirmModal', () => {
    const defaultProps = {
        isOpen: true,
        onConfirm: vi.fn(),
        onCancel: vi.fn(),
        title: 'Delete?',
        message: 'Are you sure?',
    };

    it('renders nothing when isOpen is false', () => {
        const { container } = render(
            <ConfirmModal {...defaultProps} isOpen={false} />
        );
        expect(container.innerHTML).toBe('');
    });

    it('renders title and message when open', () => {
        render(<ConfirmModal {...defaultProps} />);
        expect(screen.getByText('Delete?')).toBeInTheDocument();
        expect(screen.getByText('Are you sure?')).toBeInTheDocument();
    });

    it('renders Cancel button', () => {
        render(<ConfirmModal {...defaultProps} />);
        expect(screen.getByText('Cancel')).toBeInTheDocument();
    });

    it('renders detail when provided', () => {
        render(
            <ConfirmModal {...defaultProps} detail="This cannot be undone." />
        );
        expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    });

    it('renders custom button text', () => {
        render(
            <ConfirmModal {...defaultProps} confirmText="Remove" cancelText="Keep" />
        );
        expect(screen.getByText('Remove')).toBeInTheDocument();
        expect(screen.getByText('Keep')).toBeInTheDocument();
    });

    it('calls onConfirm when confirm button clicked', () => {
        const onConfirm = vi.fn();
        render(
            <ConfirmModal {...defaultProps} onConfirm={onConfirm} confirmText="Yes" />
        );
        fireEvent.click(screen.getByText('Yes'));
        expect(onConfirm).toHaveBeenCalledOnce();
    });

    it('calls onCancel when cancel button clicked', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmModal {...defaultProps} onCancel={onCancel} />
        );
        fireEvent.click(screen.getByText('Cancel'));
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel on Escape key', () => {
        const onCancel = vi.fn();
        render(
            <ConfirmModal {...defaultProps} onCancel={onCancel} />
        );
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(onCancel).toHaveBeenCalledOnce();
    });

    it('calls onCancel when backdrop clicked', () => {
        const onCancel = vi.fn();
        const { container } = render(
            <ConfirmModal {...defaultProps} onCancel={onCancel} />
        );
        const backdrop = container.querySelector('.absolute');
        fireEvent.click(backdrop);
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
