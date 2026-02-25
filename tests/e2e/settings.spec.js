import { test, expect } from './fixtures';

test.describe('DevBoxPro Settings Persistence', () => {
    test('Changes settings, saves, and retains them', async ({ page }) => {
        // Wait for Dashboard
        await expect(page.locator('text=DevBox Pro')).toBeVisible();

        // Go to Settings
        await page.click('a:has-text("Settings")');
        await expect(page.locator('h1:has-text("Settings")').or(page.locator('h2:has-text("Settings")'))).toBeVisible();

        // Change Default Editor in General Tab
        const editorSelect = page.locator('select').first();
        await editorSelect.selectOption({ label: 'Notepad++' });

        // Save
        const saveBtn = page.getByRole('button', { name: "Save Changes" });
        await saveBtn.click();

        // Check if saved
        await expect(page.locator('button:has-text("Saved!")')).toBeVisible({ timeout: 5000 });

        // Navigate away and back to verify persistence
        await page.click('a:has-text("Dashboard")');
        await expect(page.locator('h1:has-text("Dashboard")').or(page.locator('h2:has-text("Dashboard")'))).toBeVisible();
        await page.click('a:has-text("Settings")');

        // Check value
        await expect(editorSelect).toHaveValue('notepadpp');
    });
});
