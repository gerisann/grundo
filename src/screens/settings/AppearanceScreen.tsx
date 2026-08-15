import { useThemeContext } from '@/hooks/ThemeProvider';
import { List, ListRow, ScreenHeader, SegmentedControl, TextField } from '@/components/ui';
import type { AutoStrategy, ThemeMode } from '@/lib/theme';

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
