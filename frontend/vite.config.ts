import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Local dev: same-origin '/api/*' also reaches the backend, so the UI
    // works whether API_BASE_URL is absolute or relative.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8002',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: 4173,
  },
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
