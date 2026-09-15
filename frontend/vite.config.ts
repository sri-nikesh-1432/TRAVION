import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Vite 8 (Rolldown) only supports the function form of manualChunks.
        // Group big vendor libraries into their own long-term-cache chunks.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('framer-motion')) return 'vendor-framer';
          if (id.includes('leaflet')) return 'vendor-leaflet';
          if (id.includes('lucide-react')) return 'vendor-lucide';
          if (/[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/.test(id)) {
            return 'vendor-react';
          }
          return undefined;
        },
      },
    },
    // Raise the warning threshold so CI doesn't choke on individual chunks.
    // Heavy role portals are lazy-loaded (see App.tsx); the entry bundle here
    // is the landing experience plus shared UI, ~168 kB gzipped.
    chunkSizeWarningLimit: 700,
  },
})
