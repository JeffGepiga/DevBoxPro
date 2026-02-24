/**
 * Tests for src/renderer/src/components/InstallationProgress.jsx
 *
 * Phase 5 – Testing the InstallationProgress modal UI states and behavior.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import InstallationProgress from '@/components/InstallationProgress';

afterEach(() => {
    cleanup();
});

describe('InstallationProgress', () => {
    const defaultProps = {
        isVisible: true,
        output: [],
        isComplete: false,
        hasError: false,
        onClose: vi.fn(),
        onFixManually: vi.fn(),
        projectName: 'test-app',
        projectType: 'laravel',
    };

    it('renders nothing when isVisible is false', () => {
        const { container } = render(<InstallationProgress {...defaultProps} isVisible={false} />);
        expect(container.innerHTML).toBe('');
    });

    it('renders loading state when open and not complete', () => {
        render(<InstallationProgress {...defaultProps} />);
        expect(screen.getByText('Installing Laravel...')).toBeInTheDocument();
        expect(screen.getByText('This may take a few minutes...')).toBeInTheDocument();
        expect(screen.getByText('Starting installation...')).toBeInTheDocument(); // when output is empty
    });

    it('renders success state when complete without error', () => {
        render(<InstallationProgress {...defaultProps} isComplete={true} hasError={false} />);
        expect(screen.getByText('Installation Complete')).toBeInTheDocument();
        expect(screen.getByText('Your Laravel project is ready')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'View Project' })).toBeInTheDocument();
    });

    it('renders error state when complete with error', () => {
        render(<InstallationProgress {...defaultProps} isComplete={true} hasError={true} />);
        expect(screen.getByText('Installation Issue')).toBeInTheDocument();
        expect(screen.getByText('You can fix this manually or retry later')).toBeInTheDocument();
        expect(screen.getByText(/Your project "test-app" has been created/)).toBeInTheDocument();
    });

    it('calls onClose when View Project button is clicked on success', () => {
        const onClose = vi.fn();
        render(<InstallationProgress {...defaultProps} isComplete={true} hasError={false} onClose={onClose} />);
        fireEvent.click(screen.getByRole('button', { name: 'View Project' }));
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('calls onFixManually when Fix it Manually is clicked on error', () => {
        const onFixManually = vi.fn();
        render(
            <InstallationProgress
                {...defaultProps}
                isComplete={true}
                hasError={true}
                onFixManually={onFixManually}
            />
        );
        fireEvent.click(screen.getByRole('button', { name: /I'll Fix It Manually/i }));
        expect(onFixManually).toHaveBeenCalledOnce();
    });

    it('renders Close button instead of Fix it Manually if no onFixManually provided', () => {
        const onClose = vi.fn();
        render(
            <InstallationProgress
                {...defaultProps}
                isComplete={true}
                hasError={true}
                onFixManually={undefined}
                onClose={onClose}
            />
        );
        const closeBtn = screen.getByRole('button', { name: 'Close' });
        expect(closeBtn).toBeInTheDocument();
        fireEvent.click(closeBtn);
        expect(onClose).toHaveBeenCalledOnce();
    });

    it('renders output lines correctly', () => {
        const output = [
            { type: 'command', text: 'composer install' },
            { type: 'stdout', text: 'installing dependencies' },
            { type: 'error', text: 'missing extension' },
        ];
        render(<InstallationProgress {...defaultProps} output={output} />);

        expect(screen.getByText('composer install')).toHaveClass('text-yellow-400');
        expect(screen.getByText('installing dependencies')).toHaveClass('text-gray-300');
        expect(screen.getByText('missing extension')).toHaveClass('text-red-400');
    });

    it('formats display label for different project types correctly', () => {
        const { unmount } = render(<InstallationProgress {...defaultProps} projectType="empty" />);
        expect(screen.getByText('Installing PHP...')).toBeInTheDocument();
        unmount();

        render(<InstallationProgress {...defaultProps} projectType="wordpress" />);
        expect(screen.getByText('Installing WordPress...')).toBeInTheDocument();
    });
});
