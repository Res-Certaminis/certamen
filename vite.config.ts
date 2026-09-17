import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    svelte(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Certamen',
        short_name: 'Certamen',
        description: 'Latin quiz bowl buzzer and practice app',
        theme_color: '#5b21b6',
        background_color: '#0b0b0f',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        globIgnores: [
          '**/parsers-*.js',
          '**/pdf.worker*',
          '**/inter-{cyrillic,cyrillic-ext,greek,greek-ext,vietnamese,latin-ext}-*',
        ], // docx/pdf parsers load lazily in the upload app only
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/ws\//, /^\/upload/],
      },
    }),
  ],
  build: {
    rollupOptions: {
      input: { play: 'index.html', upload: 'upload/index.html' },
      output: {
        advancedChunks: {
          groups: [{ name: 'parsers', test: /node_modules[\\/](mammoth|pdfjs-dist|@anthropic-ai|zod)[\\/]/ }],
        },
      },
    },
  },
  server: {
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
  test: { include: ['test/**/*.test.ts'] },
});
