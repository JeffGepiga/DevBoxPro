import { test, expect } from './fixtures';

test.describe('DevBoxPro Database Workflow', () => {

    test('Creates, checks and deletes a database', async ({ page }) => {
        // Wait for the Dashboard
        await expect(page.locator('text=DevBox Pro')).toBeVisible();

        // Navigate to Databases
        await page.click('a:has-text("Databases")');
        await expect(page.locator('h1:has-text("Databases")').or(page.locator('h2:has-text("Databases")'))).toBeVisible();

        // Verify that the "New Database" button is present and click it
        const newDbBtn = page.getByRole('button', { name: /New Database/i }).first();
        await newDbBtn.click();

        // Modal should appear
        await expect(page.locator('h3:has-text("Create Database")')).toBeVisible();

        // Fill db name
        await page.fill('input[placeholder="my_database"]', 'e2e_db');

        // Click Create (it might be the only button with text Create)
        const createBtn = page.getByRole('button', { name: "Create" }).last();
        await createBtn.click();

        // New DB should appear in the list under "Your Databases"
        // Wait for modal to close
        await expect(page.locator('h3:has-text("Create Database")')).not.toBeVisible();

        // Find the database card
        const dbCard = page.locator('.card', { hasText: 'e2e_db' }).first();
        await expect(dbCard).toBeVisible();

        // Delete the DB
        // The delete button has title="Delete database"
        const deleteDbBtn = dbCard.locator('button[title="Delete database"]');
        await deleteDbBtn.click();

        // Confirm
        const confirmDel = page.getByRole('button', { name: /Delete|Confirm/i }).last();
        await expect(confirmDel).toBeVisible();
        await confirmDel.click();

        // DB should be gone
        await expect(page.locator('text=e2e_db').first()).not.toBeVisible();
    });
});
