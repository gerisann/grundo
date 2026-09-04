/**
 * Hangeffektek — a rögzítés visszajelzésének hangi fele.
 *
 * MIÉRT `HTMLAudioElement` ÉS NEM Web Audio? Mert a rövid fájlok együtt is
 * kis méretűek, semmilyen keverést, effektet vagy mintapontos időzítést nem
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
  | 'loop-closed'
  | 'pause-activity'
  | 'resume-activity'
  | 'new-lap'
  | 'pressing-finish-activity'
  | 'finish-activity'
  | 'activity-saved';

/** Melyik beállítás-kapcsoló alá tartozik az adott hang. */
export type SoundChannel = 'countdown' | 'cells' | 'loop' | 'activity';

export const SOUND_CHANNEL: Record<SoundName, SoundChannel> = {
  'count-down-beep': 'countdown',
  'count-down-start': 'countdown',
  'cell-captured': 'cells',
  'cell-defend': 'cells',
  'cell-stolen': 'cells',
  'cell-max': 'cells',
  'loop-closed': 'loop',
  'pause-activity': 'activity',
  'resume-activity': 'activity',
  'new-lap': 'activity',
  'pressing-finish-activity': 'activity',
  'finish-activity': 'activity',
  'activity-saved': 'activity',
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
  'pause-activity': 'Aktivitás megállítva',
  'resume-activity': 'Aktivitás folytatva',
  'new-lap': 'Új kör indítva',
  'pressing-finish-activity': 'Befejezés nyomva tartva',
  'finish-activity': 'Aktivitás befejezve',
  'activity-saved': 'Aktivitás sikeresen elmentve',
};

/**
 * Szólhat-e ez a hang? TISZTA FÜGGVÉNY — a döntést a lejátszástól külön
 * tartjuk, mert ez az, ami tesztelhető (és ami elromolhat).
 *
 * ⚠️ A HARMADIK PARAMÉTER NEM BEÁLLÍTÁS, HANEM VÉDELEM. Ha a lap rejtett (az
 * app háttérben van, zárolt képernyő), a lejátszás NEM hibázik és nem is
 * szólal meg — a böngésző egyszerűen VÁR vele. Amikor az app előtérbe kerül,
 * a felgyűlt lejátszások egyszerre indulnak el.
 *
 * MÉRT ESET (2026-09-01, terepteszt iOS-en): egy hosszú menet cellahangjai és
 * hurokbezárásai nem szóltak menet közben, majd az app megnyitása — sőt,
 * bezárása és újranyitása — után tömegesen, össze-vissza lejátszódtak. Egy
 * hang, amit MOST nem lehet hallani, később már nem információ, hanem zaj:
 * ilyenkor a helyes viselkedés az eldobás.
 *
 * ⚠️ EZ NEM TESZI HALLHATÓVÁ a zárolt képernyős hangokat — azt nem is tudja.
 * Az iOS `Info.plist`-ben nincs `audio` háttérmód, és a WebView JavaScriptje
 * háttérben amúgy sem fut, tehát a „ráléptem egy új mezőre" DÖNTÉS sem
 * születik meg. Ez a paraméter csak azt szünteti meg, hogy a meg nem hallott
 * hangok később ömlesztve előjöjjenek.
 */
export function shouldPlaySound(
  name: SoundName,
  settings: FeedbackSettings,
  visibility: DocumentVisibilityState | undefined = documentVisibility(),
): boolean {
  if (visibility === 'hidden') return false;
  if (!settings.soundEnabled) return false;
  if (settings.soundVolume <= 0) return false;
  switch (SOUND_CHANNEL[name]) {
    case 'countdown':
      return settings.soundCountdown;
    case 'cells':
      return settings.soundCells;
    case 'loop':
      return settings.soundLoop;
    case 'activity':
      return settings.soundActivity;
  }
}

/**
 * A lap láthatósága, `undefined` ott, ahol nincs DOM (tesztek, szerver).
 *
 * A HIÁNYZÓ DOM SOSEM JELENT „rejtett"-et: a tesztek a beállítás-logikát
 * vizsgálják, és egy néma alapértelmezés csendben minden hangteszetet
 * érvénytelenítene.
 */
function documentVisibility(): DocumentVisibilityState | undefined {
  return typeof document === 'undefined' ? undefined : document.visibilityState;
}

/**
 * HANGONKÉNTI ALAPERŐSÍTÉS — a felhasználói hangerő SZORZÓJA.
 *
 * A fájlok nincsenek egy szintre normalizálva: a `loop-closed.mp3` egy teli,
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
  'pause-activity': 1,
  'resume-activity': 1,
  'new-lap': 1,
  'pressing-finish-activity': 1,
  'finish-activity': 1,
  'activity-saved': 1,
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
const resumableElements = new Map<SoundName, HTMLAudioElement>();
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

function resumableElement(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  const existing = resumableElements.get(name);
  if (existing) return existing;
  const element = new Audio(sourceUrl(name));
  element.preload = 'auto';
  element.setAttribute('playsinline', '');
  resumableElements.set(name, element);
  return element;
}

/**
 * A fájlok előkészítése — a hálózati letöltés MÉG A RÖGZÍTÉS ELŐTT.
 *
 * A visszaszámlálás első sípja 0 ms-mal a gombnyomás után jön; ha az elem
 * ekkor kezdene tölteni, a hang lekésné a saját számát. Ez a hívás olcsó:
 * néhány `<audio>` elem és `preload="auto"`, a böngésző maga dönt az ütemről.
 */
export function primeSounds(): void {
  for (const name of SOUND_NAMES) pool(name);
  resumableElement('pressing-finish-activity');
}

/**
 * A böngésző hangzárjának feloldása — KIZÁRÓLAG felhasználói gesztusból.
 *
 * Minden elemet elindítunk némán, majd azonnal megállítunk. Ettől kezdve az
 * adott elem `play()`-e gesztus nélkül is engedélyezett (iOS-en ez elemenként
 * érvényes, ezért megy végig mindegyiken).
 *
 * ⚠️ EZ MINDEN PLATFORMON LEFUT — ÉS EZ EGY DRÁGÁN MEGTANULT LECKE.
 *
 * 2026-09-03-án natívban KIHAGYTUK ezt a hívást, azzal az indoklással, hogy a
 * Capacitor mindkét platformon kikapcsolja a gesztus-követelményt (iOS:
 * `mediaTypesRequiringUserActionForPlayback = []`,
 * `CAPBridgeViewController.swift:125`; Android:
 * `setMediaPlaybackRequiresUserGesture(false)`, `Bridge.java:586`). A forrás
 * ezt tényleg így tartalmazza — a KÉSZÜLÉK viszont mást mondott: a következő
 * iOS buildben MINDEN hang elnémult, a Hangok képernyő kézi lejátszásával
 * együtt. Androidon és weben nem változott semmi.
 *
 * A TANULSÁG: a WebKit gesztus-kapuja NEM az egyetlen feltétel. A rendszer
 * hangútvonala (AVAudioSession) attól még nem aktiválódik, hogy a `play()`-t
 * a WebView engedélyezi — ahhoz kell egy valódi, gesztusból indított
 * lejátszás. Egy konfigurációs kapcsoló olvasása tehát NEM helyettesíti a
 * készüléken mérést. iOS-en a feloldás kell, pont.
 *
 * ⚠️ A MÉG MEGOLDATLAN RÉSZ: iOS-en a `HTMLMediaElement.volume` ÍRÁSA NEM HAT
 * (a hangerő ott a fizikai gombok alatt van, az olvasás mindig 1-et ad), ezért
 * az alábbi `unlockElement()` `volume = 0`-s „némítása" ott hatástalan. MÉRVE
 * (a `volume` no-op-ként modellezve): **51 `<audio>` elem** indul el, és iOS-en
 * mind hallhatóan — ebből 32 cellahang négyféle hangból. Ez az a hangzavar,
 * amit Geri az app indítása utáni ELSŐ Play-koppintáskor hall, pontosan
 * egyszer (az `unlocked` jelző modul-szintű, új WebView → új JS-környezet).
 *
 * ⚠️ A SZINKRON `pause()` MÁSODSZOR IS ELNÉMÍTOTTA AZ APPOT (2026-09-04). A
 * hangzavar ellen a `pause()` közvetlenül, a promise bevárása nélkül futott le
 * a `play()` után — abban a hitben, hogy a feloldás már magában a `play()`
 * hívásban megtörténik. A készülék megint mást mondott: iOS-en így MINDEN hang
 * elnémult. A megszakított `play()` ugyanis el sem indítja a lejátszást, a
 * rendszer hangútvonala (AVAudioSession) pedig épp a TÉNYLEGES lejátszástól
 * aktiválódik — nincs mit „felszentelni", ha semmi nem szólalt meg.
 *
 * A LECKE UGYANAZ, KÉTSZER: a feloldáshoz VALÓDI, végigfutó lejátszás kell.
 * Ezért a `pause()` visszakerült a promise-ba, a hangzavart pedig másképp
 * kerüljük el — a lejátszás a hang UTOLSÓ néhány ezredmásodpercére ugrik
 * (`UNLOCK_TAIL_S`), ami a lecsengés csendes vége. A lejátszás így valódi és
 * végig is fut, hallani viszont nincs mit.
 *
 * A `muted = true` KÍSÉRTŐ, de veszélyes: a WebKit a némított lejátszást eleve
 * korlátozás nélkül engedi, tehát vélhetően NEM „szentelné fel" az elemet a
 * későbbi hangos lejátszáshoz — vagyis ugyanabba a néma hibába futnánk bele.
 */
export function unlockSounds(): void {
  if (unlocked) return;
  unlocked = true;
  primeSounds();
  for (const name of SOUND_NAMES) {
    const target = pools.get(name);
    if (!target) continue;
    for (const element of target.elements) {
      unlockElement(element);
    }
  }
  const resumable = resumableElements.get('pressing-finish-activity');
  if (resumable) unlockElement(resumable);
}

/**
 * A feloldáskor a hang UTOLSÓ ennyi másodperce szólal meg.
 *
 * Nem finomhangolás, hanem a néma feloldás ára: iOS-en a `volume = 0`
 * hatástalan, a lejátszás megszakítása viszont magát a feloldást teszi tönkre
 * (lásd `unlockSounds` fejléce). Marad a harmadik út: a lejátszás valódi és
 * végigfut, csak épp a lecsengés csendes végén. Ennél rövidebb szakasznál a
 * dekóder néha meg sem szólal, hosszabbnál a koppanás már hallható.
 */
const UNLOCK_TAIL_S = 0.05;

/**
 * Egyetlen elem feloldása — VALÓDI, végigfutó lejátszással.
 *
 * ⚠️ A `pause()` CSAK a promise beérkezése után jöhet. A szinkron megállítás
 * megszakítja a `play()`-t, mielőtt az elindulna; iOS-en emiatt a rendszer
 * hangútvonala nem aktiválódik, és MINDEN hang néma marad — ez 2026-09-04-en
 * élesben megtörtént.
 *
 * A hallható zavart a `currentTime` ugratása kerüli el: a hang legvége szólal
 * meg, ami a lecsengés csendes része. Ha az időtartam még nem ismert (a
 * metaadat nem töltődött be), marad a teljes lejátszás — hangosabb, de működik;
 * a némaság sosem opció. A `primeSounds()` épp ezért fut jóval a feloldás előtt
 * (`TrackingScreen`), hogy a metaadat addigra meglegyen.
 *
 * A `volume = 0` maradhat: weben ez teszi a feloldást tökéletesen némává,
 * iOS-en pedig egyszerűen hatástalan, ártani nem árt.
 */
function unlockElement(element: HTMLAudioElement): void {
  const restore = element.volume;
  element.volume = 0;
  const settle = () => {
    element.pause();
    element.currentTime = 0;
    element.volume = restore;
  };
  try {
    const duration = element.duration;
    if (Number.isFinite(duration) && duration > UNLOCK_TAIL_S) {
      element.currentTime = duration - UNLOCK_TAIL_S;
    }
    const started = element.play();
    if (started && typeof started.then === 'function') started.then(settle, settle);
    else settle();
  } catch {
    settle();
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
 * A hangerő-korlátok közé szorított playbackRate.
 *
 * A böngészők a szélsőséges sebességnél ELNÉMÍTJÁK a hangot (a Chrome nagyjából
 * a 0,5–4 tartományon kívül). Egy néma visszajelzés rosszabb, mint egy nem
 * tökéletesen szinkron: a tartományon kívül inkább a szinkronból engedünk.
 */
const MIN_PLAYBACK_RATE = 0.5;
const MAX_PLAYBACK_RATE = 4;

/**
 * A NYOMVA TARTÁS HANGJÁNAK ÖSSZEHANGOLÁSA A GOMB TÖLTÖTTSÉGÉVEL — tiszta
 * függvény, ez a tesztelhető rész.
 *
 * ⚠️ MIÉRT KELL. A `pressing-finish-activity.mp3` MÉRVE **2,04 másodperc**, a
 * befejezés gomb viszont **1000 ms** alatt telik meg. Ez nem véletlen: a gomb
 * eredetileg 2000 ms volt, és 2026-08-26-án felezték (lásd `FINISH_HOLD_MS`) —
 * a hangot viszont nem igazította hozzá senki. Következmény: a hang második
 * fele SOHA nem hallatszott, a gomb pedig már tele volt, mire a hang a feléhez
 * ért.
 *
 * A második hiba a folytatás volt: elengedéskor a sáv VISSZAFOLYIK (350 ms),
 * a hang viszont ott állt meg, ahol abbahagytuk, és onnan is folytatta. Egy
 * 25%-ra visszafolyt sávhoz így egy 60%-nál járó hang tartozott.
 *
 * A megoldás mindkettőre ugyanaz: a hang MINDIG oda ugrik, ahol a gomb
 * töltöttsége éppen tart, és a lejátszási sebesség a teljes hangot a gomb
 * töltési ablakába préseli. Így a hang vége pontosan akkor ér a végére, amikor
 * a sáv megtelik — bárhányszor engedjük el és nyomjuk újra közben.
 *
 * @param durationSec a hangfájl valódi hossza másodpercben
 * @param progress    a gomb töltöttsége, 0..1
 * @param windowMs    a teljes feltöltődés ideje ezredmásodpercben
 */
export function holdPlaybackFor(
  durationSec: number,
  progress: number,
  windowMs: number,
): { rate: number; currentTime: number } | null {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return null;
  if (!Number.isFinite(windowMs) || windowMs <= 0) return null;
  const clamped = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  const rate = durationSec / (windowMs / 1000);
  return {
    rate: Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate)),
    currentTime: clamped * durationSec,
  };
}

/**
 * A nyomva tartás hangja, a gomb töltöttségéhez igazítva.
 *
 * A `durationSec` a betöltött metaadatból jön; amíg az nincs meg (`NaN`), a
 * hang egyszerűen onnan szól, ahol áll — a némaság sosem opció, a rögzítés
 * befejezése nem várhat a hangfájlra.
 */
export function playHoldSound(
  name: SoundName,
  progress: number,
  windowMs: number,
  settings = feedbackSettings(),
): void {
  if (!shouldPlaySound(name, settings)) return;
  const element = resumableElement(name);
  if (!element) return;
  try {
    element.volume = Math.min(1, Math.max(0, settings.soundVolume * SOUND_GAIN[name]));
    const plan = holdPlaybackFor(element.duration, progress, windowMs);
    if (plan !== null) {
      element.playbackRate = plan.rate;
      element.currentTime = plan.currentTime;
    }
    const started = element.play();
    if (started && typeof started.catch === 'function') started.catch(() => undefined);
  } catch {
    /* a hang sosem állíthatja meg a rögzítést */
  }
}

/** Megállítja a folytatható hangot; `reset` esetén a következő lejátszás elölről indul. */
export function pauseSoundPlayback(name: SoundName, reset = false): void {
  const element = resumableElements.get(name);
  if (!element) return;
  try {
    element.pause();
    if (reset) element.currentTime = 0;
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
 *
 * ⚠️ A LAP ELREJTÉSEKOR A FÜGGŐ SOROK MEGSZAKADNAK. A `playSound` őre
 * önmagában nem elég: az időzítők a háttérben is lejárnak (a böngésző csak
 * ritkítja őket), és előtérbe visszatéréskor egyszerre sülnek el. Az elmaradt
 * koppanások pótlása értelmetlen — az esemény, amiről szóltak, percekkel
 * korábban történt.
 */
export function playSoundSequence(names: readonly SoundName[], gapMs = 220): () => void {
  const timers: number[] = [];
  const startedAt = now();
  const cancel = () => {
    for (const timer of timers) window.clearTimeout(timer);
    timers.length = 0;
    pendingSequences.delete(cancel);
  };

  names.forEach((name, index) => {
    if (index === 0) {
      playSound(name);
      return;
    }
    const dueAfterMs = index * gapMs;
    timers.push(
      window.setTimeout(() => {
        // ⚠️ Lásd a `STALE_TOLERANCE_MS` indoklását: a jóval késve lefutó
        // koppanás nem információ, hanem zaj.
        if (isSequenceStepStale(now() - startedAt, dueAfterMs)) return;
        playSound(name);
      }, dueAfterMs),
    );
  });

  if (timers.length > 0) {
    pendingSequences.add(cancel);
    watchVisibility();
  }
  return cancel;
}

/**
 * ⚠️ AZ IDŐZÍTŐ NEM ÍGÉRET — EZ VITTE EL A NATÍV HANGOKAT.
 *
 * MÉRT ESET (2026-09-02, Geri): asztali böngészőben a hangok rendben,
 * NATÍV iOS/Android alatt viszont „egyszerre szól az összes hangeffekt".
 *
 * Az ok a WebView felfüggesztése. Ez a sor a koppanásokat SZÁNDÉKOSAN
 * 190-220 ms-onként lépteti, hogy külön-külön hallhatók legyenek. Ha a
 * telefon közben lezáródik vagy az app háttérbe kerül, a WKWebView (és az
 * Android WebView) megállítja a JavaScriptet — a már beütemezett
 * `setTimeout`-ok NEM futnak le a saját idejükben. Előtérbe visszatéréskor
 * a böngésző az ÖSSZES lejárt időzítőt egymás után, szinte azonnal elsüti:
 * a szépen ütemezett sorból egyetlen kásás dörrenés lesz.
 *
 * Miért nem elég a `visibilitychange`-re épülő megszakítás (lent)? Mert az
 * feltételezi, hogy az esemény a felfüggesztés ELŐTT még lefut. Ez asztali
 * böngészőben igaz, natív WebView-ban zárolt képernyőnél nem garantált —
 * és pontosan ott hibázott.
 *
 * Ezért minden késleltetett hang MAGA ellenőrzi, hogy időben szólal-e meg.
 * A tűrés bőven a legnagyobb gap fölött van, tehát a normál ütemezést (és
 * egy lassú főszál apró csúszásait) nem érinti; a másodperces
 * nagyságrendű késést viszont kizárja.
 */
const STALE_TOLERANCE_MS = 600;

/**
 * Elkésett-e ez a lépés? TISZTA FÜGGVÉNY — a döntést itt is a lejátszástól
 * külön tartjuk, mert Node-ban (DOM nélkül) csak így tesztelhető.
 *
 * @param elapsedMs   mennyi telt el ténylegesen a sor indítása óta
 * @param dueAfterMs  mennyinek KELLETT volna eltelnie ehhez a hanghoz
 */
export function isSequenceStepStale(elapsedMs: number, dueAfterMs: number): boolean {
  return elapsedMs > dueAfterMs + STALE_TOLERANCE_MS;
}

/** Monoton óra, ahol van; különben a fali óra. A késés MÉRTÉKE számít. */
function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

/** A még le nem futott sorok leállítói — elrejtéskor mind lefut. */
const pendingSequences = new Set<() => void>();
let visibilityWatched = false;

/**
 * Egyetlen, megosztott `visibilitychange` figyelő.
 *
 * Sorozatonként külön feliratkozni pazarlás lenne (egy bezárás három sort is
 * indíthat), és a leiratkozásukat is könyvelni kellene. Így egy figyelő van,
 * ami az app életciklusán át megmarad — annyi a dolga, hogy elrejtéskor
 * kiürítse a függő sorokat.
 */
function watchVisibility(): void {
  if (visibilityWatched || typeof document === 'undefined') return;
  visibilityWatched = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    for (const cancel of [...pendingSequences]) cancel();
  });
}
