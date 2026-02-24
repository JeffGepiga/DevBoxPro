import { defineConfig } from '@playwright/test';
import path from 'path';

export default defineConfig({
    testDir: './tests/e2e',
    timeout: 30000,
    expect: {
        timeout: 5000
    },
    fullyParallel: false,
    retries: process.env.CI ? 2 : 0,
    workers: 1, // Electron tests cannot be reliably parallelized without managing distinct user-data-dir paths
    reporter: 'html',
    use: {
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
    },
});
