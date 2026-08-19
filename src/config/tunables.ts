/**
 * GRUNDO — a HANGOLHATÓ játékkonstansok sémája.
 *
 * A `gameplay.ts` az alapértékek forrása. Ez a fájl azt mondja meg, hogy
 * ezekből MELYIK állítható élesben, milyen tartományban, és magyarul mit
 * jelent.
 *
 * Két fogyasztója van, és pont ezért egyetlen séma:
 *   1. az admin Játékkonfiguráció szerkesztő (mit lehet állítani, meddig),
 *   2. a felhasználói szabálymagyarázó felület (mit jelent a szám).
 * Ha a magyarázat külön, kézzel írt szöveg lenne, egy átállított szorzó után a
 * felület HAZUDNA a játékosnak — méghozzá pont a hangolási fázisban, amikor a
 * legtöbbet nyúlunk hozzá.
 *
 * ⚠️ AMI NINCS ITT, AZ SZERKEZETI, és élesben NEM állítható:
 * H3 felbontás, cella névleges területe, `MAX_DEFENSE`, a hurokküszöbök
 * (`MIN_INTERIOR_CELLS`, `MIN_LOOP_STEPS`, `MAX_LOOP_BBOX_CELLS`) és a
 * szintlépcső. Az első kettő adatformátum — menet közben átállítva a tárolt
 * rács értelmezhetetlenné válna. A hurokküszöbök mért, indoklással rögzített
 * értékek (lásd a `MIN_INTERIOR_CELLS` melletti feljegyzést); egy kattintással
 * állíthatóvá tenni őket pont azt a visszaesést hívná vissza, ami ellen a
 * mérés született. A szintlépcső pedig képletből áll, nem számokból.
 *
 * docs/06-architektura-es-admin.md → 7. Játékkonfiguráció
 */

import { GAMEPLAY, type GameplayConfig } from './gameplay';

export type TunableKind = 'number' | 'integer' | 'boolean';

export interface TunableSpec {
  /** Pontozott útvonal a konfigurációs objektumban, pl. `BASE_GP_PER_KM.run`. */
  path: string;
  kind: TunableKind;
  min?: number;
  max?: number;
  /** Csoport az admin szerkesztőben és a szabálymagyarázóban. */
  group: string;
  label: string;
  /** Magyar magyarázat — ez jelenik meg a felhasználónak is. */
  help: string;
  unit?: string;
}

export const TUNABLES: readonly TunableSpec[] = [
  // ── Alappont ────────────────────────────────────────────────────────────
  {
    path: 'BASE_GP_PER_KM.run',
    kind: 'number',
    min: 0,
    max: 100,
    unit: 'GP/km',
    group: 'Alappont',
    label: 'Futás',
    help: 'Minden megtett kilométer ennyi pontot ér futás közben — akkor is, ha nem zárul be a kör.',
  },
  {
    path: 'BASE_GP_PER_KM.walk',
    kind: 'number',
    min: 0,
    max: 100,
    unit: 'GP/km',
    group: 'Alappont',
    label: 'Gyaloglás',
    help: 'Minden megtett kilométer ennyi pontot ér gyaloglás közben.',
  },
  {
    path: 'BASE_GP_PER_KM.ride',
    kind: 'number',
    min: 0,
    max: 100,
    unit: 'GP/km',
    group: 'Alappont',
    label: 'Kerékpár',
    help: 'Minden megtett kilométer ennyi pontot ér bringával. Azért alacsonyabb, mert bringával ugyanannyi idő alatt sokkal több kilométer jön össze.',
  },

  // ── Területfoglalás ─────────────────────────────────────────────────────
  {
    path: 'CLAIM_GP_PER_SQRT_KM2',
    kind: 'number',
    min: 0,
    max: 2000,
    unit: 'GP',
    group: 'Területfoglalás',
    label: 'Igény-együttható',
    help: 'A bezárt területért járó pont: ennyi GP szorozva a terület négyzetgyökével (km²-ben). A gyök azért kell, mert a bezárt terület a kör méretének négyzetével nő, a megtett út viszont csak egyenes arányban — enélkül egyetlen nagy kör mindent vinne.',
  },
  {
    path: 'STEAL_BONUS',
    kind: 'number',
    min: 0,
    max: 3,
    group: 'Területfoglalás',
    label: 'Lopás bónusz',
    help: 'Ha idegentől veszed el a mezőt, az arra eső igénypont ennyiszeresét kapod ráadásként. 0,5 = plusz 50 %.',
  },
  {
    path: 'BREAKTHROUGH_BONUS',
    kind: 'number',
    min: 0,
    max: 3,
    group: 'Területfoglalás',
    label: 'Áttörés bónusz',
    help: 'Ha védett idegen mezőt támadsz, és az még nem cserél gazdát, csak a védelme csökken, az arra eső igénypont ennyiszerese jár. Így az „eredménytelen" támadás sem hiábavaló.',
  },

  // ── Védelem ─────────────────────────────────────────────────────────────
  {
    path: 'DEFENSE_MULTIPLIER.0',
    kind: 'number',
    min: 1,
    max: 20,
    unit: '×',
    group: 'Védelem',
    label: '1-es védelem szorzója',
    help: 'Frissen szerzett mező. Ez a viszonyítási alap, ezért mindig 1.',
  },
  {
    path: 'DEFENSE_MULTIPLIER.1',
    kind: 'number',
    min: 1,
    max: 20,
    unit: '×',
    group: 'Védelem',
    label: '2-es védelem szorzója',
    help: 'A saját meződ ismételt bezárása +1 védelmet ad, és az igénypont ezzel szorzódik.',
  },
  {
    path: 'DEFENSE_MULTIPLIER.2',
    kind: 'number',
    min: 1,
    max: 20,
    unit: '×',
    group: 'Védelem',
    label: '3-as védelem szorzója',
    help: 'Harmadszor is ugyanaz a kör.',
  },
  {
    path: 'DEFENSE_MULTIPLIER.3',
    kind: 'number',
    min: 1,
    max: 20,
    unit: '×',
    group: 'Védelem',
    label: '4-es védelem szorzója',
    help: 'Negyedszer is ugyanaz a kör.',
  },
  {
    path: 'DEFENSE_MULTIPLIER.4',
    kind: 'number',
    min: 1,
    max: 20,
    unit: '×',
    group: 'Védelem',
    label: '5-ös védelem szorzója',
    help: 'A legmagasabb védelmi szint. A védelem naponta egy szintet gyengül, tehát ezt tartani csak rendszeres mozgással lehet.',
  },

  // ── Sorozat ─────────────────────────────────────────────────────────────
  {
    path: 'DAILY_STREAK_STEP',
    kind: 'number',
    min: 0,
    max: 1,
    group: 'Sorozat',
    label: 'Napi lépcső',
    help: 'A sorozat minden további napja ennyivel növeli a szorzót. 0,05 = naponta plusz 5 %.',
  },
  {
    path: 'DAILY_STREAK_MAX',
    kind: 'number',
    min: 1,
    max: 5,
    unit: '×',
    group: 'Sorozat',
    label: 'Sorozat-plafon',
    help: 'A sorozatszorzó ennél nagyobb nem lehet, akármeddig tart a széria.',
  },
  {
    path: 'STREAK_FREEZES_PER_WEEK',
    kind: 'integer',
    min: 0,
    max: 7,
    unit: 'nap',
    group: 'Sorozat',
    label: 'Heti fagyasztás',
    help: 'Hetente ennyi kihagyott nap nem töri meg a sorozatot. Ez véd attól, hogy egy betegség vagy egy utazás lenullázzon egy hosszú szériát.',
  },
  {
    path: 'WEEK_STREAK_MIN_ACTIVE_DAYS',
    kind: 'integer',
    min: 1,
    max: 7,
    unit: 'nap',
    group: 'Sorozat',
    label: 'Heti sorozat feltétele',
    help: 'Egy hét akkor számít bele a heti sorozatba, ha legalább ennyi napon volt mentett aktivitásod.',
  },
  {
    path: 'WEEK_STREAK_MILESTONES.4',
    kind: 'integer',
    min: 0,
    max: 100000,
    unit: 'GP',
    group: 'Sorozat',
    label: '4 hetes mérföldkő',
    help: 'Egyszeri jutalom, ha négy egymást követő héten volt legalább három aktív napod.',
  },
  {
    path: 'WEEK_STREAK_MILESTONES.12',
    kind: 'integer',
    min: 0,
    max: 100000,
    unit: 'GP',
    group: 'Sorozat',
    label: '12 hetes mérföldkő',
    help: 'Egyszeri jutalom tizenkét hetes heti sorozatért.',
  },
  {
    path: 'WEEK_STREAK_MILESTONES.26',
    kind: 'integer',
    min: 0,
    max: 100000,
    unit: 'GP',
    group: 'Sorozat',
    label: '26 hetes mérföldkő',
    help: 'Egyszeri jutalom fél évnyi heti sorozatért.',
  },
  {
    path: 'WEEK_STREAK_MILESTONES.52',
    kind: 'integer',
    min: 0,
    max: 100000,
    unit: 'GP',
    group: 'Sorozat',
    label: '52 hetes mérföldkő',
    help: 'Egyszeri jutalom egy teljes évnyi heti sorozatért.',
  },

  // ── Napi jóváírás ───────────────────────────────────────────────────────
  {
    path: 'HOLD_GP_PER_KM2',
    kind: 'number',
    min: 0,
    max: 10000,
    unit: 'GP/km²/nap',
    group: 'Napi jóváírás',
    label: 'Tartás-bónusz',
    help: 'A birtokolt terület minden nap ennyi pontot termel négyzetkilométerenként. Ez a passzív bevételed: a birodalom akkor is dolgozik, amikor te pihensz.',
  },
  {
    path: 'HOLD_GP_DAILY_CAP',
    kind: 'number',
    min: 0,
    max: 100000,
    unit: 'GP/nap',
    group: 'Napi jóváírás',
    label: 'Tartás-plafon',
    help: 'A tartás-bónusz naponta ennél többet nem adhat. Ez akadályozza meg, hogy egy korán induló nagybirtokos passzívan elszaladjon. A két réteg (gyalogos és bringás) külön-külön számít, saját plafonnal.',
  },
  {
    path: 'HOLD_REQUIRES_ACTIVE_DAYS',
    kind: 'integer',
    min: 1,
    max: 365,
    unit: 'nap',
    group: 'Napi jóváírás',
    label: 'Aktivitási feltétel',
    help: 'A tartás-bónusz csak akkor jár, ha ennyi napon belül volt legalább egy mentett aktivitásod. Az inaktív birodalom nem termel.',
  },
  {
    path: 'SOFT_CAP_GP_PER_DAY',
    kind: 'number',
    min: 0,
    max: 1000000,
    unit: 'GP/nap',
    group: 'Napi jóváírás',
    label: 'Lágy plafon',
    help: 'Efölött a napi pont csökkentett értéken számít. Nem kemény korlát: az extrém teljesítmény továbbra is jutalmazott, csak csökkenő hozammal.',
  },
  {
    path: 'SOFT_CAP_RATE',
    kind: 'number',
    min: 0,
    max: 1,
    group: 'Napi jóváírás',
    label: 'Lágy plafon hozama',
    help: 'A lágy plafon fölötti rész ennyiszeres értéken számít. 0,5 = fél értéken.',
  },

  // ── Rögzítés ────────────────────────────────────────────────────────────
  {
    path: 'MIN_DISTANCE_M',
    kind: 'integer',
    min: 0,
    max: 10000,
    unit: 'm',
    group: 'Rögzítés',
    label: 'Minimális távolság',
    help: 'Ennél rövidebb aktivitás nem menthető.',
  },
  {
    path: 'MAX_GPS_ACCURACY_M',
    kind: 'integer',
    min: 5,
    max: 200,
    unit: 'm',
    group: 'Rögzítés',
    label: 'GPS-pontosság küszöbe',
    help: 'Az ennél pontatlanabb GPS-pontokat eldobjuk, hogy ne rajzoljanak hamis kanyarokat a nyomvonalba.',
  },

  // ── Trust Score ─────────────────────────────────────────────────────────
  {
    path: 'TRUST_OBSERVE_ONLY',
    kind: 'boolean',
    group: 'Trust Score',
    label: 'Megfigyelő mód',
    help: 'Bekapcsolva a bizalmi pontszám kiszámolódik és elmentődik, de nem blokkol semmit. Kikapcsolni csak azután szabad, hogy valódi aktivitásokon megmértük a küszöböket.',
  },
  {
    path: 'TRUST_THRESHOLD_ACCEPT',
    kind: 'integer',
    min: 0,
    max: 100,
    group: 'Trust Score',
    label: 'Elfogadási küszöb',
    help: 'Ettől a pontszámtól az aktivitás azonnal feldolgozódik.',
  },
  {
    path: 'TRUST_THRESHOLD_REJECT',
    kind: 'integer',
    min: 0,
    max: 100,
    group: 'Trust Score',
    label: 'Elutasítási küszöb',
    help: 'Ez alatt az aktivitás elutasításra kerül. A kettő között ellenőrzésre vár.',
  },
  {
    path: 'TRUST_AUTO_APPROVE_MINUTES',
    kind: 'integer',
    min: 1,
    max: 10080,
    unit: 'perc',
    group: 'Trust Score',
    label: 'Türelmi automatika',
    help: 'Magas felhasználói bizalom esetén az ellenőrzésre váró aktivitás ennyi idő után magától érvényesül, ha nem érkezett ellenjel.',
  },
];

const BY_PATH = new Map(TUNABLES.map((spec) => [spec.path, spec]));

export function tunableAt(path: string): TunableSpec | undefined {
  return BY_PATH.get(path);
}

/** A séma szerinti csoportok, a `TUNABLES` sorrendjét megtartva. */
export function tunableGroups(): { group: string; items: TunableSpec[] }[] {
  const groups: { group: string; items: TunableSpec[] }[] = [];
  for (const spec of TUNABLES) {
    const last = groups[groups.length - 1];
    if (last && last.group === spec.group) last.items.push(spec);
    else groups.push({ group: spec.group, items: [spec] });
  }
  return groups;
}

export interface RejectedOverride {
  path: string;
  value: unknown;
  reason: string;
}

export interface ResolvedGameplay {
  config: GameplayConfig;
  /** Ténylegesen érvényre jutott felülírások. */
  applied: Record<string, number | boolean>;
  /** Amit eldobtunk, és miért — ez naplózandó, nem elnyelendő. */
  rejected: RejectedOverride[];
}

function readPath(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, target);
}

function writePath(target: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  let node: Record<string, unknown> = target;
  for (let i = 0; i < keys.length - 1; i += 1) {
    const next = node[keys[i]!];
    if (next === null || typeof next !== 'object') return;
    node = next as Record<string, unknown>;
  }
  node[keys[keys.length - 1]!] = value;
}

function checkValue(spec: TunableSpec, value: unknown): string | null {
  if (spec.kind === 'boolean') {
    return typeof value === 'boolean' ? null : 'logikai értéket vár';
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'számot vár';
  if (spec.kind === 'integer' && !Number.isInteger(value)) return 'egész számot vár';
  if (spec.min !== undefined && value < spec.min) return `nem lehet kisebb, mint ${spec.min}`;
  if (spec.max !== undefined && value > spec.max) return `nem lehet nagyobb, mint ${spec.max}`;
  return null;
}

/**
 * Keresztellenőrzések.
 *
 * Az egyedi tartományok nem fogják meg azokat a kombinációkat, amik külön-külön
 * érvényesek, együtt viszont eltörik a játékot. A visszaadott útvonalakat
 * visszaállítjuk az alapértékre: inkább menjen a rendszer az alapértékkel, mint
 * egy nem monoton védelmi létrával.
 */
function crossCheck(config: GameplayConfig): RejectedOverride[] {
  const problems: RejectedOverride[] = [];

  const ladder = config.DEFENSE_MULTIPLIER;
  if (ladder[0] !== 1) {
    problems.push({
      path: 'DEFENSE_MULTIPLIER.0',
      value: ladder[0],
      reason: 'az 1-es védelem a viszonyítási alap, ezért pontosan 1 kell legyen',
    });
  }
  for (let i = 1; i < ladder.length; i += 1) {
    if ((ladder[i] ?? 0) < (ladder[i - 1] ?? 0)) {
      problems.push({
        path: `DEFENSE_MULTIPLIER.${i}`,
        value: ladder[i],
        reason: 'a védelmi létra nem csökkenhet — különben a magasabb védelem kevesebbet érne',
      });
    }
  }

  if (config.TRUST_THRESHOLD_REJECT > config.TRUST_THRESHOLD_ACCEPT) {
    problems.push({
      path: 'TRUST_THRESHOLD_REJECT',
      value: config.TRUST_THRESHOLD_REJECT,
      reason: 'az elutasítási küszöb nem lehet magasabb az elfogadásinál',
    });
  }

  return problems;
}

/**
 * Alapértékek + felülírások → érvényes konfiguráció.
 *
 * SOHA nem dob kivételt. Egy elrontott `appConfig` dokumentum nem állíthatja meg
 * a játékot: az érvénytelen kulcs kimarad, az eredmény az alapérték, és a
 * `rejected` listából kiderül, mi volt a baj.
 */
export function resolveGameplay(overrides?: Record<string, unknown> | null): ResolvedGameplay {
  const config = structuredClone(GAMEPLAY) as unknown as GameplayConfig;
  const applied: Record<string, number | boolean> = {};
  const rejected: RejectedOverride[] = [];

  for (const [path, value] of Object.entries(overrides ?? {})) {
    const spec = BY_PATH.get(path);
    if (!spec) {
      rejected.push({ path, value, reason: 'nem hangolható kulcs' });
      continue;
    }
    const problem = checkValue(spec, value);
    if (problem) {
      rejected.push({ path, value, reason: problem });
      continue;
    }
    writePath(config as unknown as Record<string, unknown>, path, value);
    applied[path] = value as number | boolean;
  }

  for (const problem of crossCheck(config)) {
    writePath(
      config as unknown as Record<string, unknown>,
      problem.path,
      readPath(GAMEPLAY, problem.path),
    );
    delete applied[problem.path];
    rejected.push(problem);
  }

  return { config, applied, rejected };
}
