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

/**
 * Natív build-e ez?
 *
 * A `codemagic.yaml` mindkét natív munkafolyamatban beállítja a csatornát
 * („iOS build 12", „Android build 9"); a webes telepítés és a helyi
 * fejlesztés az alapértelmezett `web` értéken marad.
 */
const nativeBuild = releaseChannel !== 'web';

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
    /**
     * SOURCE MAP: A WEBEN IGEN, A NATÍV APPBAN NEM.
     *
     * A `cap sync` a teljes `dist/`-et bemásolja az `ios/App/App/public`
     * (illetve az `android/app/src/main/assets/public`) mappába — a
     * source mapekkel együtt. Mérve a 2026-08-23-i másolaton: 3,1 MB kód
     * mellett 9,2 MB `.map`, azaz a 13 MB-os webes mappa több mint kétharmada
     * olyan fájl, amit a WKWebView soha nem tölt be. Csak a letöltendő és a
     * telepített méretet növeli (GRUNDO #21 energiaelemzés, D1).
     *
     * A webes telepítésen marad, mert ott a hibakeresés valódi haszon, és a
     * böngésző csak a devtools megnyitásakor kéri le.
     */
    sourcemap: !nativeBuild,
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
