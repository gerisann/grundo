/**
 * Hangeffektek — a rögzítés visszajelzésének hangi fele.
 *
 * MIÉRT `HTMLAudioElement` ÉS NEM Web Audio? Mert a hét fájl együtt is csak
 * ~130 kB, semmilyen keverést, effektet vagy mintapontos időzítést nem
 * igényelnek, viszont a Web Audio ára valódi: az `AudioContext` létrehozása,
 * a teljes fájlok letöltése ÉS dekódolása már az app indulásakor, plusz egy
 * saját életciklus, amit iOS-en külön kezelni kell. Az `<audio>` elem
 * ugyanezt megcsinálja lustán, a böngésző saját gyorsítótárával.
 *
 * ⚠️ A LEJÁTSZÁSHOZ FELHASZNÁLÓI GESZTUS KELL. Minden mai böngésző blokkolja
 * a hangot addig, amíg a felhasználó nem érintette meg az oldalt — iOS-en
 * ráadásul ELEMENKÉNT. Ezért az `unlockSounds()` MINDEN elemet egyszer,
 * némán elindít és megállít, és a `Dock` az indítógomb koppintásából hívja
 * (lásd `Dock.tsx` `primaryAction`). Enélkül a 3-2-1 visszaszámlálás első
 * sípja néma maradna — pont az, amit a felhasználó a leggyakrabban hall.
 *
 * ⚠️ EGY HANG TÖBBSZÖR IS SZÓLHAT EGYMÁS UTÁN (gyors cellaesemények), ezért
 * hangonként egy kis elempool van: egyetlen elem `currentTime = 0`-val
 * elvágná a saját, még szóló előző lejátszását.
 */

import { feedbackSettings, type FeedbackSettings } from './feedbackSettings';

export type SoundName =
  | 'count-down-beep'
  | 'count-down-start'
  | 'cell-captured'
  | 'cell-defend'
  | 'cell-stolen'
  | 'cell-max'
  | 'loop-closed';

/** Melyik beállítás-kapcsoló alá tartozik az adott hang. */
export type SoundChannel = 'countdown' | 'cells' | 'loop';

export const SOUND_CHANNEL: Record<SoundName, SoundChannel> = {
  'count-down-beep': 'countdown',
  'count-down-start': 'countdown',
  'cell-captured': 'cells',
  'cell-defend': 'cells',
  'cell-stolen': 'cells',
  'cell-max': 'cells',
  'loop-closed': 'loop',
};

export const SOUND_NAMES = Object.keys(SOUND_CHANNEL) as SoundName[];

/** Magyar címke a beállítások képernyőn — a kulcs technikai, ez olvasható. */
export const SOUND_LABEL: Record<SoundName, string> = {
  'count-down-beep': 'Visszaszámlálás (3-2-1)',
  'count-down-start': 'RAJT!',
  'cell-captured': 'Szabad cella elfoglalva',
  'cell-defend': 'Saját cella megerősítve',
  'cell-stolen': 'Cella elvéve egy játékostól',
  'cell-max': 'Cella maximális védelmen',
  'loop-closed': 'Hurok bezárva — terület megszerezve',
};

/**
 * Szólhat-e ez a hang? TISZTA FÜGGVÉNY — a döntést a lejátszástól külön
 * tartjuk, mert ez az, ami tesztelhető (és ami elromolhat).
 */
export function shouldPlaySound(name: SoundName, settings: FeedbackSettings): boolean {
  if (!settings.soundEnabled) return false;
  if (settings.soundVolume <= 0) return false;
  switch (SOUND_CHANNEL[name]) {
    case 'countdown':
      return settings.soundCountdown;
    case 'cells':
      return settings.soundCells;
    case 'loop':
      return settings.soundLoop;
  }
}

/**
 * HANGONKÉNTI ALAPERŐSÍTÉS — a felhasználói hangerő SZORZÓJA.
 *
 * A hét fájl nincs egy szintre normalizálva: a `loop-closed.mp3` egy teli,
 * ~3 másodperces fanfár (98 kB), a cellahangok viszont 3–7 kB-os rövid
 * koppanások. Menet közben a kettő átfedhet (egy bezárás pillanatában még
 * szólhat az utolsó mező koppanása), és a fanfár akkor elnyomná.
 *
 * Ez KEVERÉS, nem beállítás: a felhasználó a Hangok oldalon a fő hangerőt
 * állítja, ez alatta arányosan marad.
 */
const SOUND_GAIN: Record<SoundName, number> = {
  'count-down-beep': 1,
  'count-down-start': 1,
  'cell-captured': 1,
  'cell-defend': 1,
  'cell-stolen': 1,
  'cell-max': 1,
  'loop-closed': 0.85,
};

/**
 * Hangonként ennyi párhuzamos lejátszás fér el.
 *
 * ⚠️ A CELLAHANGOK POOLJA NAGYOBB, és ez nem finomhangolás. A bezárás
 * cellánként egy koppanást játszik le (lásd `useCaptureFeedback.ts`
 * `captureSoundPlan`), akár 30 ms-onként — egy három elemű poolnál ugyanaz
 * az elem 90 ms-onként indulna újra, tehát minden koppanás elvágná a saját,
 * két lépéssel korábbi példányát, és zörej lenne belőle.
 *
 * A visszaszámlálásnak és a fanfárnak ez nem kell: azok másodperces
 * távolságra szólnak, és fölöslegesen tartanának életben `<audio>` elemeket
 * egy telefonos WebView-ban.
 */
function poolSize(name: SoundName): number {
  return SOUND_CHANNEL[name] === 'cells' ? 8 : 2;
}

interface Pool {
  elements: HTMLAudioElement[];
  next: number;
}

const pools = new Map<SoundName, Pool>();
let unlocked = false;

function sourceUrl(name: SoundName): string {
  // A `BASE_URL` a Vite alapja ('/'), és a natív buildben is ez az érvényes
  // előtag — kézzel írt abszolút út a Capacitor `capacitor://` sémáján
  // eltörne.
  return `${import.meta.env.BASE_URL}sounds/${name}.mp3`;
}

function pool(name: SoundName): Pool | null {
  if (typeof Audio === 'undefined') return null;
  const existing = pools.get(name);
  if (existing) return existing;

  const elements: HTMLAudioElement[] = [];
  for (let index = 0; index < poolSize(name); index += 1) {
    const element = new Audio(sourceUrl(name));
    element.preload = 'auto';
    // Néhány mobil böngésző különben teljes képernyős lejátszóra váltana.
    element.setAttribute('playsinline', '');
    elements.push(element);
  }
  const created: Pool = { elements, next: 0 };
  pools.set(name, created);
  return created;
}

/**
 * A hét fájl előkészítése — a hálózati letöltés MÉG A RÖGZÍTÉS ELŐTT.
 *
 * A visszaszámlálás első sípja 0 ms-mal a gombnyomás után jön; ha az elem
 * ekkor kezdene tölteni, a hang lekésné a saját számát. Ez a hívás olcsó:
 * hét `<audio>` elem és `preload="auto"`, a böngésző maga dönt az ütemről.
 */
export function primeSounds(): void {
  for (const name of SOUND_NAMES) pool(name);
}

/**
 * A böngésző hangzárjának feloldása — KIZÁRÓLAG felhasználói gesztusból.
 *
 * Minden elemet elindítunk némán, majd azonnal megállítunk. Ettől kezdve az
 * adott elem `play()`-e gesztus nélkül is engedélyezett (iOS-en ez elemenként
 * érvényes, ezért megy végig mindegyiken).
 */
export function unlockSounds(): void {
  if (unlocked) return;
  unlocked = true;
  primeSounds();
  for (const name of SOUND_NAMES) {
    const target = pools.get(name);
    if (!target) continue;
    for (const element of target.elements) {
      const restore = element.volume;
      element.volume = 0;
      const started = element.play();
      const settle = () => {
        element.pause();
        element.currentTime = 0;
        element.volume = restore;
      };
      // A `play()` régebbi böngészőkben nem ad Promise-t.
      if (started && typeof started.then === 'function') started.then(settle, settle);
      else settle();
    }
  }
}

/**
 * Egy hang lejátszása. SOHA NEM DOB és soha nem vár: a rögzítés menete nem
 * függhet attól, hogy a hangeszköz épp foglalt-e.
 */
export function playSound(name: SoundName, settings = feedbackSettings()): void {
  if (!shouldPlaySound(name, settings)) return;
  const target = pool(name);
  if (!target) return;

  const element = target.elements[target.next]!;
  target.next = (target.next + 1) % target.elements.length;
  try {
    element.volume = Math.min(1, Math.max(0, settings.soundVolume * SOUND_GAIN[name]));
    element.currentTime = 0;
    const started = element.play();
    // Blokkolt lejátszás (nem volt még gesztus) — nem hiba, csak csend.
    if (started && typeof started.catch === 'function') started.catch(() => undefined);
  } catch {
    /* a hang sosem állíthatja meg a rögzítést */
  }
}

/**
 * Több hang EGYMÁS UTÁN, kis eltolással.
 *
 * MIÉRT KELL? Egy hurokbezárás egyszerre hozhat szabad, elvett és megerősített
 * cellát is. Egyszerre indítva a három hang egyetlen kásás koppanás lenne;
 * 220 ms-onként viszont mindegyik felismerhető marad, és a sorrend maga is
 * információ. A köz szándékosan hosszabb a rövid koppanásoknál (~0,2 mp):
 * enélkül a záró fanfár belevágott az előtte szóló cellahangba.
 *
 * A visszaadott függvénnyel az egész sor leállítható (pl. ha a felhasználó
 * közben eldobja a rögzítést).
 */
export function playSoundSequence(names: readonly SoundName[], gapMs = 220): () => void {
  const timers: number[] = [];
  names.forEach((name, index) => {
    if (index === 0) {
      playSound(name);
      return;
    }
    timers.push(window.setTimeout(() => playSound(name), index * gapMs));
  });
  return () => {
    for (const timer of timers) window.clearTimeout(timer);
  };
}
