import { useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { useFeedbackSettings } from '@/hooks/useFeedbackSettings';
import { updateFeedbackSettings } from '@/lib/feedbackSettings';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { db } from '@/lib/firebase';
import {
  CELL_COLORS,
  DEFAULT_CELL_COLOR,
  FREE_CELL_COLOR_KEYS,
  PRO_CELL_COLOR_KEYS,
  isCellColor,
  type CellColor,
} from '@/lib/cellColors';
import { List, ListRow, ScreenHeader, SegmentedControl, Switch, TextField } from '@/components/ui';
import type { AutoStrategy, ThemeMode } from '@/lib/theme';
import './cellColor.css';

const MODES: readonly { value: ThemeMode; label: string }[] = [
  { value: 'auto', label: 'Automatikus' },
  { value: 'light', label: 'Világos' },
  { value: 'dark', label: 'Sötét' },
  { value: 'system', label: 'Rendszer' },
];

const STRATEGIES: readonly { value: AutoStrategy; label: string }[] = [
  { value: 'sun', label: 'Napnyugta szerint' },
  { value: 'fixed', label: 'Fix időpontok' },
];

const MODE_HINT: Record<ThemeMode, string> = {
  auto: 'Nappal világos, este sötét.',
  light: 'Mindig világos, a napszaktól és a telefon beállításától függetlenül.',
  dark: 'Mindig sötét, a napszaktól és a telefon beállításától függetlenül.',
  system: 'A telefonod rendszerbeállítását követi.',
};

const FREE_ROWS = [4, 4, 4, 4] as const;
const PRO_ROWS = [4, 4, 4] as const;

function rows<T>(values: readonly T[], sizes: readonly number[]): T[][] {
  const result: T[][] = [];
  let offset = 0;
  for (const size of sizes) {
    result.push(values.slice(offset, offset + size));
    offset += size;
  }
  return result;
}

function CellColorSection() {
  const { user } = useAuth();
  const { profile, patchProfile } = useProfile();
  const isPro = profile?.pro.active === true;
  const stored = isCellColor(profile?.cellColor) ? profile.cellColor : DEFAULT_CELL_COLOR;
  const [selected, setSelected] = useState<CellColor | null>(null);
  const [freePreview, setFreePreview] = useState<CellColor | null>(null);
  const [proPreview, setProPreview] = useState<CellColor | null>(null);
  const [error, setError] = useState('');
  const saveRevision = useRef(0);
  const appliedRevision = useRef(0);
  const active = selected ?? stored;

  async function choose(color: CellColor, locked: boolean) {
    if (locked || !user || !db || color === active) return;
    const revision = ++saveRevision.current;
    setSelected(color);
    setError('');
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { cellColor: color, updatedAt: new Date() },
        { merge: true },
      );
      if (revision >= appliedRevision.current) {
        appliedRevision.current = revision;
        patchProfile({ cellColor: color });
      }
      if (revision === saveRevision.current) setSelected(null);
    } catch {
      if (revision !== saveRevision.current) return;
      setSelected(null);
      setError('Nem sikerült elmenteni a színt. Próbáld meg újra.');
    }
  }

  function swatch(
    color: CellColor,
    locked: boolean,
    setPreview: (color: CellColor | null) => void,
  ) {
    const { hex, label } = CELL_COLORS[color];
    const on = color === active;
    const endPreview = () => setPreview(null);
    const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
      if (event.pointerType !== 'mouse') setPreview(color);
    };

    return (
      <button
        key={color}
        type="button"
        className={`ccolor__swatch${on ? ' ccolor__swatch--on' : ''}${locked ? ' ccolor__swatch--locked' : ''}`}
        aria-pressed={on}
        aria-disabled={locked}
        aria-label={locked ? `${label} — Pro-előfizetéssel` : label}
        title={locked ? `${label} — Pro-előfizetéssel` : label}
        style={{ '--ccolor': hex } as CSSProperties}
        onMouseEnter={() => setPreview(color)}
        onMouseLeave={endPreview}
        onPointerDown={pointerDown}
        onPointerUp={endPreview}
        onPointerCancel={endPreview}
        onPointerLeave={endPreview}
        onContextMenu={(event) => event.preventDefault()}
        onClick={() => void choose(color, locked)}
      >
        <span className="ccolor__fill" />
        {locked ? <span className="ccolor__lock" aria-hidden="true">🔒</span> : null}
        {on ? <span className="ccolor__check" aria-hidden="true">✓</span> : null}
      </button>
    );
  }

  function honeycomb(
    colors: readonly CellColor[],
    shape: readonly number[],
    preview: CellColor | null,
    setPreview: (color: CellColor | null) => void,
    locked: boolean,
  ) {
    const style = preview
      ? ({ '--ccolor-preview': CELL_COLORS[preview].hex } as CSSProperties)
      : undefined;
    return (
      <div
        className={`ccolor__hive${preview ? ' ccolor__hive--preview' : ''}`}
        style={style}
        onMouseLeave={() => setPreview(null)}
      >
        {rows(colors, shape).map((row, rowIndex) => (
          <div className="ccolor__row" key={rowIndex}>
            {row.map((color) => swatch(color, locked, setPreview))}
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
      <section className="stack stack--tight">
        <div className="label">A területed színe</div>
        {honeycomb(FREE_CELL_COLOR_KEYS, FREE_ROWS, freePreview, setFreePreview, false)}
        <p className="field__hint">
          Ebben a színben látszik a területed a térképen — neked és mindenki másnak is.
        </p>
        {error ? <p className="field__error">{error}</p> : null}
      </section>

      <section className="stack stack--tight">
        <div className="ccolor__pro-head">
          <div className="label">Prémium színek</div>
          <span className="ccolor__badge">PRO</span>
        </div>
        {honeycomb(PRO_CELL_COLOR_KEYS, PRO_ROWS, proPreview, setProPreview, !isPro)}
        <p className="field__hint">
          {isPro
            ? 'A Pro-előfizetéseddel ezek is a tieid.'
            : 'Ezek a színek Pro-előfizetéssel választhatók.'}
        </p>
      </section>
    </>
  );
}

export function AppearanceScreen() {
  const { theme, settings, update } = useThemeContext();
  const feedback = useFeedbackSettings();

  return (
    <>
      <ScreenHeader title="Megjelenés" backTo="/beallitasok" />

      <div className="screen-body stack">
        <section className="stack stack--tight">
          <div className="label">Téma</div>
          <SegmentedControl
            label="Téma"
            options={MODES}
            value={settings.mode}
            onChange={(mode) => update({ mode })}
            block
          />
          <p className="field__hint">{MODE_HINT[settings.mode]}</p>
        </section>

        {settings.mode === 'auto' ? (
          <section className="stack stack--tight">
            <div className="label">Automatikus váltás</div>
            <SegmentedControl
              label="Automatikus váltás módja"
              options={STRATEGIES}
              value={settings.autoStrategy}
              onChange={(autoStrategy) => update({ autoStrategy })}
              block
            />

            {settings.autoStrategy === 'sun' ? (
              <p className="field__hint">
                A valódi napkeltét és napnyugtát követi a helyzeted alapján, ezért nyáron később
                vált sötétre, mint télen. Ha nincs helyadat, a fix időpontok lépnek életbe.
              </p>
            ) : (
              <>
                <div className="stack stack--tight" style={{ marginTop: 'var(--sp-2)' }}>
                  <TextField
                    label="Sötét ettől"
                    type="time"
                    value={settings.darkFrom}
                    onChange={(event) => update({ darkFrom: event.target.value })}
                  />
                  <TextField
                    label="Sötét eddig"
                    type="time"
                    value={settings.darkTo}
                    onChange={(event) => update({ darkTo: event.target.value })}
                  />
                </div>
                <p className="field__hint">Az időszak átnyúlhat éjfélen.</p>
              </>
            )}
          </section>
        ) : null}

        <CellColorSection />

        {/*
          A TERÜLETSZERZÉS VISSZAJELZÉSE — Geri kérése (2026-09-01): a
          „Grund megszerezve!" üzenet és a mögötte futó konfetti egyetlen
          kapcsolón lógjon, és itt, a Megjelenés alatt legyen. A hangok
          KÜLÖN oldalon állíthatók (Beállítások → Hangok), mert az más
          érzékszerv és más helyzetben zavaró.
        */}
        <section className="stack stack--tight">
          <div className="label">Rögzítés közben</div>
          <List>
            <Switch
              label="Területszerzés-üzenet"
              description="Felugró visszajelzés és konfetti, amikor bezársz egy kört."
              checked={feedback.territoryPopup}
              onChange={(territoryPopup) => updateFeedbackSettings({ territoryPopup })}
            />
          </List>
          <p className="field__hint">
            Öt másodpercig látszik, és bármikor bezárható. A hozzá tartozó hangokat a
            Beállítások → Hangok oldalon kapcsolhatod.
          </p>
        </section>

        <section className="stack stack--tight">
          <div className="label">Jelenleg</div>
          <List>
            <ListRow label="Aktív téma" value={theme === 'dark' ? 'Sötét' : 'Világos'} />
          </List>
          <p className="field__hint">
            Rögzítés közben nem váltunk témát — ha futás közben megy le a nap, a váltás a mentés
            után történik meg.
          </p>
        </section>
      </div>
    </>
  );
}
