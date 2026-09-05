import { spawnSync } from 'node:child_process';

/**
 * A GAME LOOP MÉRŐFUTÁS VITE-INDÍTÓJA — build és dev szerver egyaránt.
 *
 * MIÉRT SZKRIPT, ÉS NEM EGY SOR A `package.json`-BAN: a `GRUNDO_GAMELOOP=1
 * vite build` alak Windows PowerShellben nem működik (nincs inline környezeti
 * változó előtag), a szokásos megoldás pedig egy új függőség (`cross-env`)
 * lenne. A `CLAUDE.md` szerint ha a meglévő eszközkészlet megoldja, nem
 * hozunk be harmadik felet — ennyi Node pontosan elég hozzá.
 *
 * Használat:
 *   node scripts/build-gameloop.mjs build   → a debug APK-ba szánt csomag
 *   node scripts/build-gameloop.mjs dev     → helyi próba a böngészőben
 *
 * ⚠️ AZ ÍGY KÉSZÜLT CSOMAG NEM MEHET ÉLESBE. Benne van a `/gameloop` belépő,
 * ami bejelentkezés nélkül, szimulált GPS-szel indít rögzítést a LAB
 * sandboxban. A kiadási build (`npm run build`) ezt a kapcsolót sosem
 * állítja be, és a `vite.config.ts` aliasa ott a futtatót egy üres modulra
 * cseréli — mérve: 16 964 bájt helyett 120.
 */
const mode = process.argv[2] === 'dev' ? 'dev' : 'build';

const result = spawnSync('npx', ['vite', ...(mode === 'dev' ? [] : ['build'])], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, GRUNDO_GAMELOOP: '1' },
});

process.exit(result.status ?? 1);
