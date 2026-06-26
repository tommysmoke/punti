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
      includeAssets: ['favicon.svg', 'favicon-192x192.png', 'favicon-512x512.png'],
      manifest: {
        name: 'Punti Facili',
        short_name: 'Punti',
        description: 'Raccolta punti per negozi e clienti.',
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
            src: '/punti/favicon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/punti/favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
    }),
  ],
})
