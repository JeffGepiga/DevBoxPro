import { test, expect } from './fixtures';

test.describe('DevBoxPro Core Smoke Tests', () => {

    test('App launches and displays the dashboard', async ({ page }) => {
        // Wait for the window title to be set (App title is managed by Main process usually, or Document title)
        await expect(page).toHaveTitle(/DevBox Pro|Dashboard/i);

        // Sidebar should be visible
        await expect(page.locator('text=DevBox Pro')).toBeVisible();
        await expect(page.locator('a:has-text("Dashboard")')).toBeVisible();

        // Main content area should say Dashboard
        // In our component it's an h1 or large text usually
        await expect(page.locator('h1:has-text("Dashboard")').or(page.locator('h2:has-text("Dashboard")'))).toBeVisible();

        // Should indicate empty state since this is a fresh user-data-dir
        await expect(page.locator('text=Total Projects')).toBeVisible();
        await expect(page.locator('text=No projects yet')).toBeVisible();
    });

    test('Sidebar navigation works', async ({ page }) => {
        // Navigate to Projects
        await page.click('a:has-text("Projects")');
        // Wait for the exact heading 'Projects' 
        await expect(page.locator('h1:has-text("Projects")').or(page.locator('h2:has-text("Projects")'))).toBeVisible();
        await expect(page.locator('text=Create your first project')).toBeVisible();

        // Navigate to Services
        await page.click('a:has-text("Services")');
        await expect(page.locator('h1:has-text("Services")').or(page.locator('h2:has-text("Services")'))).toBeVisible();

        // Navigate to Settings
        await page.click('a:has-text("Settings")');
        await expect(page.locator('h1:has-text("Settings")').or(page.locator('h2:has-text("Settings")'))).toBeVisible();
        await expect(page.locator('text=General')).toBeVisible();

        // Navigate back to Dashboard
        await page.click('a:has-text("Dashboard")');
        await expect(page.locator('h1:has-text("Dashboard")').or(page.locator('h2:has-text("Dashboard")'))).toBeVisible();
    });
});
