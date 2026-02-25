import { test, expect } from './fixtures';

test.describe('DevBoxPro Binary Manager Workflow', () => {
    test('Lists services in Binary Manager and allows starting from Services', async ({ page }) => {
        // Wait for Dashboard
        await expect(page.locator('text=DevBox Pro')).toBeVisible();

        // Go to Binaries
        await page.click('a:has-text("Binaries")');
        await expect(page.locator('h1:has-text("Binary Manager")').or(page.locator('h2:has-text("Binaries")'))).toBeVisible();

        // Check if a service is mocked as installed by fixture
        await expect(page.locator('text=PHP').or(page.locator('text=MySQL')).first()).toBeVisible();

        // The mocking marks them as installed. So we don't actually download, just verify UI lists them.

        // Go to Services to start one of the mocked binaries
        await page.click('a:has-text("Services")');
        await expect(page.locator('h1:has-text("Services")').or(page.locator('h2:has-text("Services")'))).toBeVisible();

        // Wait for services to be rendered
        await page.waitForTimeout(1000);

        // Find the first Start or Restart button
        const startBtn = page.getByRole('button', { name: /Start|Restart/i }).first();
        if (await startBtn.isVisible()) {
            await startBtn.click();

            // Check if it toggles to Stop after starting
            const stopBtn = page.getByRole('button', { name: /Stop/i }).first();
            await expect(stopBtn).toBeVisible({ timeout: 15000 });
        }
    });
});
