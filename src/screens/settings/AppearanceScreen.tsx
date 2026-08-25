import { useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { useThemeContext } from '@/hooks/ThemeProvider';
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
import { List, ListRow, ScreenHeader, SegmentedControl, TextField } from '@/components/ui';
import type { AutoStrategy, ThemeMode } from '@/lib/theme';
import './cellColor.css';

/**
 * Beállítások → Megjelenés
 *
 * docs/02-funkcionalis-spec.md → Beállítások → Megjelenés
 *
 * Négy mód. A kifejezett választás (Világos / Sötét) mindig felülírja az
 * automatikát; a telefon beállítását csak a „Rendszer szerint" követi.
 */

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

/**
 * A TERÜLETED SZÍNE a térképen.
 *
 * Mindenki a saját színében látszik — a tiéd tehát nem csak neked, hanem
 * minden játékosnak ilyen. Ezért nem a helyi témabeállítások közé tartozik,
 * hanem a profilodra mentjük.
 *
 * ⚠️ A PRÉMIUM SZÍNEK ZÁRJÁT NEM EZ A KOMPONENS ŐRZI. Itt csak elhalványítjuk
 * és lakattal jelöljük őket; a tényleges kikényszerítés a `firestore.rules`
 * `cellColorAllowed()` függvényében van, mert a Firestore-t a felület
 * megkerülésével is lehet hívni.
 */
function CellColorSection() {
  const { user } = useAuth();
  const { profile, reload } = useProfile();
  const isPro = profile?.pro.active === true;

  /**
   * Optimista helyi állapot: a mentés hálózati kör, a visszajelzésnek viszont
   * azonnalinak kell lennie. A profil újratöltése utólag igazolja vissza.
   */
  const stored = isCellColor(profile?.cellColor) ? profile.cellColor : DEFAULT_CELL_COLOR;
  const [selected, setSelected] = useState<CellColor | null>(null);
  const [error, setError] = useState('');
  const active = selected ?? stored;

  async function choose(color: CellColor, locked: boolean) {
    if (locked || !user || !db || color === active) return;
    setSelected(color);
    setError('');
    try {
      await setDoc(
        doc(db, 'users', user.uid),
        { cellColor: color, updatedAt: new Date() },
        { merge: true },
      );
      await reload();
    } catch {
      // Visszaáll a tárolt értékre — ne mutassunk olyan színt, ami nem ment el.
      setSelected(null);
      setError('Nem sikerült elmenteni a színt. Próbáld meg újra.');
    }
  }

  function swatch(color: CellColor, locked: boolean) {
    const { hex, label } = CELL_COLORS[color];
    const on = color === active;
    return (
      <button
        key={color}
        type="button"
        className={`ccolor__swatch${on ? ' ccolor__swatch--on' : ''}${locked ? ' ccolor__swatch--locked' : ''}`}
        aria-pressed={on}
        aria-label={locked ? `${label} — Pro-előfizetéssel` : label}
        title={locked ? `${label} — Pro-előfizetéssel` : label}
        disabled={locked}
        onClick={() => void choose(color, locked)}
      >
        <span className="ccolor__fill" style={{ background: hex }} />
        {locked ? <span className="ccolor__lock" aria-hidden="true">🔒</span> : null}
        {on ? <span className="ccolor__check" aria-hidden="true">✓</span> : null}
      </button>
    );
  }

  return (
    <>
      <section className="stack stack--tight">
        <div className="label">A területed színe</div>
        <div className="ccolor__grid">
          {FREE_CELL_COLOR_KEYS.map((color) => swatch(color, false))}
        </div>
        <p className="field__hint">
          Ebben a színben látszik a területed a térképen — neked és mindenki másnak is. A saját
          területedet ezen felül vastagabb körvonal jelöli.
        </p>
        {error ? <p className="field__error">{error}</p> : null}
      </section>

      <section className="stack stack--tight">
        <div className="ccolor__pro-head">
          <div className="label">Prémium színek</div>
          <span className="ccolor__badge">PRO</span>
        </div>
        <div className="ccolor__grid">
          {PRO_CELL_COLOR_KEYS.map((color) => swatch(color, !isPro))}
        </div>
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
