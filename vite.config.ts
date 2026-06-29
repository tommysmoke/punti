import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  base: '/punti/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'public',
      filename: 'sw.js',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      includeAssets: [
        'favicon.ico',
        'favicon.png',
        'favicon-16x16.png',
        'favicon-32x32.png',
        'favicon-48x48.png',
        'favicon-64x64.png',
        'favicon-180x180.png',
        'favicon-192x192.png',
        'favicon-256x256.png',
        'favicon-512x512.png',
      ],
      manifest: {
        name: 'Tommy Smoke',
        short_name: 'TommySmoke',
        description: 'Raccolta Punti Tommy Smoke',
        theme_color: '#0f4c5c',
        background_color: '#f3efe2',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/punti/',
        start_url: '/punti/',
        icons: [
          {
            src: '/punti/favicon-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/punti/favicon-256x256.png',
            sizes: '256x256',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/punti/favicon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
    }),
  ],
})
