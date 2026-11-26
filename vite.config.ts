import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project path: https://sodam-wd.github.io/rem/
const BASE = '/rem/';

export default defineConfig({
  base: BASE,
  build: { sourcemap: false, target: 'es2022' },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: BASE,
        name: 'R.E.M. : Recovery Terminal',
        short_name: 'R.E.M.',
        description: '현실 복구 단말기 — 가상의 현실 비상 관리국 기상 알람',
        lang: 'ko',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#191D1B',
        theme_color: '#191D1B',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        // manifest + manifest icons are added by the plugin itself; avoid duplicate precache entries
        globIgnores: ['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'manifest.webmanifest'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: `${BASE}index.html`,
        cleanupOutdatedCaches: true,
        importScripts: ['sw-notify.js'],
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
});
