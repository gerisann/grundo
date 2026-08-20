import { useEffect, useState } from 'react';
import { ScreenHeader, List, ListRow } from '@/components/ui';
import { api, type ModifierKindName, type ModifierScopeName, type PublicTunableItem, type RulesState } from '@/lib/api';
import './rules.css';

/**
 * Szabálymagyarázó — a JÁTÉKOSNAK.
 *
 * A tartalom a `/api/rules` végpontról jön, ami ugyanabból a `TUNABLES`
 * sémából dolgozik, mint az admin szerkesztő (docs/06 → 7. Játékkonfiguráció).
 * Ha egy admin átállít egy szorzót, ez a képernyő a következő betöltéskor már
 * a friss értéket mutatja — nincs itt semmi kézzel írt szám, ami elavulhatna.
 *
 * A Trust Score-hoz tartozó kulcsok a válaszban EGYÁLTALÁN nem szerepelnek
 * (6. alapszabály) — ezt a szerver zárja ki, nem ez a képernyő.
 */

const MODIFIER_KIND_LABEL: Record<ModifierKindName, string> = {
  gp_multiplier: 'GP-szorzó',
  claim_multiplier: 'Igénypont-szorzó',
  hold_multiplier: 'Tartás-bónusz szorzó',
};

const MODIFIER_SCOPE_LABEL: Record<ModifierScopeName, string> = {
  global: 'Az egész térképen',
  area: 'Egy kijelölt területen',
  segment: 'Visszatérőknek',
};

function formatValue(item: PublicTunableItem): string {
  if (item.kind === 'boolean') return item.value ? 'Be' : 'Ki';
  const formatted = Number(item.value).toLocaleString('hu-HU', { maximumFractionDigits: 3 });
  return item.unit ? `${formatted} ${item.unit}` : formatted;
}

export function RulesScreen() {
  const [state, setState] = useState<RulesState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .rules()
      .then(setState)
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Nem sikerült betölteni a szabályokat.'),
      );
  }, []);

  return (
    <>
      <ScreenHeader title="Játékszabályok" backTo="/beallitasok" />
      <div className="screen-body stack rules-screen">
        <p className="rules-screen__intro">
          Ezek a jelenleg érvényes számok — ha valamit hangolunk, itt azonnal a friss érték
          látszik.
        </p>

        {error ? <p className="field__error" role="alert">{error}</p> : null}
        {!state && !error ? <p className="rules-screen__loading">Betöltés…</p> : null}

        {state && state.activeModifiers.length > 0 ? (
          <section>
            <div className="label list__group-label">Aktív akciók</div>
            <div className="stack stack--tight">
              {state.activeModifiers.map((modifier) => (
                <div key={modifier.id} className="rules-modifier card">
                  <div className="rules-modifier__head">
                    <span className="rules-modifier__reason">
                      {modifier.reason || MODIFIER_KIND_LABEL[modifier.kind]}
                    </span>
                    <span className="chip chip--accent">{modifier.value}×</span>
                  </div>
                  <p className="rules-modifier__detail">
                    {MODIFIER_KIND_LABEL[modifier.kind]} · {MODIFIER_SCOPE_LABEL[modifier.scope]}
                  </p>
                  <p className="rules-modifier__until">
                    Eddig érvényes: {new Date(modifier.to).toLocaleString('hu-HU')}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {state?.groups.map((group) => (
          <section key={group.group}>
            <div className="label list__group-label">{group.group}</div>
            <List>
              {group.items.map((item) => (
                <ListRow
                  key={item.path}
                  label={item.label}
                  description={item.help}
                  value={
                    <span className="rules-screen__value">
                      {formatValue(item)}
                      {item.overridden ? <span className="chip chip--accent rules-screen__badge">módosítva</span> : null}
                    </span>
                  }
                />
              ))}
            </List>
          </section>
        ))}
      </div>
    </>
  );
}
