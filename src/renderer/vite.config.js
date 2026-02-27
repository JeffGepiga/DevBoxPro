import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { readFileSync } from 'fs';

// Read version from root package.json (single source of truth)
const rootPackageJson = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8')
);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  root: __dirname,
  define: {
    // Inject version at build time from package.json
    '__APP_VERSION__': JSON.stringify(rootPackageJson.version),
    '__APP_NAME__': JSON.stringify(rootPackageJson.name),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Icon library (large)
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    strictPort: true,
  },
});

