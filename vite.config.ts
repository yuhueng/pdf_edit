import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['share-target-sw.js', 'icon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'YH PDF Edit',
        short_name: 'YH PDF',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#f6f5f1',
        theme_color: '#f6f5f1',
        // "Open with" on desktop Chrome/Edge: PDFs open straight in the Edit tab (src/lib/launch.ts).
        file_handlers: [{ action: '/?open=edit', accept: { 'application/pdf': ['.pdf'] } }],
        // Android Share sheet: the service worker (public/share-target-sw.js) receives the PDF.
        share_target: {
          action: '/share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: { files: [{ name: 'pdf', accept: ['application/pdf', '.pdf'] }] },
        },
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,woff2,wasm}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
        // Runs first, so a shared PDF (POST /share-target) is handled before Workbox's routes.
        importScripts: ['share-target-sw.js'],
        // The 10 MB MuPDF engine and the test Lab are not needed to install or merge; they are cached on first use.
        globIgnores: ['**/mupdf-wasm-*.wasm', '**/Lab-*.js'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => /\/assets\/(mupdf-wasm-.*\.wasm|Lab-.*\.js)$/.test(url.pathname),
            handler: 'CacheFirst',
            options: { cacheName: 'on-demand-engine', expiration: { maxEntries: 4 } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'es2022',
  },
  worker: {
    format: 'es',
  },
});
