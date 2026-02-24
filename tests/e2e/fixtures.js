import { test as base, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

// Setup highly-isolated test environments for each Playwright test worker
export const test = base.extend({
    electronApp: async ({ }, use) => {
        // Determine the path to the main process entry
        const mainEntry = path.join(__dirname, '..', '..', 'src', 'main', 'main.js');

        // Create a temporary, random user data directory for true isolation
        const tempUserDataDir = path.join(os.tmpdir(), `devbox-e2e-${crypto.randomUUID()}`);

        // Launch Electron via Playwright
        const electronApp = await electron.launch({
            args: [mainEntry, '--user-data-dir', tempUserDataDir],
            env: {
                ...process.env,
                NODE_ENV: 'production',
                PLAYWRIGHT_TEST: 'true', // Optional flag for internal mocking if needed
            }
        });

        // Pass control back to the test
        await use(electronApp);

        // Teardown: close app
        await electronApp.close();
    },

    page: async ({ electronApp }, use) => {
        // The first window that opens is our main application window
        const window = await electronApp.firstWindow();

        // Wait for React to mount and render the initial layout
        await window.waitForSelector('#root', { state: 'attached' });

        // Mock binaries status so the UI thinks we have PHP and NGINX installed 
        // without downloading 100MB of binaries every test run
        await window.addInitScript(() => {
            if (window.devbox && window.devbox.binaries) {
                const originalGetStatus = window.devbox.binaries.getStatus;
                window.devbox.binaries.getStatus = async () => {
                    const realStatus = await originalGetStatus();
                    return {
                        ...realStatus,
                        php: { '8.2': { installed: true, version: '8.2.0' } },
                        nginx: { '1.24': { installed: true, version: '1.24.0' } },
                        mysql: { '8.0': { installed: true, version: '8.0.32' } }
                    };
                };
            }
        });

        await use(window);
    }
});

export { expect };
