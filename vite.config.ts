import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Keep the entry chunk small — the map and the charts are the two heavy
        // dependencies and neither is needed on first paint.
        manualChunks: {
          mapbox: ['mapbox-gl'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          h3: ['h3-js'],
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
});
