import type { PerfSnapshot } from '@/lib/perfMeter';
import { captureDeviceInfo, type RecordingDeviceInfo } from '@/tracking/deviceInfo';

/**
 * HÍD A NATÍV GAME LOOP FUTTATÓHOZ.
 *
 * A Firebase Test Lab Game Loop tesztje egy ÍRHATÓ FÁJLT ad az appnak
 * (`launchIntent.getData()`), és a futás végét onnan ismeri fel, hogy az
 * activity bezárul. Ez a modul a JS oldali fele: összeállítja az eredményt,
 * átadja a natív oldalnak, majd megkéri, hogy zárjon.
 *
 * ⚠️ A NATÍV OLDAL CSAK DEBUG BUILDBEN LÉTEZIK
 * (`android/app/src/debug/`). Éles APK-ban a `window.GrundoGameLoop` nincs
 * ott, és ez SZÁNDÉKOS: a Game Loop belépő szimulált GPS-t etet a
 * rögzítőbe, ami élesben csalás lenne. A tartalék ág ezért nem „majd
 * natívan működik" — böngészőben fut, ahol nincs mit védeni.
 */

/** A natív oldal `@JavascriptInterface`-e. Debug buildben létezik, máshol nem. */
interface NativeGameLoopBridge {
  /** A teljes eredmény JSON-ként. A natív oldal a Test Lab logFile-jába írja. */
  writeResult: (json: string) => void;
  /** „Kész vagyok" — a natív oldal `finish()`-t hív, a Test Lab lezárja a futást. */
  finish: () => void;
}

declare global {
  interface Window {
    GrundoGameLoop?: NativeGameLoopBridge;
  }
}

export interface GameLoopReportInput {
  scenarioNumber: number;
  scenarioKey: string;
  scenarioName: string;
  phaseName: string;
  playbackRate: string;
  purpose: string;
  startedAt: number;
  finishedAt: number;
  /** A rögzítő által mért adatok — `null`, ha a futás mentés előtt bukott el. */
  summary: {
    distanceM: number;
    loops: number;
    claimedCells: number;
    areaGainedM2: number;
    gp: number;
  } | null;
  perf: PerfSnapshot;
  /** Kitöltve, ha a futás hibára futott. A mérés így is felmegy. */
  error: string | null;
}

export interface GameLoopReport extends GameLoopReportInput {
  schema: 'grundo.gameloop.v1';
  /** Platform, userAgent ÉS a build azonosítói — a `captureDeviceInfo` mindet hozza. */
  device: RecordingDeviceInfo;
  wallClockMs: number;
  /** `native`, ha a Test Lab futtatta; `browser`, ha kézzel néztük meg. */
  host: 'native' | 'browser';
}

export function nativeGameLoopAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.GrundoGameLoop?.writeResult === 'function';
}

export function buildGameLoopReport(input: GameLoopReportInput): GameLoopReport {
  return {
    ...input,
    schema: 'grundo.gameloop.v1',
    device: captureDeviceInfo(),
    wallClockMs: input.finishedAt - input.startedAt,
    host: nativeGameLoopAvailable() ? 'native' : 'browser',
  };
}

/**
 * Az eredmény leadása.
 *
 * ⚠️ A NATÍV ÍRÁS ÉS A ZÁRÁS KÜLÖN LÉPÉS, és ez nem szépészeti kérdés: ha a
 * `finish()` az írással egy hívásban lenne, egy írás közbeni kivétel úgy
 * zárná le a futást, hogy a Test Lab ÜRES logFile-t tölt fel — a futás
 * „sikeresnek" látszana, mérés nélkül. Így az írás hibája még a zárás előtt
 * kiderül, és a `logcat`-ban ott a nyoma.
 */
export function deliverGameLoopReport(report: GameLoopReport): void {
  const json = JSON.stringify(report, null, 2);
  const bridge = typeof window !== 'undefined' ? window.GrundoGameLoop : undefined;

  if (!bridge || typeof bridge.writeResult !== 'function') {
    // Böngészős ág: a konzolba írjuk, és a `window`-ra tesszük, hogy a
    // Playwright/kézi ellenőrzés is hozzáférjen a natív híd nélkül.
    (window as unknown as { __grundoGameLoopResult?: GameLoopReport }).__grundoGameLoopResult = report;
    console.info('[gameloop] result', json);
    return;
  }

  bridge.writeResult(json);
  if (typeof bridge.finish === 'function') bridge.finish();
}
