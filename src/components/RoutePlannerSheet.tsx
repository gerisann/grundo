import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/Icon';
import { OptionSwitch } from '@/components/ui/OptionSwitch';
import { api, type PlaceHit, type RoutePlanInput } from '@/lib/api';
import type { ActivityType } from '@/types';
import './routePlannerSheet.css';

/**
 * Útvonaltervező — teljes képernyős beállító lap.
 *
 * ⚠️ A MOZGÁSFORMA NEM ITT DŐL EL. A rögzítés képernyőn választod ki (Futás /
 * Séta / Bringa), és csak utána jössz ide — ezért nincs itt mozgásforma-váltó,
 * viszont a mozgásformától FÜGG, mit mutatunk: a kerékpárút-preferencia csak
 * bringánál értelmes, a Jelleg pedig gyalog egyáltalán nem hat (lásd lent).
 */

export interface PlannerPoint {
  lat: number;
  lng: number;
  /** A találat címkéje, ha kereséssel jött. NEM tároljuk el sehova. */
  label?: string;
}

export interface PlannerSettings {
  mode: 'loop' | 'direct';
  detour: 'small' | 'medium' | 'large';
  preference: 'fast' | 'protected' | 'quiet';
  terrain: 'flat' | 'balanced' | 'hilly';
  preferCycleways: boolean;
}

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  mode: 'loop',
  detour: 'medium',
  preference: 'fast',
  terrain: 'balanced',
  preferCycleways: false,
};

export function RoutePlannerSheet({
  activityType,
  near,
  from,
  to,
  stops,
  settings,
  busy,
  error,
  onChangePoint,
  onAddStop,
  onRemoveStop,
  onUseCurrentPosition,
  onPickOnMap,
  onChangeSettings,
  onPlan,
  onClose,
}: {
  activityType: ActivityType;
  /** A keresés KÖZELSÉGE — enélkül a találatok távolsága értelmetlen. */
  near?: { lat: number; lng: number } | null;
  from: PlannerPoint | null;
  to: PlannerPoint | null;
  stops: (PlannerPoint | null)[];
  settings: PlannerSettings;
  busy: boolean;
  error: string | null;
  onChangePoint: (role: 'from' | 'to' | number, point: PlannerPoint) => void;
  onAddStop: () => void;
  onRemoveStop: (index: number) => void;
  onUseCurrentPosition: () => void;
  onPickOnMap: (role: 'from' | 'to' | number) => void;
  onChangeSettings: (next: PlannerSettings) => void;
  onPlan: () => void;
  onClose: () => void;
}) {
  const isBike = activityType === 'ride';
  /* Kijelöletlen megállóval nem tervezünk — lásd `addStop` a hookban. */
  const canPlan = Boolean(from && to) && stops.every(Boolean) && !busy;

  function set<K extends keyof PlannerSettings>(key: K, value: PlannerSettings[K]) {
    onChangeSettings({ ...settings, [key]: value });
  }

  /*
    ⚠️ PORTÁLBAN, A `body`-BAN — ez nem stílus, hanem hibajavítás. A rögzítés
    képernyő saját rétegsorrendet nyit, azon belül a `z-index: 60` NEM emeli a
    lapot a dokk (`z-index: 40`) fölé, mert a dokk egy másik ágon, az `App`
    szintjén él. Mérve: a lap gombja fölött a `dock__play` fogta a koppintást.
    Ugyanaz a megoldás, mint a `TerritoryToast`-nál.
  */
  return createPortal(
    <div className="rps" role="dialog" aria-modal="true" aria-labelledby="rps-title">
      <header className="rps__head">
        <h2 id="rps-title">Útvonal tervezése</h2>
        <button type="button" className="rps__close" aria-label="Bezárás" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="rps__body">
        <section className="rps__section">
          <h3>Pontok</h3>

          <PointRow
            title="Rajt"
            point={from}
            onPick={(point) => onChangePoint('from', point)}
            onPickOnMap={() => onPickOnMap('from')}
            onUseCurrent={onUseCurrentPosition}
            near={near}
          />

          {stops.map((stop, index) => (
            <PointRow
              key={index}
              title={`Megálló ${index + 1}`}
              point={stop}
              onPick={(point) => onChangePoint(index, point)}
              onPickOnMap={() => onPickOnMap(index)}
              onRemove={() => onRemoveStop(index)}
              near={near}
            />
          ))}

          <PointRow
            title="Cél"
            point={to}
            onPick={(point) => onChangePoint('to', point)}
            onPickOnMap={() => onPickOnMap('to')}
            near={near}
          />

          {/* A szerver plafonja öt megálló — a felület se engedjen többet. */}
          {stops.length < 5 ? (
            <button type="button" className="rps__ghost rps__add" onClick={onAddStop}>
              + Megálló hozzáadása
            </button>
          ) : null}
        </section>

        <section className="rps__section">
          <h3>Tervezés</h3>

          <Field label="Útvonaltípus">
            <OptionSwitch
              label="Útvonaltípus"
              value={settings.mode}
              onChange={(value) => set('mode', value)}
              options={[
                { value: 'loop', label: 'Oda-vissza' },
                { value: 'direct', label: 'Csak oda' },
              ]}
            />
            {/*
              ⚠️ A JÁTÉKSZABÁLY KIMONDVA, INDULÁS ELŐTT. A „Csak oda" nem zár
              kört, tehát nem ad területet — csak a távért járó pontot. Ha ezt
              csak a végén tudná meg a felhasználó, csalódás lenne.
            */}
            {settings.mode === 'direct' ? (
              <p className="rps__hint">Nem zár kört, ezért területet nem ad — csak a távért járó pontot.</p>
            ) : null}
          </Field>

          {settings.mode === 'loop' ? (
            <Field label="Kerülő mérete">
              <OptionSwitch
                label="Kerülő mérete"
                value={settings.detour}
                onChange={(value) => set('detour', value)}
                options={[
                  { value: 'small', label: 'Kis' },
                  { value: 'medium', label: 'Közepes' },
                  { value: 'large', label: 'Nagy' },
                ]}
              />
              <p className="rps__hint">A kerülő mérete a bezárt terület mérete.</p>
            </Field>
          ) : null}

          {/*
            ⚠️ GYALOG A JELLEG NEM HAT — mérve (2026-09-12, 5 budapesti pár):
            mindhárom állás gyakorlatilag azonos útvonalat adott, mert a
            gyalogos profil eleve járdán és gyalogúton megy (92–99% nyugodt út
            már alapból). Nem mutatunk működőnek valamit, ami nem az; a
            gyalogos „Jelleg" más adatforrást igényel (zajtérkép,
            zöldfelület-index) — lásd `docs/routing/data-sources.md`.
          */}
          <Field label="Jelleg" disabled={!isBike} disabledNote="Hamarosan">
            <OptionSwitch
              label="Jelleg"
              value={settings.preference}
              onChange={(value) => set('preference', value)}
              options={[
                { value: 'fast', label: 'Gyors' },
                { value: 'protected', label: 'Védett út' },
                { value: 'quiet', label: 'Nyugalom' },
              ]}
            />
          </Field>

          <Field label="Terep">
            <OptionSwitch
              label="Terep"
              value={settings.terrain}
              onChange={(value) => set('terrain', value)}
              options={[
                { value: 'flat', label: 'Sík' },
                { value: 'balanced', label: 'Vegyes' },
                { value: 'hilly', label: 'Dombos' },
              ]}
            />
          </Field>

          {/* Csak bringánál — gyalog értelmetlen, a szerver sem hiszi el. */}
          {isBike ? (
            <Field label="Kerékpárutak előnyben">
              <OptionSwitch
                label="Kerékpárutak előnyben"
                value={settings.preferCycleways ? 'on' : 'off'}
                onChange={(value) => set('preferCycleways', value === 'on')}
                options={[
                  { value: 'off', label: 'Ki' },
                  { value: 'on', label: 'Be' },
                ]}
              />
            </Field>
          ) : null}
        </section>

        {error ? <p className="rps__error">{error}</p> : null}
      </div>

      <footer className="rps__foot">
        <button type="button" className="rps__plan" disabled={!canPlan} onClick={onPlan}>
          {busy ? 'Tervezés…' : 'Útvonal tervezése'}
        </button>
        {busy ? (
          /*
            ⚠️ A TERVEZÉS MÉRVE 3,6–7 MÁSODPERC, mert valódi útvonalakat
            számol. Türelemkérés nélkül a felhasználó azt hinné, elakadt.
          */
          <p className="rps__hint rps__hint--center">Ez néhány másodpercig tart.</p>
        ) : null}
      </footer>
    </div>,
    document.body,
  );
}

/** Egy beállítás-blokk, elhagyható letiltással („Hamarosan"). */
function Field({
  label,
  children,
  disabled,
  disabledNote,
}: {
  label: string;
  children: React.ReactNode;
  disabled?: boolean;
  disabledNote?: string;
}) {
  return (
    <div className={`rps__field${disabled ? ' rps__field--off' : ''}`}>
      <span className="rps__label">
        {label}
        {disabled && disabledNote ? <em className="rps__soon">{disabledNote}</em> : null}
      </span>
      {/* `inert` helyett: a régebbi WebView-k még nem ismerik. */}
      <div aria-disabled={disabled} className="rps__control">
        {children}
      </div>
    </div>
  );
}

/**
 * Egy pont megadása: keresés, térképi kijelölés, vagy a jelenlegi pozíció.
 *
 * ⚠️ A TALÁLAT CÍMÉT NEM TÁROLJUK EL — a keresés eredménye a térképre kerül,
 * és a folyamat végén eltűnik (lásd `server/src/lib/geocode.ts`).
 */
function PointRow({
  title,
  point,
  onPick,
  onPickOnMap,
  onRemove,
  onUseCurrent,
  near,
}: {
  title: string;
  point: PlannerPoint | null;
  /** A keresés közelsége — a találatok EHHEZ képest vannak rendezve. */
  near?: { lat: number; lng: number } | null;
  onPick: (point: PlannerPoint) => void;
  onPickOnMap: () => void;
  onRemove?: () => void;
  /** Csak a rajtnál van értelme — ott jelenik meg a célkereszt gomb. */
  onUseCurrent?: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PlaceHit[]>([]);
  const [searching, setSearching] = useState(false);
  const token = useRef(0);

  /*
    Késleltetett keresés: gépelés közben minden leütésre kérni fizetős lenne
    (a geocoding külön számlázódik), és a találatlista is ugrálna.
  */
  useEffect(() => {
    if (query.trim().length < 3) {
      setHits([]);
      return;
    }
    const current = ++token.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void api
        .routesGeocode(query, near ?? undefined)
        .then((result) => {
          if (current === token.current) setHits(result.results);
        })
        .catch(() => {
          if (current === token.current) setHits([]);
        })
        .finally(() => {
          if (current === token.current) setSearching(false);
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [query, near]);

  return (
    <div className="rps__point">
      {/*
        EGY SOR A FEJLÉC: balra a szerep, jobbra a kiválasztott hely. Így egy
        pillantással végigfut a szemed a rajt–megálló–cél láncon, és nem kell
        háromszor annyit görgetni.
      */}
      <div className="rps__point-head">
        <span className="rps__point-title">{title}</span>
        <span
          className={point ? 'rps__point-value' : 'rps__point-value rps__point-value--empty'}
        >
          {point ? (point.label ?? `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`) : 'Nincs kijelölve'}
        </span>
        {onRemove ? (
          <button
            type="button"
            className="rps__point-remove"
            aria-label={`${title} törlése`}
            onClick={onRemove}
          >
            ✕
          </button>
        ) : null}
      </div>

      {/* A kereső és a két gomb EGY sorban — a gombok csak ikonok. */}
      <div className="rps__point-row">
        <input
          type="search"
          className="rps__search"
          placeholder="Keress címre…"
          aria-label={`${title} keresése cím alapján`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          type="button"
          className="rps__icon-btn"
          aria-label={`${title} kijelölése a térképen`}
          title="Kijelölés a térképen"
          onClick={onPickOnMap}
        >
          <Icon name="pin" size={20} />
        </button>
        {onUseCurrent ? (
          <button
            type="button"
            className="rps__icon-btn"
            aria-label="Jelenlegi pozícióm használata"
            title="Jelenlegi pozícióm"
            onClick={onUseCurrent}
          >
            <Icon name="locate" size={20} />
          </button>
        ) : null}
      </div>

      {searching && hits.length === 0 ? <p className="rps__hint">Keresés…</p> : null}

      {hits.length > 0 ? (
        <ul className="rps__hits">
          {hits.map((hit) => (
            <li key={`${hit.lat},${hit.lng}`}>
              <button
                type="button"
                onClick={() => {
                  onPick({ lat: hit.lat, lng: hit.lng, label: hit.label });
                  setQuery('');
                  setHits([]);
                }}
              >
                <span className="rps__hit-label">{hit.label}</span>
                <span className="rps__hit-distance">{(hit.distanceM / 1000).toFixed(1)} km</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** A tervezési kérés összeállítása — egy helyen, hogy a hívó ne másolja. */
export function toPlanInput(
  from: PlannerPoint,
  to: PlannerPoint,
  stops: (PlannerPoint | null)[],
  settings: PlannerSettings,
  activityType: ActivityType,
): RoutePlanInput {
  return {
    from: { lat: from.lat, lng: from.lng },
    to: { lat: to.lat, lng: to.lng },
    /* A kijelöletlen megállók kimaradnak — a gomb amúgy is tiltva ilyenkor. */
    stops: stops.flatMap((stop) => (stop ? [{ lat: stop.lat, lng: stop.lng }] : [])),
    profile: activityType === 'ride' ? 'cycling' : 'walking',
    mode: settings.mode,
    detour: settings.detour,
    /* Gyalog a Jelleg nem hat — ne küldjünk olyat, ami félrevezető lenne. */
    preference: activityType === 'ride' ? settings.preference : 'fast',
    terrain: settings.terrain,
    preferCycleways: activityType === 'ride' && settings.preferCycleways,
  };
}
