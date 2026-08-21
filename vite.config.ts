/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * GitHub Pages serves this repo at a SUBPATH (/polish-tracker/), not the domain root.
 * `npm run dev` still has to serve from `/`, so this is conditional on the Vite command
 * rather than a fixed value — getting it wrong here is exactly what breaks "Add to Home
 * Screen" silently, since the manifest's scope/start_url and every asset URL depend on it.
 */
const BASE = '/polish-tracker/';

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const base = command === 'build' ? BASE : '/';

  return {
    base,
    plugins: [
      react(),
      // Not polish: her offline copy only survives being evicted by iOS's 7-day
      // script-writable-storage cap once the app is installed as a standalone PWA — see
      // the README's "Why PWA install matters more than it looks". This is what makes
      // that installable and what serves the app shell when she opens it with no signal.
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.svg', 'icons.svg'],
        manifest: {
          name: 'Polish',
          short_name: 'Polish',
          description: 'Nail polish collection, wear log, and wishlist.',
          theme_color: '#8E4A63',
          background_color: '#FFFBFC',
          display: 'standalone',
          start_url: base,
          scope: base,
          icons: [
            { src: `${base}icon-192.png`, sizes: '192x192', type: 'image/png' },
            { src: `${base}icon-512.png`, sizes: '512x512', type: 'image/png' },
            {
              src: `${base}icon-512-maskable.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // The app shell only — API calls (GitHub Contents) are never cached here.
          // Offline data already goes through IndexedDB (data/repositories/offline.ts);
          // a service-worker cache of GitHub responses would be a second, disagreeing
          // copy of the same truth.
          globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        },
      }),
    ],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
      coverage: {
        provider: 'v8',
        // The domain layer is where the real logic lives, so it is the only thing
        // held to a coverage bar. UI coverage is chased in e2e instead.
        include: ['src/domain/**'],
        exclude: ['src/domain/__tests__/**'],
        thresholds: { statements: 90, branches: 85, functions: 90, lines: 90 },
      },
    },
  };
})
