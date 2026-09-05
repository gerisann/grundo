import type { BuiltInLabScenario } from './labPerfScenario';
import { PERF_TEST_SCENARIO } from './labPerfScenario';
import type { LabE2ePlaybackRate } from './labE2eSession';
import scenario25km from '@bench/tracks/scenario-25km.json';

/**
 * A GAME LOOP FUTTATÓ PÁLYAKÖNYVE — scenario-szám → mérendő menet.
 *
 * MIÉRT SZÁMOZOTT: a Firebase Test Lab Game Loop tesztje EGYETLEN egész
 * számot ad át az appnak (`--scenario-numbers=1,2`). Ez a modul fordítja
 * ezt a számot konkrét nyomvonallá és lejátszási sebességgé.
 *
 * MIÉRT KÓDBAN ÉL A PÁLYA, ÉS NEM A `localStorage`-BAN: ugyanaz az indok,
 * amit a `labPerfScenario.ts` fejléce már leír — a LAB mentett scenariói
 * eszközhöz kötöttek, „az asztali gépen megrajzolt útvonal SOSEM jut át a
 * telefonra". A Test Lab készüléke pedig minden futás után tiszta lappal
 * indul: ott SEMMI nincs a `localStorage`-ban. Kódban élő pálya nélkül tehát
 * nincs mit mérni.
 *
 * ⚠️ A SORSZÁMOK ÖRÖKRE FIXEK. Egy szám jelentésének megváltoztatása
 * visszamenőleg értelmezhetetlenné teszi a korábbi méréseket: a
 * `bench/results/` alatt csak a szám marad meg, a jelentése nem. Új pálya =
 * új szám, sosem egy meglévő átdefiniálása.
 */

export interface GameLoopScenario {
  /** A Test Labnek átadott `--scenario-numbers` érték. */
  number: number;
  /** Rövid, gépi azonosító — ez kerül az eredmény-JSON-be. */
  key: string;
  scenario: BuiltInLabScenario;
  phaseId: string;
  /**
   * ⚠️ ALAPBÓL 1×, ÉS EZ NEM ELÍRÁS. A `LabE2eLauncherScreen` ugyanezt az
   * indoklást hordozza: gyorsított lejátszásnál a mért ezredmásodperc
   * ugyanannyi, de percenként sokszor annyi újraszámolás fut, tehát a
   * „mennyire terhelt a főszál" kérdésre HAMIS képet adna.
   *
   * Így viszont egy 25 km-es menet valós időben ~68 perc, ami NEM fér bele a
   * Test Lab napi 30 perces ingyenes valódi eszközös keretébe. Ezért van a
   * `-fast` változat külön sorszámon: az a keretbe fér, de az eredményét
   * csak MÁSIK gyorsított futással szabad összevetni, valós idejűvel nem.
   */
  playbackRate: LabE2ePlaybackRate;
  /** Egy mondat arról, mit feszít ez a pálya. */
  purpose: string;
}

const SCENARIO_25KM = scenario25km as unknown as BuiltInLabScenario;

export const GAME_LOOP_SCENARIOS: readonly GameLoopScenario[] = [
  {
    number: 1,
    key: 'perf-city-short-1x',
    scenario: PERF_TEST_SCENARIO,
    phaseId: 'perf-short',
    playbackRate: '1',
    purpose:
      'A #32 óta ismert városi kör, valós időben — ez köti össze a telefonos '
      + 'számot a 23 ms-os asztali alapértékkel.',
  },
  {
    number: 2,
    key: 'scenario-25km-fast',
    scenario: SCENARIO_25KM,
    phaseId: 'phase-1',
    playbackRate: '100',
    purpose:
      '25 km, 262 pont, sok hurokkal — gyorsítva, hogy a napi ingyenes '
      + 'keretbe férjen. A hurokkeresés NÖVEKEDÉSÉT mutatja meg.',
  },
  {
    number: 3,
    key: 'scenario-25km-realtime',
    scenario: SCENARIO_25KM,
    phaseId: 'phase-1',
    playbackRate: '1',
    purpose:
      'Ugyanaz valós időben. ⚠️ ~68 perc, tehát a napi ingyenes keretet '
      + 'TÚLLÉPI — csak tudatosan, fizetős futásként indítandó.',
  },
  {
    number: 4,
    key: 'scenario-25km-ramp-1000-to-1',
    scenario: SCENARIO_25KM,
    phaseId: 'phase-1',
    playbackRate: '1000>1@0.9',
    purpose:
      '1000×-es lejátszás az útvonal 90%-áig, utána 1×-re lassul (~2,5 km, '
      + '~6-7 perc valós idő) — Geri kérése (2026-09-05): a térkép gyorsan '
      + 'teleszóródik hurkokkal/cellákkal, majd VALÓS ütemben nézhető, '
      + 'hogyan viselkedik az app egy már megterhelt állapotban, anélkül '
      + 'hogy a teljes ~68 percet végig kellene várni.',
  },
];

export function findGameLoopScenario(scenarioNumber: number): GameLoopScenario | null {
  return GAME_LOOP_SCENARIOS.find((item) => item.number === scenarioNumber) ?? null;
}
