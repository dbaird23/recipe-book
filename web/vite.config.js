import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Proxy to `wrangler dev` (the Worker), so local dev runs the real backend
    proxy: {
      '/api': 'http://localhost:8787',
      '/uploads': 'http://localhost:8787',
      '/mcp': 'http://localhost:8787',
      // The OAuth endpoints and their discovery documents, so a client pointed
      // at the dev server finds the same shape it would in production.
      '/oauth': 'http://localhost:8787',
      '/.well-known': 'http://localhost:8787',
    },
  },
});
