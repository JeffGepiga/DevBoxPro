import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    // Global define for build-time constants (applies to all projects)
    define: {
        '__APP_VERSION__': JSON.stringify('1.0.0-test'),
        '__APP_NAME__': JSON.stringify('devbox-pro'),
    },
    test: {
        globals: true,
        setupFiles: ['tests/helpers/setup.js'],

        // Vitest 4.x: use projects instead of workspace
        projects: [
            // Main process tests (Node environment)
            {
                define: {
                    '__APP_VERSION__': JSON.stringify('1.0.0-test'),
                    '__APP_NAME__': JSON.stringify('devbox-pro'),
                },
                test: {
                    name: 'main',
                    include: ['tests/main/**/*.test.{js,ts}', 'tests/shared/**/*.test.{js,ts}'],
                    environment: 'node',
                },
            },
            // Renderer process tests (jsdom environment)
            {
                define: {
                    '__APP_VERSION__': JSON.stringify('1.0.0-test'),
                    '__APP_NAME__': JSON.stringify('devbox-pro'),
                },
                test: {
                    name: 'renderer',
                    include: ['tests/renderer/**/*.test.{js,jsx,ts,tsx}'],
                    environment: 'jsdom',
                    globals: true,
                    setupFiles: ['tests/renderer/setup.js'],
                },
                resolve: {
                    alias: {
                        '@': path.resolve(__dirname, 'src/renderer/src'),
                        'react': path.resolve(__dirname, 'node_modules/react'),
                        'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
                        'react-router-dom': path.resolve(__dirname, 'node_modules/react-router-dom'),
                        'react/jsx-runtime': path.resolve(__dirname, 'node_modules/react/jsx-runtime'),
                        'react/jsx-dev-runtime': path.resolve(__dirname, 'node_modules/react/jsx-dev-runtime'),
                    },
                },
            },
        ],
    },
});
