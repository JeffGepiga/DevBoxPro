import { test, expect } from './fixtures';

test.describe('DevBoxPro Config Export', () => {
    test('Can access Advanced Settings', async ({ page }) => {
        // Wait for Dashboard
        await expect(page.locator('text=DevBox Pro')).toBeVisible();

        // Go to Settings 
        await page.click('a:has-text("Settings")');

        // Navigate to Advanced tab
        await page.click('button:has-text("Advanced")');

        // Advanced tab has "Application Updates", "Remote Configuration Updates", etc.
        await expect(page.locator('h3:has-text("Application Updates")')).toBeVisible();
    });
});
