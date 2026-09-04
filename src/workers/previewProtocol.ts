import type { PreviewOutput, PreviewRequest } from '@/lib/previewEngine';
import type { CellOwnership, TracePoint } from '@/types';

/**
 * A főszál és az előnézet-worker közötti üzenetek.
 *
 * KÜLÖN FÁJLBAN, mert a főszál CSAK a típusokat importálja innen. Ha ezek a
 * worker moduljában lennének, a Vite a worker teljes függőségi fáját (h3-js is)
 * behúzná a fő csomagba — a típusimport ugyan eltűnik fordításkor, de a
 * modulhatár így egyértelmű marad, és egy véletlen értékimport sem szivárogtat.
 */

/** Főszál → worker. */
export type PreviewCommand =
  /**
   * Új rögzítés: mindent a nulláról. A `session` a `geometrySessionKey` —
   * ugyanarról a pontról indított új futásnál az első cellák véletlenül
   * egyezhetnek, és a régi hurkok bennragadnának.
   */
  | { kind: 'reset'; session: string }
  /**
   * Új birtokviszony a `/api/tiles` válaszából. Csak VÁLTOZÁSKOR küldjük: a
   * gyorsítótár a Map azonosságát nézi, tehát minden ilyen üzenet egy teljes
   * elszámolás-újraszámolást ér.
   */
  | { kind: 'ownership'; session: string; cells: [string, CellOwnership][] }
  /**
   * Számolj — a `points` a LEGUTÓBB KÜLDÖTT ÓTA érkezett pontok, nem a teljes
   * nyomvonal. Lásd `PreviewSession.points` a `lib/previewEngine.ts`-ben:
   * a teljes lista átküldése minden alkalommal a nulláról építtetné újra a
   * gyorsítótárat (mérve: 1 248 ms vs. 2,6 ms).
   *
   * A `replace` a ritka eset, amikor a nyom NEM folytatódott (visszamenőleges
   * eltérés); ilyenkor a `points` a teljes nyomvonal.
   */
  | {
    kind: 'run';
    session: string;
    seq: number;
    points: readonly TracePoint[];
    replace: boolean;
    request: PreviewRequest;
  };

/** Worker → főszál. */
export type PreviewResponse =
  | { kind: 'ready' }
  | { kind: 'result'; session: string; seq: number; output: PreviewOutput }
  /**
   * A worker váratlanul elhasalt. A hívó ilyenkor a szinkron tartalék ágra
   * áll át — előnézet nélkül maradni rosszabb, mint egy akadás.
   */
  | { kind: 'failed'; session: string; seq: number; message: string };
