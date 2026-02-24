/**
 * Tests for src/renderer/src/components/Sidebar.jsx
 *
 * Phase 5 – Sidebar tests. Tests navigation items, dark mode toggle,
 * and active route highlighting. Requires react-router-dom MemoryRouter.
 */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Sidebar from '@/components/Sidebar';

function renderSidebar(props = {}, initialRoute = '/') {
    const defaultProps = {
        darkMode: false,
        setDarkMode: vi.fn(),
        ...props,
    };
    return render(
        <MemoryRouter initialEntries={[initialRoute]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Sidebar {...defaultProps} />
        </MemoryRouter>
    );
}

describe('Sidebar', () => {
    // ═══════════════════════════════════════════════════════════════════
    // Rendering
    // ═══════════════════════════════════════════════════════════════════

    describe('Rendering', () => {
        it('renders the app name', () => {
            renderSidebar();
            expect(screen.getByText('DevBox Pro')).toBeInTheDocument();
        });

        it('renders all navigation items', () => {
            renderSidebar();
            expect(screen.getByText('Dashboard')).toBeInTheDocument();
            expect(screen.getByText('Projects')).toBeInTheDocument();
            expect(screen.getByText('Services')).toBeInTheDocument();
            expect(screen.getByText('Databases')).toBeInTheDocument();
            expect(screen.getByText('Logs')).toBeInTheDocument();
            expect(screen.getByText('Binaries')).toBeInTheDocument();
        });

        it('renders Settings link', () => {
            renderSidebar();
            expect(screen.getByText('Settings')).toBeInTheDocument();
        });

        it('renders New Project button', () => {
            renderSidebar();
            expect(screen.getByText('New Project')).toBeInTheDocument();
        });

        it('renders version number', () => {
            renderSidebar();
            expect(screen.getByText(/Version/)).toBeInTheDocument();
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Dark Mode Toggle
    // ═══════════════════════════════════════════════════════════════════

    describe('Dark Mode Toggle', () => {
        it('shows "Dark Mode" when in light mode', () => {
            renderSidebar({ darkMode: false });
            expect(screen.getByText('Dark Mode')).toBeInTheDocument();
        });

        it('shows "Light Mode" when in dark mode', () => {
            renderSidebar({ darkMode: true });
            expect(screen.getByText('Light Mode')).toBeInTheDocument();
        });

        it('calls setDarkMode when toggled', () => {
            const setDarkMode = vi.fn();
            renderSidebar({ darkMode: false, setDarkMode });
            fireEvent.click(screen.getByText('Dark Mode'));
            expect(setDarkMode).toHaveBeenCalledWith(true);
        });
    });

    // ═══════════════════════════════════════════════════════════════════
    // Navigation Links
    // ═══════════════════════════════════════════════════════════════════

    describe('Navigation Links', () => {
        it('navigation items are links with correct hrefs', () => {
            renderSidebar();
            const dashboardLink = screen.getByText('Dashboard').closest('a');
            expect(dashboardLink).toHaveAttribute('href', '/');

            const projectsLink = screen.getByText('Projects').closest('a');
            expect(projectsLink).toHaveAttribute('href', '/projects');

            const servicesLink = screen.getByText('Services').closest('a');
            expect(servicesLink).toHaveAttribute('href', '/services');
        });

        it('New Project button links to /projects/new', () => {
            renderSidebar();
            const newProjectLink = screen.getByText('New Project').closest('a');
            expect(newProjectLink).toHaveAttribute('href', '/projects/new');
        });
    });
});
