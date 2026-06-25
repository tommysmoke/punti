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
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Punti Facili',
        short_name: 'Punti',
        description: 'Raccolta punti per negozi e clienti.',
        theme_color: '#0f4c5c',
        background_color: '#f3efe2',
        display: 'standalone',
        scope: '/punti/',
        start_url: '/punti/',
        icons: [
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
