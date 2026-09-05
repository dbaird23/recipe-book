import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // The service worker: what makes the app open with no signal. The shell
    // (HTML, scripts, styles, icons) is stored on install and refreshed in
    // the background on later visits. Beyond it, only two kinds of thing are
    // worth keeping: the font, and recipe photos as they're seen, which the
    // Worker already serves as unchanging. Nothing under /api is cached
    // here; what the server said is the app's to keep (see offline.js), so
    // a change made offline shows over it rather than under it.
    VitePWA({
      // The manifest and the icons are hand-written in public/, and
      // index.html already links them; likewise the registration is ours
      manifest: false,
      injectRegister: null,
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,webmanifest}'],
        // Every path the app is opened at is the one shell. The Worker's own
        // endpoints are named so a navigation to one is never answered with it
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/uploads\//, /^\/mcp/, /^\/oauth\//, /^\/\.well-known\//],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\//,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'font-css', expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\//,
            handler: 'CacheFirst',
            options: {
              cacheName: 'font-files',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith('/uploads/'),
            handler: 'CacheFirst',
            options: { cacheName: 'photos', expiration: { maxEntries: 400, maxAgeSeconds: 60 * 60 * 24 * 90 } },
          },
        ],
      },
    }),
  ],
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
