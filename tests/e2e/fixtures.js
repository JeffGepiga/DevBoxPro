import { test as base, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import { promises as fsp } from 'fs';

const realConfigPath = path.join(os.homedir(), '.devbox-pro', 'devbox-pro-config.json');

// Setup highly-isolated test environments for each Playwright test worker
export const test = base.extend({
    // Worker-scoped fixture: backs up the real config before the first test and
    // restores it after the last test in this worker — safety net if isolation fails.
    _realConfigGuard: [async ({ }, use) => {
        let backup = null;
        try {
            backup = await fsp.readFile(realConfigPath, 'utf8');
        } catch {
            // Config doesn't exist yet — nothing to back up
        }

        await use(null);

        // Restore the real config after all tests in this worker
        if (backup !== null) {
            try {
                await fsp.mkdir(path.dirname(realConfigPath), { recursive: true });
                await fsp.writeFile(realConfigPath, backup, 'utf8');
            } catch (e) {
                console.error('[e2e fixture] Failed to restore real config:', e.message);
            }
        }
    }, { scope: 'worker', auto: true }],

    electronApp: async ({ }, use) => {
        // Determine the path to the main process entry
        const mainEntry = path.join(__dirname, '..', '..', 'src', 'main', 'main.js');

        // Create a temporary, random user data directory for true isolation
        const tempUserDataDir = path.join(os.tmpdir(), `devbox-e2e-${crypto.randomUUID()}`);

        const envArgs = {
            ...process.env,
            NODE_ENV: 'production',
            PLAYWRIGHT_TEST: 'true',
            TEST_USER_DATA_DIR: tempUserDataDir,
        };
        delete envArgs.ELECTRON_RUN_AS_NODE;

        // Launch Electron via Playwright.
        // --playwright-e2e <dir> is a CLI arg (always received, unlike env vars on Windows)
        // that forces the main process into test mode and sets the data dir.
        const electronApp = await electron.launch({
            args: [mainEntry, '--user-data-dir', tempUserDataDir, '--playwright-e2e', tempUserDataDir],
            env: envArgs
        });

        // Pass control back to the test
        await use(electronApp);

        // Teardown: close app
        await electronApp.close();

        // Remove the temp user data dir so no leftover files accumulate
        try {
            await fsp.rm(tempUserDataDir, { recursive: true, force: true });
        } catch {
            // Ignore cleanup errors — temp dir will be cleared by the OS eventually
        }
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
