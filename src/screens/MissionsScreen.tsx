import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, SegmentedControl } from '@/components/ui';
import { ProfileHeader } from '@/components/ProfileHeader';
import { SavedRoutesSheet } from '@/components/SavedRoutesSheet';
import { useProfile } from '@/hooks/ProfileProvider';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { useSharedPosition } from '@/hooks/useSharedPosition';
import { routeImageUrl } from '@/lib/staticMap';
import { readDailyMissionResult, rememberDailyMission } from '@/lib/dailyMission';
import { rememberGhostRoute } from '@/lib/ghostRoute';
import { MISSION_KIND_META, missionAreaStat } from '@/lib/missionMeta';
import { isRouteSaved, saveRoute } from '@/lib/savedRoutes';
import { formatArea, formatDistance, formatNumber } from '@/lib/format';
import { compatibleDistanceTarget } from '@/lib/missionTarget';
import { api, ApiError, apiConfigured, type Mission, type MissionPlanResult, type MissionPriority, type MissionResult, type PlannedRoute, type RouteCharacter } from '@/lib/api';
import { GAMEPLAY } from '@/config/gameplay';
import type { ActivityType } from '@/types';
import './missions.css';

/**
 * Küldetés-ajánló — „van 45 perced?".
 *
 * EZ NEM ÚTVONALTERVEZŐ. A „fuss 8 km-t" logika bármelyik futóappban megvan;
 * itt az útvonalnak játékbeli TÉTJE van, és a kártya ezt mondja ki: mennyi
 * területet szerzel, kitől veszel el, melyik zónád védelme nő.
 *
 * A bemenet IDŐ vagy TÁVOLSÁG. Időnél a szerver a saját átlagtempóból számol,
 * amit az adott küldetéshez felül lehet írni.
 *
 * docs/02-funkcionalis-spec.md → Útvonalak fül — Küldetés-ajánló
 */

const TYPE_OPTIONS: { value: ActivityType; label: string }[] = [
  { value: 'run', label: 'Futás' },
  { value: 'walk', label: 'Séta' },
  { value: 'ride', label: 'Bringa' },
];

const LAST_TYPE_KEY = 'grundo.lastActivityType';

/**
 * A célhossz határai kilométerben.
 *
 * ⚠️ EGYEZNIE KELL a szerver `MAX_TARGET_KM` értékével
 * (`server/src/routes/missions.ts`). Ha a kettő elcsúszik, a felület vagy
 * olyat enged át, amit a szerver elutasít, vagy olyat tilt, ami menne.
 * 2026-08-29-től 300 km (korábban 50) — a szerver konstansánál áll, hogy
 * ennek mi az ára.
 */
const MIN_TARGET_KM = 0.5;
const MAX_TARGET_KM = 300;

type TimeUnit = 'minute' | 'hour';
type TargetMode = 'time' | 'distance';

const UNIT_OPTIONS: { value: TimeUnit; label: string }[] = [
  { value: 'minute', label: 'perc' },
  { value: 'hour', label: 'óra' },
];

/**
 * A ténylegesen elküldendő időkeret PERCBEN.
 *
 * A szerver mindig percet vár, tehát az óra/perc választás itt oldódik fel.
 * A határokat a kliens is ismeri (`GAMEPLAY.MISSION_MIN/MAX_MINUTES`), hogy
 * a felhasználó azonnal visszajelzést kapjon — de a szerver is ellenőrzi,
 * mert a kliens ellenőrzése sosem elég.
 */
/**
 * Hány percre szólt egy visszatöltött eredmény?
 *
 * Nem tároljuk külön: a válasz `targetKm`-je és `paceSecPerKm`-je pontosan
 * ebből számolódott (`targetDistanceKm`), tehát visszafelé is megvan. Így az
 * űrlap ugyanazt az időt mutatja, amiből a kártyák készültek — különben az
 * „Újragenerálás" csendben másik időkerettel indulna.
 */
function minutesOf(result: MissionResult | null): number | null {
  if (!result || !(result.targetKm > 0) || !(result.paceSecPerKm > 0)) return null;
  const minutes = Math.round((result.targetKm * result.paceSecPerKm) / 60);
  return minutes >= GAMEPLAY.MISSION_MIN_MINUTES && minutes <= GAMEPLAY.MISSION_MAX_MINUTES
    ? minutes
    : null;
}

function resolveMinutes(
  customOpen: boolean,
  preset: number,
  raw: string,
  unit: TimeUnit,
): number | null {
  if (!customOpen) return preset;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return null;
  const asMinutes = Math.round(unit === 'hour' ? value * 60 : value);
  if (asMinutes < GAMEPLAY.MISSION_MIN_MINUTES || asMinutes > GAMEPLAY.MISSION_MAX_MINUTES) {
    return null;
  }
  return asMinutes;
}

export function MissionsScreen() {
  const navigate = useNavigate();
  const { profile } = useProfile();
  const shared = useSharedPosition(profile?.uid);

  /*
    A MAI GENERÁLÁS VISSZATÖLTVE — nem új hívás, nem fogyaszt kvótát.

    A Home kártyája eddig egy konkrét ajánlatot mutatott, a gombja viszont ide,
    egy ÜRES képernyőre vitt: a felhasználó azt látta, hogy amit az előbb
    olvasott, itt nyoma sincs. A tár amúgy is naponta ürül, tehát ami
    visszajön, az mindig a mai birtokviszonyra épült.

    A `useState` LUSTA alakja fontos: a tár olvasása és a JSON értelmezése így
    egyszer fut le, nem minden rendernél.
  */
  const [restored] = useState(() => {
    const result = readDailyMissionResult();
    const minutes = minutesOf(result);
    const preset =
      minutes !== null && (GAMEPLAY.MISSION_MINUTE_OPTIONS as readonly number[]).includes(minutes);
    return { result, minutes, preset };
  });

  const [minutes, setMinutes] = useState<number>(
    restored.preset && restored.minutes !== null ? restored.minutes : 45,
  );
  const [customOpen, setCustomOpen] = useState(false);
  const [customValue, setCustomValue] = useState(
    restored.minutes !== null && !restored.preset ? String(restored.minutes) : '90',
  );
  const [customUnit, setCustomUnit] = useState<TimeUnit>('minute');
  const [type, setType] = useState<ActivityType>(() => readType());
  const [targetMode, setTargetMode] = useState<TargetMode>('time');
  const [distanceValue, setDistanceValue] = useState('5');
  const [paceValue, setPaceValue] = useState('');
  const [priority, setPriority] = useState<MissionPriority>('balanced');
  /**
   * Hány ajánlatot kérünk. FELSŐ KORLÁT: ha ennyi érdemben különböző kör nem
   * jön össze, kevesebb jön — a szerver lazít a hasonlóság-szűrésen a szám
   * eléréséért, de ugyanabból a körből nem gyárt kettőt.
   */
  const [limit, setLimit] = useState<number>(GAMEPLAY.MISSION_RESULT_DEFAULT);
  const [routeCharacter, setRouteCharacter] = useState<RouteCharacter>('twisty');
  const [preferredBearing, setPreferredBearing] = useState('');
  const [savedOpen, setSavedOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const [result, setResult] = useState<MissionResult | null>(restored.result);
  /**
   * A GYORS fázis eredménye — útvonalak, terület nélkül.
   *
   * Amíg ez áll, a kártyák már láthatók (térkép + hossz), a terület/GP/mező
   * mezők pedig töltő jelzést mutatnak. A `result` megérkezésekor nullázódik.
   */
  const [plan, setPlan] = useState<MissionPlanResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  /** Igaz, amíg a képernyőn a visszatöltött, nem a most kért eredmény áll. */
  const [fromToday, setFromToday] = useState(restored.result !== null);

  useEffect(() => {
    if (shared) setPosition({ lat: shared.lat, lng: shared.lng });
  }, [shared]);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_TYPE_KEY, type);
    } catch {
      /* privát böngészés — a választás nem marad meg, de működik */
    }
  }, [type]);

  /**
   * Mozgásforma-váltáskor a tempómező KIÜRÜL.
   *
   * ⚠️ Mert a mértékegysége is más: futásnál/sétánál perc/km („6:00"),
   * bringánál km/h („25"). Váltás után a régi szöveg értelmetlen az új
   * egységgel — a felület egy ideig „5:15 km/h"-t írt ki. (Korábban ez rejtve
   * maradt: a mező csak olvasható volt, és a `Number('5:15')` NaN-ja miatt
   * némán a 22-es alapértéket mutatta.) A mező opcionális, tehát az üres
   * állapot helyes alapértelmezés: ilyenkor a szerver a saját mért tempóddal
   * számol.
   */
  function changeType(next: ActivityType) {
    setType(next);
    setPaceValue('');
  }

  /**
   * A helyzet a küldetéshez KELL — enélkül nincs mihez képest kört keresni.
   *
   * Ha nincs tárolt pozíció (a Grund képernyő még nem írt egyet), itt kérjük
   * el. Ez felhasználói gesztusra történik, nem az app indulásakor — lásd a
   * `WeatherWidget` fejlécében ugyanezt az indoklást.
   */
  function askPosition(): Promise<{ lat: number; lng: number } | null> {
    return new Promise((resolve) => {
      if (position) {
        resolve(position);
        return;
      }
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (fix) => {
          const next = { lat: fix.coords.latitude, lng: fix.coords.longitude };
          setPosition(next);
          resolve(next);
        },
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
      );
    });
  }

  async function generate() {
    if (!apiConfigured) {
      setError('A háttérszolgáltatás nincs beállítva, a küldetés nem generálható.');
      return;
    }

    const wanted = targetMode === 'time'
      ? resolveMinutes(customOpen, minutes, customValue, customUnit)
      : null;
    const distanceKm = targetMode === 'distance' ? Number(distanceValue) : null;
    if (targetMode === 'time' && wanted === null) {
      const maxHours = Math.round(GAMEPLAY.MISSION_MAX_MINUTES / 60);
      setError(
        `Az időkeret ${GAMEPLAY.MISSION_MIN_MINUTES} perc és ${maxHours} óra között lehet.`,
      );
      return;
    }
    if (targetMode === 'distance' && (!Number.isFinite(distanceKm) || distanceKm! < MIN_TARGET_KM || distanceKm! > MAX_TARGET_KM)) {
      setError(`A célhossz ${formatNumber(MIN_TARGET_KM)} és ${MAX_TARGET_KM} km között lehet.`);
      return;
    }
    const paceSecPerKm = resolvePace(type, paceValue);
    if (paceValue.trim() && paceSecPerKm === null) {
      setError(type === 'ride' ? 'Adj meg 3 és 60 km/h közötti sebességet.' : 'A tempó formátuma például 6:15.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const where = await askPosition();
      if (!where) {
        setError('A küldetéshez tudnunk kell, hol vagy. Engedélyezd a helymeghatározást.');
        return;
      }

      /*
        KÉT FÁZIS — a kártya nem várja meg a területszámítást.

        Mérve (2026-08-29): az útvonaltervezés és a válogatás 0,5–2,2 s, míg a
        teljes lánc egy nagy bringakörnél 12,7 s. Ezért előbb az útvonalakat
        kérjük el, kirajzoljuk a kártyákat, és a terület/GP/karakter mezők
        utólag töltődnek ki.

        ⚠️ A „NEM BECSLÉS" SZABÁLY ÉRVÉNYES: a köztes állapotban NEM írunk ki
        közelítő számot, amit később felülírnánk — a mező töltő jelzést mutat,
        amíg a valódi motor ki nem számolja.
      */
      const plan = await api.missionsPlan({
        ...where,
        ...(targetMode === 'time'
          ? { minutes: wanted! }
          : compatibleDistanceTarget(
              distanceKm!,
              paceSecPerKm ?? GAMEPLAY.MISSION_DEFAULT_PACE_S_PER_KM[type],
            )),
        ...(paceSecPerKm === null ? {} : { paceSecPerKm }),
        priority,
        limit,
        ...(preferredBearing === '' ? {} : { preferredBearing: Number(preferredBearing) }),
        type,
        // Sétánál a kapcsoló nincs a felületen — nincs értelme kanyarbüntetésnek.
        ...(type === 'walk' ? {} : { routeCharacter }),
      });

      setResult(null);
      setFromToday(false);

      if (plan.routes.length === 0) {
        // Nincs mit kiértékelni: a `plan` már megmondta az okot.
        setResult({ ...plan, missions: [] });
        return;
      }

      // A kártyák INNENTŐL láthatók, terület nélkül.
      setPlan(plan);
      setLoading(false);

      const evaluated = await api.missionsEvaluate({
        type,
        priority,
        limit,
        routes: plan.routes.map((route) => ({
          polyline: route.polyline,
          bearing: route.bearing,
        })),
      });

      const full: MissionResult = {
        targetKm: plan.targetKm,
        paceSecPerKm: plan.paceSecPerKm,
        ...(plan.quota === undefined ? {} : { quota: plan.quota }),
        missions: evaluated.missions,
        ...(evaluated.reason === undefined ? {} : { reason: evaluated.reason }),
      };
      setResult(full);
      // Az eredmény átkerül a Home „mai küldetés" kártyájára, és ide is
      // visszatölthető marad, ha a felhasználó közben elnavigál.
      rememberDailyMission(full);
    } catch (problem: unknown) {
      setResult(null);
      setFromToday(false);
      setError(
        problem instanceof ApiError ? problem.message : 'A küldetés-generálás most nem működik.',
      );
    } finally {
      setPlan(null);
      setLoading(false);
    }
  }

  return (
    <>
      <ProfileHeader active="missions" />

      <div className="screen-body stack">
        <section className="card mission__form">
          <div>
          <SegmentedControl
            options={[{ value: 'time', label: 'Idő' }, { value: 'distance', label: 'Távolság' }]}
            value={targetMode}
            onChange={setTargetMode}
            label="Tervezés alapja"
            block
          />

          <div className="mission__question">
            {targetMode === 'time' ? 'Mennyi időd van?' : 'Hány kilométert mennél?'}
          </div>

          {targetMode === 'time' ? (
          <>
          {/*
            Gombsor, nem csúszka. A docs csúszkát ír, de öt fix érték mellett a
            csúszka csak pontatlanabb: ugyanaz az öt állás, nehezebben
            eltalálható. A jelentés változatlan.
          */}
          <div className="mission__minutes" role="group" aria-label="Időkeret">
            {GAMEPLAY.MISSION_MINUTE_OPTIONS.map((option) => (
              <button
                type="button"
                key={option}
                className={`mission__minute${
                  !customOpen && option === minutes ? ' mission__minute--active' : ''
                }`}
                aria-pressed={!customOpen && option === minutes}
                onClick={() => {
                  setCustomOpen(false);
                  setMinutes(option);
                }}
              >
                {option}
                <span className="mission__minute-unit">perc</span>
              </button>
            ))}
            <button
              type="button"
              className={`mission__minute${customOpen ? ' mission__minute--active' : ''}`}
              aria-pressed={customOpen}
              onClick={() => setCustomOpen(true)}
            >
              <PencilIcon />
              <span className="mission__minute-unit">egyedi</span>
            </button>
          </div>

          {/*
            EGYEDI IDŐ — a fix gombok nem fedik le mindenki napját.

            Az érték a beírt szám ÉS a mértékegység szorzata; a `minutes`
            állapot mindig percben marad, mert a szerver azt várja. Így az
            óra/perc váltás tisztán megjelenítési kérdés, nem kerül át a
            hálózati szerződésbe.
          */}
          {customOpen ? (
            <div className="mission__custom">
              <input
                type="number"
                className="mission__custom-input"
                inputMode="numeric"
                min={1}
                value={customValue}
                aria-label={customUnit === 'hour' ? 'Óra' : 'Perc'}
                onChange={(event) => setCustomValue(event.target.value)}
              />
              <SegmentedControl
                options={UNIT_OPTIONS}
                value={customUnit}
                onChange={setCustomUnit}
                label="Mértékegység"
                size="sm"
              />
            </div>
          ) : null}
          </>
          ) : (
            <div className="mission__field">
              <span>Célhossz</span>
              <Stepper
                value={distanceValue}
                onChange={setDistanceValue}
                unit="km"
                ariaLabel="Célhossz"
                placeholder="5"
                onStep={(direction) => {
                  const current = Number(distanceValue.replace(',', '.')) || 5;
                  const step = distanceStepKm(current, direction);
                  // A léptékre kerekítünk, hogy a kézzel beírt 7,3 után is
                  // kerek értékek jöjjenek (7,3 → 8 → 9), ne 8,3 → 9,3.
                  const next = Math.round((current + direction * step) / step) * step;
                  const clamped = Math.max(MIN_TARGET_KM, Math.min(MAX_TARGET_KM, next));
                  setDistanceValue(String(clamped));
                }}
              />
            </div>
          )}

          <div className="mission__type">
            <SegmentedControl
              options={TYPE_OPTIONS}
              value={type}
              onChange={changeType}
              label="Mozgásforma"
              block
            />
          </div>


          {advancedOpen ? <div className="mission__advanced">
          {/* `div`, nem `label`: a stepper maga tartalmaz egy label-t a mező
              köré, és a beágyazott label érvénytelen HTML lenne. A mezőt az
              inputon lévő `aria-label` azonosítja. */}
          <div className="mission__field">
            <span>{type === 'ride' ? 'Tervezett átlagsebesség (opcionális)' : 'Tervezett átlagtempó (opcionális)'}</span>
            <PaceStepper type={type} value={paceValue} onChange={setPaceValue} />
          </div>

          {/* Lásd a `limit` állapot magyarázatát: felső korlát, nem garancia. */}
          <div className="mission__field">
            <span>Hány ajánlatot kérsz?</span>
            <Stepper
              value={String(limit)}
              unit="db"
              inputMode="numeric"
              ariaLabel="Kért ajánlatok száma"
              onChange={(next) => {
                const parsed = Number(next.replace(/\D/g, ''));
                if (!Number.isFinite(parsed) || parsed === 0) return;
                setLimit(Math.max(GAMEPLAY.MISSION_RESULT_MIN, Math.min(GAMEPLAY.MISSION_RESULT_MAX, parsed)));
              }}
              onStep={(direction) => {
                setLimit((current) =>
                  Math.max(
                    GAMEPLAY.MISSION_RESULT_MIN,
                    Math.min(GAMEPLAY.MISSION_RESULT_MAX, current + direction),
                  ),
                );
              }}
            />
          </div>

          <div className="mission__select-grid">
            <label className="mission__field">
              <span>Elsődleges cél</span>
              <select value={priority} onChange={(event) => setPriority(event.target.value as MissionPriority)}>
                <option value="balanced">Legjobb ajánlat</option>
                <option value="conquest">Új terület</option>
                <option value="raid">Rablás</option>
                <option value="fortify">Grund erősítése</option>
                <option value="explore">Felfedezés</option>
              </select>
            </label>
            <label className="mission__field">
              <span>Irány</span>
              <select value={preferredBearing} onChange={(event) => setPreferredBearing(event.target.value)}>
                <option value="">Mindegy</option>
                <option value="0">Észak</option><option value="45">Északkelet</option>
                <option value="90">Kelet</option><option value="135">Délkelet</option>
                <option value="180">Dél</option><option value="225">Délnyugat</option>
                <option value="270">Nyugat</option><option value="315">Északnyugat</option>
              </select>
            </label>
          </div>

          {/*
            ÚTVONAL-KARAKTER — sétánál nincs értelme (döntés: 2026-08-29,
            docs/02-funkcionalis-spec.md → Küldetés-ajánló), ezért csak
            futásnál és bringánál jelenik meg.
          */}
          {type !== 'walk' ? (
            <div className="mission__field">
              <SegmentedControl
                options={[
                  { value: 'twisty', label: 'Kanyargós' },
                  { value: 'straight', label: 'Hosszú egyenesek' },
                ]}
                value={routeCharacter}
                onChange={setRouteCharacter}
                label="Útvonal jellege"
                block
              />
            </div>
          ) : null}
          </div> : null}
          </div>

          <Button block onClick={() => void generate()} loading={loading}>
            {result ? 'Újragenerálás' : 'Küldetéseket kérek'}
          </Button>
          <div className="mission__utilities">
            <Button variant="ghost" onClick={() => setSavedOpen(true)}>Mentett küldetések</Button>
            <Button variant="secondary" onClick={() => setAdvancedOpen((open) => !open)} aria-expanded={advancedOpen}>
              {advancedOpen ? 'Egyszerű keresés' : 'Részletes keresés'}
            </Button>
          </div>

          {error ? (
            <p className="field__error" role="alert">
              {error}
            </p>
          ) : null}

          {result?.quota && !result.quota.unlimited ? (
            <p className="mission__quota">
              Ezen a héten {result.quota.used}/{result.quota.limit} ingyenes generálás.
            </p>
          ) : null}
        </section>

        {result && fromToday && result.missions.length > 0 ? (
          <p className="mission__restored">A ma generált küldetéseid.</p>
        ) : null}

        {/*
          A KÖZTES ÁLLAPOT: útvonal már van, terület még nincs. A `plan` csak
          addig áll, amíg a kiértékelés fut — utána a `result` veszi át.
        */}
        {plan && !result ? <PendingResults plan={plan} /> : null}

        {result ? (
          <Results
            result={result}
            onStart={(mission) => {
              // A vonal a rögzítés térképén „szellemvonalként" jelenik meg —
              // a küldetés ígér egy útvonalat, ez viszi el oda a rajzot.
              rememberGhostRoute(mission);
              navigate('/rogzites');
            }}
          />
        ) : null}
      </div>
      {savedOpen ? (
        <SavedRoutesSheet
          onClose={() => setSavedOpen(false)}
          onSelect={(mission) => {
            rememberGhostRoute(mission);
            navigate('/rogzites');
          }}
        />
      ) : null}
    </>
  );
}

/**
 * Léptethető ÉS gépelhető mező.
 *
 * ⚠️ A BEÍRT SZÖVEG NYERSEN MEGY TOVÁBB, gépelés közben nem alakítjuk át.
 * Enélkül a részlegesen begépelt érték használhatatlan lenne: a „6:15"
 * útközben egyszer „6:", a „25" egyszer „2" — ha ilyenkor normalizálnánk, a
 * kurzor elugrana, vagy a mező visszaírná a régi értéket a felhasználó
 * gépelése alá. A −/+ gomb viszont mindig érvényes, normalizált értéket ír.
 * Az érvényesség ellenőrzése a beküldésnél történik (`resolvePace`,
 * `MIN_TARGET_KM`/`MAX_TARGET_KM`), ahol érthető magyar hibaüzenet jár hozzá.
 */
function Stepper({
  value,
  onChange,
  unit,
  ariaLabel,
  placeholder,
  inputMode = 'decimal',
  onStep,
}: {
  value: string;
  onChange: (value: string) => void;
  unit: string;
  ariaLabel: string;
  placeholder?: string;
  inputMode?: 'decimal' | 'text' | 'numeric';
  onStep: (direction: 1 | -1) => void;
}) {
  return (
    <div className="mission__stepper" role="group" aria-label={ariaLabel}>
      <button type="button" aria-label="Csökkentés" onClick={() => onStep(-1)}>−</button>
      {/*
        ⚠️ `label`, NEM `span`. A beviteli mező csak a beírt szöveg
        szélességét foglalja (hogy a szám és az egység egymás mellett,
        középen üljön), tehát a doboz nagy részére koppintva a kattintás a
        kereten landolna — a felhasználó szerint „nem lehet beleírni". A
        label a saját területén belül bárhol az inputra adja a fókuszt.
      */}
      <label className="mission__stepper-field">
        <input
          type="text"
          inputMode={inputMode}
          value={value}
          placeholder={placeholder ?? ''}
          aria-label={ariaLabel}
          /*
            ⚠️ A `size` A TARTALOMHOZ IGAZÍTJA A MEZŐT, és ez itt nem
            szépészeti kérdés. Egy `<input>` alapértelmezett szélessége ~20
            karakter, függetlenül attól, mi van benne — mérve 170 px. Emiatt
            a szám a széles mező szélére került, az egység pedig messze
            utána, holott a kettő együtt tartozik és középen a helyük.
            Így az input pontosan olyan széles, mint a benne álló szöveg, és
            a `justify-content: center` a számot az egységével EGYÜTT
            középre teszi.
          */
          size={Math.max(2, (value || placeholder || '').length)}
          onChange={(event) => onChange(event.target.value)}
        />
        <strong className="mission__stepper-unit">{unit}</strong>
      </label>
      <button type="button" aria-label="Növelés" onClick={() => onStep(1)}>+</button>
    </div>
  );
}

function PaceStepper({ type, value, onChange }: { type: ActivityType; value: string; onChange: (value: string) => void }) {
  const ride = type === 'ride';
  const current = ride
    ? Number(value.replace(',', '.')) || 22
    : resolvePace(type, value) ?? 360;
  const step = ride ? 1 : 15;
  const min = ride ? 3 : 120;
  const max = ride ? 60 : 3600;
  const set = (next: number) => {
    const clamped = Math.max(min, Math.min(max, next));
    onChange(ride ? String(clamped) : `${Math.floor(clamped / 60)}:${String(clamped % 60).padStart(2, '0')}`);
  };

  return (
    <Stepper
      value={value}
      onChange={onChange}
      unit={ride ? 'km/h' : 'perc/km'}
      ariaLabel={ride ? 'Tervezett átlagsebesség' : 'Tervezett átlagtempó'}
      // A mező OPCIONÁLIS: üresen hagyva a szerver a saját mért tempóddal
      // számol. A helyőrző ezért a tipikus értéket mutatja, nem parancsot.
      placeholder={ride ? '22' : '6:00'}
      inputMode={ride ? 'decimal' : 'text'}
      onStep={(direction) => set(current + direction * step)}
    />
  );
}

/**
 * A célhossz léptéke — annál durvább, minél hosszabb a kör.
 *
 * Geri kérése (2026-08-29): 10 km alatt 1, 10 fölött 5, 50 fölött 10. Egy
 * 120 km-es kört különben 240 koppintásból lehetne csak összerakni.
 *
 * ⚠️ A HATÁRON LEFELÉ A KISEBB LÉPTÉK ÉRVÉNYES. Enélkül a 10 km-ről lefelé
 * lépés 5-re esne (10 − 5), a felhasználó viszont 9-et vár; ugyanígy 50-ről
 * 40-re ugrana 45 helyett.
 */
function distanceStepKm(km: number, direction: 1 | -1): number {
  const reference = direction === -1 ? km - 0.001 : km;
  if (reference < 10) return 1;
  if (reference < 50) return 5;
  return 10;
}

function resolvePace(type: ActivityType, raw: string): number | null {
  const value = raw.trim().replace(',', '.');
  if (!value) return null;
  if (type === 'ride') {
    const kmh = Number(value.replace(/\s*km\/h$/i, ''));
    return Number.isFinite(kmh) && kmh >= 3 && kmh <= 60 ? 3600 / kmh : null;
  }
  const match = /^(\d{1,2})(?::([0-5]\d))?$/.exec(value.replace(/\s*(perc\/km)?$/i, ''));
  if (!match) return null;
  const seconds = Number(match[1]) * 60 + Number(match[2] ?? 0);
  return seconds >= 120 && seconds <= 3600 ? seconds : null;
}

function Results({
  result,
  onStart,
}: {
  result: MissionResult;
  onStart: (mission: Mission) => void;
}) {
  if (result.missions.length === 0) {
    return (
      <section className="card">
        <p className="mission__empty">{emptyMessage(result.reason)}</p>
      </section>
    );
  }

  return (
    <>
      <p className="mission__target">
        Célhossz: <strong>{formatDistance(result.targetKm * 1000)}</strong> — a saját tempódból
        számolva.
      </p>
      {result.missions.map((mission) => (
        <MissionCard key={mission.kind} mission={mission} onStart={() => onStart(mission)} />
      ))}
    </>
  );
}

/**
 * Az üres válasz OKA — háromféle, és mindegyikre MÁS a teendő.
 *
 * Korábban mindhárom ugyanazt az üzenetet kapta („nincs bezárható kör"),
 * ami félrevezető volt: ha az útvonaltervező adott is kört, csak rossz
 * méretűt, a felhasználó hiába indult el máshonnan.
 */
function emptyMessage(reason: string | undefined): string {
  switch (reason) {
    case 'no_routes':
      return 'Az útvonaltervező most nem adott vissza útvonalat erről a pontról. Próbáld újra, vagy indulj el egy közeli utcáról.';
    case 'no_loops':
      return 'Innen most nem jött ki bezárható kör — errefelé kevés az átkötő utca. Próbáld másik mozgásformával, vagy indulj el egy másik pontról.';
    case 'no_fit':
      return 'Találtunk köröket, de egyik sem fért bele ebbe az időkeretbe. Próbáld hosszabb idővel.';
    case 'no_clean_routes':
      return 'Találtunk köröket, de mindegyikben fölösleges visszafordulás volt. Próbáld újra, vagy válassz másik irányt.';
    default:
      return 'Most nincs ajánlható küldetés.';
  }
}

/**
 * A köztes állapot: az útvonalak megvannak, a tétjük még számolás alatt.
 *
 * ⚠️ NEM MUTAT BECSÜLT SZÁMOT. A „NEM BECSLÉS" szabály (AGENTS.md 2. döntés)
 * szerint a küldetés mindig a valódi motor eredményét írja ki — itt tehát a
 * mező nem közelít, hanem megmondja, hogy még dolgozunk rajta.
 *
 * A kártyák száma itt még nem végleges: a kiértékelés dönti el, melyik
 * útvonalból lesz ténylegesen küldetés (van-e bezárt terület, nem fedi-e egy
 * másikat). Ezért nincs se „Indítás", se „Mentés" gomb — az útvonal még nem
 * ajánlat, csak jelölt.
 */
function PendingResults({ plan }: { plan: MissionPlanResult }) {
  return (
    <>
      <p className="mission__target">
        Célhossz: <strong>{formatDistance(plan.targetKm * 1000)}</strong> — a saját tempódból
        számolva.
      </p>
      {plan.routes.map((route) => (
        <PendingMissionCard key={route.polyline} route={route} />
      ))}
    </>
  );
}

function PendingMissionCard({ route }: { route: PlannedRoute }) {
  const { theme } = useThemeContext();
  const [mapFailed, setMapFailed] = useState(false);
  const mapUrl = mapFailed ? null : routeImageUrl(route.polyline, { theme });

  return (
    <section className="card mission__card mission__card--pending" aria-busy="true">
      <header className="mission__head">
        <span className="mission__badge mission__badge--pending">
          <span className="mission__spinner" aria-hidden="true" />
          Számítás
        </span>
        <span className="mission__distance">{formatDistance(route.distanceKm * 1000)}</span>
      </header>

      <p className="mission__headline mission__headline--pending">
        Megvan az útvonal — most számoljuk ki, mennyi területet ér.
      </p>

      {mapUrl ? (
        <img
          className="mission__map"
          src={mapUrl}
          alt=""
          loading="lazy"
          onError={() => setMapFailed(true)}
        />
      ) : null}

      <dl className="mission__stats">
        <PendingStat label="Terület" text="Területszámítás" />
        <PendingStat label="Becsült GP" text="Pontszámítás" />
        <PendingStat label="Mező" text="Cellakalkuláció" />
      </dl>
    </section>
  );
}

/**
 * Egy még ki nem számolt statisztika.
 *
 * A felirat mozog (`mission__pending-text`), nem a doboz — így a három mező
 * együtt nem villog, és a kártya magassága sem ugrik meg, amikor a valódi
 * érték a helyére kerül.
 */
function PendingStat({ label, text }: { label: string; text: string }) {
  return (
    <div className="mission__stat">
      <dt className="mission__stat-label">{label}</dt>
      <dd className="mission__stat-value mission__stat-value--pending">
        <span className="mission__pending-text">{text}</span>
      </dd>
    </div>
  );
}

function MissionCard({ mission, onStart }: { mission: Mission; onStart: () => void }) {
  const { theme } = useThemeContext();
  const [mapFailed, setMapFailed] = useState(false);
  const [saved, setSaved] = useState(() => isRouteSaved(mission));
  const meta = MISSION_KIND_META[mission.kind];
  const mapUrl = mapFailed ? null : routeImageUrl(mission.polyline, { theme });

  return (
    <section className={`card mission__card mission__card--${meta.tone}`}>
      <header className="mission__head">
        <span className={`mission__badge mission__badge--${meta.tone}`}>{meta.label}</span>
        <span className="mission__distance">{formatDistance(mission.distanceKm * 1000)}</span>
      </header>

      <p className="mission__headline">{headlineOf(mission)}</p>

      {mapUrl ? (
        <img
          className="mission__map"
          src={mapUrl}
          alt=""
          loading="lazy"
          onError={() => setMapFailed(true)}
        />
      ) : null}

      <dl className="mission__stats">
        <MissionStat label={missionAreaStat(mission).label} value={missionAreaStat(mission).value} />
        <MissionStat label="Becsült GP" value={formatNumber(mission.estimatedGp)} />
        <MissionStat label="Mező" value={formatNumber(mission.cellCount)} />
      </dl>

      <div className="mission__actions">
        <Button variant="secondary" onClick={onStart}>
          Indítás most
        </Button>
        <Button
          variant="ghost"
          disabled={saved}
          onClick={() => {
            saveRoute(mission);
            setSaved(true);
          }}
        >
          {saved ? 'Mentve' : 'Mentés'}
        </Button>
      </div>
    </section>
  );
}

function MissionStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="mission__stat">
      <dt className="mission__stat-label">{label}</dt>
      <dd className="mission__stat-value">{value}</dd>
    </div>
  );
}

/**
 * A kártya egy mondata — karakterenként MÁS állítás.
 *
 * ⚠️ A CÉLPONT NEVE A SZERVERTŐL JÖN, és `null`, ha a fiókja privát vagy ma
 * már szerepelt célpontként. A felület ilyenkor nem talál ki nevet: „egy
 * helyi játékostól" a helyes szöveg. A küldetés nem lehet célzott zaklatási
 * eszköz (docs/02 → Adatvédelmi korlát).
 */
function headlineOf(mission: Mission): string {
  const area = formatArea(mission.areaM2);
  switch (mission.kind) {
    case 'conquest':
      return `Ezzel a körrel ${area} új területet szerezhetsz.`;
    case 'raid': {
      const stolen = formatArea(mission.victimAreaM2);
      return mission.victimName
        ? `Ha erre mész, elvehetsz ${stolen}-t ${mission.victimName} grundjából.`
        : `Ha erre mész, elvehetsz ${stolen}-t egy helyi játékostól.`;
    }
    case 'fortify':
      return `Ez a kör megerősíti a meglévő grundodat — ${formatNumber(
        mission.counts?.reclaimed ?? 0,
      )} mező védelme nő.`;
    case 'explore':
      return `${formatNumber(mission.newBlocks)} olyan körzet, ahol még egyetlen meződ sincs.`;
  }
}

function PencilIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z" />
      <path d="M14.5 7.5 16.5 9.5" />
    </svg>
  );
}

function readType(): ActivityType {
  try {
    const stored = localStorage.getItem(LAST_TYPE_KEY);
    if (stored === 'run' || stored === 'walk' || stored === 'ride') return stored;
  } catch {
    /* privát böngészés */
  }
  return 'run';
}
