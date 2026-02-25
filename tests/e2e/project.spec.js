import { test, expect } from './fixtures';

test.describe('DevBoxPro Project Lifecycle', () => {

    test('Creates a new project successfully', async ({ page }) => {
        // Go to Projects page
        await page.click('a:has-text("Projects")');
        await expect(page.locator('h1:has-text("Projects")').or(page.locator('h2:has-text("Projects")'))).toBeVisible();

        // Click New Project button (avoid the sidebar one by selecting the one in the main content)
        await page.click('main >> a:has-text("New Project")');

        // Wait for the modal/form to appear
        await expect(page.locator('text=Create New Project')).toBeVisible();

        // Step 1: Project Type
        // We need to wait for the next button to be enabled before clicking
        const nextButton = page.getByRole('button', { name: 'Next' });
        await expect(nextButton).toBeEnabled();
        await nextButton.click();

        // Step 2: Details
        // Wait for step 2 to render
        await expect(page.getByRole('heading', { name: 'Project Details' }).or(page.locator('text=Project Details'))).toBeVisible();
        await page.fill('input[type="text"] >> nth=0', 'e2e-test-project');

        // Ensure path updates
        await page.click('input[type="text"] >> nth=1');

        await expect(nextButton).toBeEnabled();
        await nextButton.click();

        // Step 3: Services
        await expect(page.getByRole('heading', { name: 'Configure Services' }).or(page.locator('text=Configure Services'))).toBeVisible();
        await expect(nextButton).toBeEnabled();
        await nextButton.click();

        // Step 4: Domain
        await expect(page.getByRole('heading', { name: 'Domain Configuration' }).or(page.locator('text=Domain & Server'))).toBeVisible();
        await expect(nextButton).toBeEnabled();
        await nextButton.click();

        // Step 5: Review
        const submitButton = page.getByRole('button', { name: 'Create Project' });
        await expect(submitButton).toBeVisible();
        await expect(submitButton).toBeEnabled();
        await submitButton.click();

        // Should return to Projects list and show the new project
        await expect(page.locator('h1:has-text("Projects")').or(page.locator('h2:has-text("Projects")'))).toBeVisible();
        await expect(page.locator('text=e2e-test-project')).toBeVisible();

        // Start project from the card
        const projectCard = page.locator('.card', { hasText: 'e2e-test-project' }).first();
        const startBtn = projectCard.locator('button[title="Start project"]').or(projectCard.locator('button:has(.status-stopped)')); // Wait what is the start button selector?
        // Let's look at ProjectTableRow or just use Project Detail view to be safer
        await page.click('text=e2e-test-project');
        await expect(page.locator('h1:has-text("e2e-test-project")').or(page.locator('h2:has-text("e2e-test-project")'))).toBeVisible();

        // Wait a bit for status to load
        await page.waitForTimeout(1000);

        // Start project (button has Play icon and text Start)
        const detailStartBtn = page.getByRole('button', { name: /Start/i }).first();
        const detailStopBtn = page.getByRole('button', { name: /Stop/i }).first();

        // If it isn't running, start it
        if (await detailStartBtn.isVisible()) {
            await detailStartBtn.click();
            await expect(detailStopBtn).toBeVisible({ timeout: 15000 });
        }

        // Now stop it
        if (await detailStopBtn.isVisible()) {
            await detailStopBtn.click();
            await expect(detailStartBtn).toBeVisible({ timeout: 15000 });
        }

        // Go back to projects list
        await page.click('a:has-text("Projects")');
        await expect(page.locator('h1:has-text("Projects")').or(page.locator('h2:has-text("Projects")'))).toBeVisible();

        // Delete project using the card menu
        const card = page.locator('.card', { hasText: 'e2e-test-project' }).first();

        // Click the "More options" menu button
        // Since we don't have a reliable aria-label, we can click the button inside the relative container next to "View Details"
        const menuBtn = card.locator('.relative button.btn-icon').first();
        await menuBtn.click();

        // Click Delete in the dropdown
        const deleteOption = card.locator('button:has-text("Delete")');
        await deleteOption.click();

        // Wait for Delete Modal
        const deleteModal = page.locator('div:has-text("Delete Project")').last(); // or wait for the h3 Delete Project
        await expect(page.locator('h3:has-text("Delete Project")')).toBeVisible();

        // Type "delete" to confirm
        await page.fill('input[placeholder="delete"]', 'delete');

        // Click the Delete Project confirmation button
        const confirmDeleteBtn = page.getByRole('button', { name: 'Delete Project' }).last();
        await confirmDeleteBtn.click();

        // Project should be gone
        await expect(page.locator('text=e2e-test-project')).not.toBeVisible({ timeout: 10000 });
    });
});
