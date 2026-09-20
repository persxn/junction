import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * `strictPort` is not a preference: the backend's CORS allowlist contains exactly
 * `http://localhost:5173` (ruling A3), so a dev server that quietly moved to 5174
 * would be rejected by the API and look like a shell bug.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: { port: 5173, strictPort: true, host: '127.0.0.1' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'chrome120', sourcemap: true },
});
