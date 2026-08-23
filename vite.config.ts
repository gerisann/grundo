import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageInfo = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string };

function gitRevision(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'ismeretlen';
  }
}

const releaseVersion = process.env.VITE_APP_VERSION ?? packageInfo.version;
const revision = process.env.VITE_GIT_SHA ?? gitRevision();
const releaseChannel = process.env.VITE_BUILD_CHANNEL ?? 'web';

export default defineConfig({
  plugins: [react()],
  define: {
    __GRUNDO_VERSION__: JSON.stringify(releaseVersion),
    __GRUNDO_REVISION__: JSON.stringify(revision),
    __GRUNDO_CHANNEL__: JSON.stringify(releaseChannel),
  },
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
