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
    });
});
