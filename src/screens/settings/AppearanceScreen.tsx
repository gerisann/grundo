import { useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { useFeedbackSettings } from '@/hooks/useFeedbackSettings';
import { updateFeedbackSettings } from '@/lib/feedbackSettings';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { CellColorCarousel } from '@/components/CellColorCarousel';
import { db } from '@/lib/firebase';
import {
  DEFAULT_CELL_COLOR,
  FREE_CELL_COLOR_KEYS,
  PRO_CELL_COLOR_KEYS,
  isCellColor,
  isProCellColor,
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

const ALL_CELL_COLOR_KEYS: readonly CellColor[] = [
  ...FREE_CELL_COLOR_KEYS,
  ...PRO_CELL_COLOR_KEYS,
];

function CellColorSection() {
  const { user } = useAuth();
  const { profile, patchProfile } = useProfile();
  const isPro = profile?.pro.active === true;
  const stored = isCellColor(profile?.cellColor) ? profile.cellColor : DEFAULT_CELL_COLOR;
  const [selected, setSelected] = useState<CellColor | null>(null);
  const [error, setError] = useState('');
  const saveRevision = useRef(0);
  const appliedRevision = useRef(0);
  const active = selected ?? stored;

  async function choose(color: CellColor) {
    if (!user || !db || color === active) return;
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

  return (
    <section className="stack stack--tight">
      <div className="ccolor__section-head">
        <div className="label">A területed színe</div>
        {!isPro ? <span className="ccolor__badge">PRO színek zárolva</span> : null}
      </div>

      <CellColorCarousel
        colors={ALL_CELL_COLOR_KEYS}
        active={active}
        isLocked={(color) => !isPro && isProCellColor(color)}
        onChoose={(color) => void choose(color)}
      />

      <p className="field__hint">
        Húzd oldalra a sort, vagy használd a nyilakat. A Pro-színek előfizetéssel választhatók.
      </p>
      {error ? <p className="field__error">{error}</p> : null}
    </section>
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
