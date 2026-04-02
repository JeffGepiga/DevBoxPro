import { test, expect } from './fixtures';

async function createCustomProject(page, uniqueProjectName) {
  await page.click('a:has-text("Projects")');
  await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 10000 }).catch(() => {});
  await expect(page.locator('h1:has-text("Projects")').or(page.locator('h2:has-text("Projects")'))).toBeVisible({ timeout: 10000 });

  await page.click('main >> a:has-text("New Project")');
  await expect(page.locator('text=Create New Project')).toBeVisible();

  await page.click('text="Custom PHP"');
  const nextButton = page.getByRole('button', { name: 'Next', exact: true });
  await expect(nextButton).toBeEnabled();
  await nextButton.click();

  await expect(page.getByRole('heading', { name: 'Project Details' }).or(page.locator('text=Project Details'))).toBeVisible();
  await page.fill('input[type="text"] >> nth=0', uniqueProjectName);
  await page.click('input[type="text"] >> nth=1');

  await expect(nextButton).toBeEnabled();
  await nextButton.click();

  await expect(page.getByRole('heading', { name: 'Configure Services' }).or(page.locator('text=Configure Services'))).toBeVisible();
  await expect(nextButton).toBeEnabled();
  await nextButton.click();

  await expect(page.getByRole('heading', { name: 'Domain Configuration' }).or(page.locator('text=Domain & Server'))).toBeVisible();
  await expect(nextButton).toBeEnabled();
  await nextButton.click();

  const submitButton = page.getByRole('button', { name: 'Create Project' });
  await expect(submitButton).toBeVisible();
  await expect(submitButton).toBeEnabled();
  await submitButton.click();

  await page.waitForURL(/\/projects\/[^/]+$/, { timeout: 20000 });
  await page.waitForSelector('.animate-spin', { state: 'detached', timeout: 10000 }).catch(() => {});
  await expect(page.locator(`h1:has-text("${uniqueProjectName}")`).or(page.locator(`h2:has-text("${uniqueProjectName}")`))).toBeVisible({ timeout: 15000 });
}

test.describe('DevBoxPro Tunnel Smoke Tests', () => {
  test('shows tunnel tools in Binaries and readiness in Services', async ({ page }) => {
    await page.click('a:has-text("Binaries")');
    await expect(page.locator('h1:has-text("Binary")').or(page.locator('h2:has-text("Binary")'))).toBeVisible();

    await page.getByRole('button', { name: /Tools/i }).click();
    await expect(page.locator('text=Cloudflare Tunnel')).toBeVisible();
    await expect(page.locator('text=zrok App-Wide Setup')).toBeVisible();
    await expect(page.locator('text=Enable zrok once here, then any project can use it for internet sharing.')).toBeVisible();

    await page.click('a:has-text("Services")');
    await expect(page.locator('text=Cloudflare Tunnel')).toBeVisible();
    await expect(page.locator('text=Active Public Tunnels')).toBeVisible();
    await expect(page.locator('text=No app setup required')).toBeVisible();
    await expect(page.locator('text=Needs app-wide setup').or(page.locator('text=App-wide setup complete'))).toBeVisible();
  });

  test('starts a public tunnel from Project Detail and surfaces it in Services', async ({ page }) => {
    test.setTimeout(90000);

    const uniqueProjectName = `tunnel-e2e-${Date.now()}`;
    await createCustomProject(page, uniqueProjectName);

    const stopProjectButton = page.getByRole('button', { name: /^Stop$/i }).first();
    const startProjectButton = page.getByRole('button', { name: /^Start$/i }).first();

    if (await stopProjectButton.isVisible().catch(() => false)) {
      await stopProjectButton.click();
      await expect(startProjectButton).toBeVisible({ timeout: 15000 });
    }

    const shareOnInternetToggle = page.locator('text=Share on Internet').locator('xpath=ancestor::div[contains(@class,"justify-between")][1]//label');
    await shareOnInternetToggle.click();
    await expect(page.getByText('Public Tunnel', { exact: true })).toBeVisible();

    const providerSelect = page.locator('text=Provider').locator('xpath=ancestor::div[1]').locator('select');
    await providerSelect.selectOption('cloudflared');

    const saveChangesButton = page.getByRole('button', { name: /Save Changes/i });
    await expect(saveChangesButton).toBeVisible();
    await saveChangesButton.click();

    await expect(saveChangesButton).not.toBeVisible({ timeout: 10000 });

    if (await startProjectButton.isVisible().catch(() => false)) {
      await startProjectButton.click();
      await expect(stopProjectButton).toBeVisible({ timeout: 15000 });
    }

    await expect(page.locator('text=Share on Internet')).toBeVisible();
    await expect(page.getByRole('button', { name: /Start Sharing/i })).toBeEnabled();
    await page.getByRole('button', { name: /Start Sharing/i }).click();

    await expect(page.locator('text=https://playwright-share.trycloudflare.com')).toBeVisible();

    await page.click('a:has-text("Services")');
    await expect(page.locator('text=Active Public Tunnels')).toBeVisible();
    const activeTunnelsCard = page.getByRole('heading', { name: 'Active Public Tunnels' }).locator('xpath=ancestor::div[contains(@class,"card")][1]');
    await expect(activeTunnelsCard.getByText(uniqueProjectName, { exact: true })).toBeVisible();
    await expect(activeTunnelsCard.getByText('https://playwright-share.trycloudflare.com', { exact: true })).toBeVisible();
  });
});