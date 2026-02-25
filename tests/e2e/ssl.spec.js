import { test, expect } from './fixtures';

test.describe('DevBoxPro SSL Configuration', () => {
    test('Can toggle SSL setting', async ({ page }) => {
        // Wait for the app to load
        await expect(page.locator('text=DevBox Pro')).toBeVisible();

        // Go to Settings
        await page.click('a:has-text("Settings")');
        await expect(page.locator('h1:has-text("Settings")').or(page.locator('h2:has-text("Settings")'))).toBeVisible();

        // Navigate to Network tab
        await page.click('button:has-text("Network")');

        // Find SSL toggle
        await expect(page.locator('text=Enable SSL by default')).toBeVisible();
        const sslCheckbox = page.locator('input[type="checkbox"]').last();

        // Click the checkbox
        await sslCheckbox.click();

        // Save
        const saveBtn = page.locator('button:has-text("Save Changes")');
        await saveBtn.click();

        // Check if saved
        await expect(page.locator('button:has-text("Saved!")')).toBeVisible({ timeout: 5000 });
    });
});
