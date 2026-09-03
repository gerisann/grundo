/**
 * ELAVULT CHUNK-HIVATKOZÁS KEZELÉSE TELEPÍTÉS UTÁN.
 *
 * A TÜNET (Geri, 2026-09-03): a `/profil` megnyitásakor „Failed to fetch
 * dynamically imported module: …/assets/ProfileScreen-KUzTnBFi.js", majd
 * újrapróbálásra hibátlanul betölt.
 *
 * AZ OK: a képernyők lustán, `import()`-tal töltődnek, a fájlnevekben pedig
 * tartalom-hash van. Ha valaki NYITVA HAGYJA az appot, amíg új verziót
 * telepítünk, a memóriában futó régi kód a RÉGI hash-t kéri — azt viszont a
 * Firebase Hosting már nem szolgálja ki. A `firebase.json` `**` rewrite miatt
 * ilyenkor nem 404 jön, hanem az `index.html` 200-zal; a böngésző pedig a
 * `text/html` MIME miatt utasítja vissza a modult. Innen a félrevezető
 * „failed to fetch" szöveg egy olyan kérésre, ami valójában sikeres volt.
 *
 * A MEGOLDÁS: ilyenkor egyetlen újratöltés elég — az friss `index.html`-t hoz
 * (az `no-cache`), abban pedig már az új hash-ek állnak. A felhasználónak nem
 * kell hibaüzenetet olvasnia és gombot nyomnia.
 *
 * ⚠️ AZ ÚJRATÖLTÉS-HUROK A VALÓDI KOCKÁZAT. Ha a chunk NEM az elavultság miatt
 * hiányzik (rossz telepítés, hálózati hiba, tényleg törölt fájl), a feltétel
 * nélküli újratöltés végtelen ciklusba vinné az appot — a felhasználó egy
 * villogó képernyőt kapna, hibaüzenet nélkül. Ezért egy munkamenetben csak
 * EGYSZER töltünk újra; a második azonos hiba már a rendes hibaképernyőre megy.
 */

const RELOAD_KEY = 'grundo.chunkReloadAt';

/**
 * Ennyi időn belüli ismételt hiba után NEM töltünk újra még egyszer.
 *
 * Bőven a lassú mobilhálózaton is befejeződő betöltés fölött van, viszont egy
 * későbbi, VALÓDI telepítés utáni elavulást már újra kezelni tud — ezért
 * időkorlát, és nem egyszer-és-soha-többé jelző.
 */
const RELOAD_COOLDOWN_MS = 60_000;

/**
 * Elavult/hiányzó kódrészlet betöltési hibája-e? TISZTA FÜGGVÉNY.
 *
 * Böngészőnként MÁS a szöveg, és egyik sem ad géppel olvasható hibakódot:
 * Chrome „Failed to fetch dynamically imported module", Firefox „error loading
 * dynamically imported module", Safari „Importing a module script failed".
 * A Safari-változat a fontos: a natív iOS WebView is azt adja.
 */
export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  if (!message) return false;
  return (
    /failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /importing a module script failed/i.test(message) ||
    /failed to load module script/i.test(message)
  );
}

/** A `sessionStorage` privát módban dobhat — az újratöltés nem múlhat ezen. */
function lastReloadAt(): number {
  try {
    return Number(sessionStorage.getItem(RELOAD_KEY)) || 0;
  } catch {
    return 0;
  }
}

function rememberReload(at: number): void {
  try {
    sessionStorage.setItem(RELOAD_KEY, String(at));
  } catch {
    /* A védelem nélkül is jobb újratölteni egyszer, mint hibát mutatni. */
  }
}

/**
 * Újratölt, ha ez most nem egy ismétlődő hiba.
 *
 * @returns `true`, ha az újratöltés elindult — a hívó ilyenkor NE mutasson
 *   hibaképernyőt, mert az úgyis eltűnik a lap alól.
 */
export function reloadForStaleChunk(now = Date.now()): boolean {
  if (typeof window === 'undefined') return false;
  if (now - lastReloadAt() < RELOAD_COOLDOWN_MS) return false;
  rememberReload(now);
  window.location.reload();
  return true;
}

/**
 * A Vite saját jelzésére iratkozik fel.
 *
 * A `vite:preloadError` MÉG AZELŐTT elsül, hogy a hibából React-kivétel lenne,
 * tehát itt a felhasználó egy pillanatra sem lát hibát. A hibahatár
 * (`AppErrorBoundary`) így csak a maradék eseteket fogja el.
 */
export function watchChunkLoadErrors(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('vite:preloadError', (event) => {
    // Az alapértelmezett viselkedés a hiba továbbdobása lenne.
    event.preventDefault();
    reloadForStaleChunk();
  });
}
