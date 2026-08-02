import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Builds straight into ../public, which src/server.js already serves as
// static files — no server changes needed. Anything placed in this project's
// own public/ (e.g. tracker.js) is copied through untouched on every build.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: '../public',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3400',
      '/healthz': 'http://localhost:3400',
    },
  },
});
