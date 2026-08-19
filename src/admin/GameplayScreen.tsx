import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, type GameplayState, type GameplayVersion, type TunableItem } from '@/lib/api';
import { Button, Switch, TextField } from '@/components/ui';

/**
 * Játékkonfiguráció-szerkesztő.
 *
 * A séma a SZERVERTŐL jön, nem a kliensbe fordítva: egy új hangolható kulcs a
 * backend telepítésével azonnal megjelenik itt, és nem lehet olyan állapot,
 * ahol a felület mást kínál, mint amit a szerver elfogad.
 *
 * A mentés a TELJES felülírás-halmazt küldi, nem különbséget — amit
 * alapértékre állítasz vissza, az kikerül. Így a képernyő és a tárolt állapot
 * nem tud szétcsúszni.
 *
 * docs/06-architektura-es-admin.md → 7. Játékkonfiguráció
 */

type Draft = Record<string, number | boolean>;

export function GameplayScreen() {
  const [state, setState] = useState<GameplayState | null>(null);
  const [draft, setDraft] = useState<Draft>({});
  const [note, setNote] = useState('');
  const [versions, setVersions] = useState<GameplayVersion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await api.adminGameplay();
    setState(next);
    setDraft({ ...next.overrides });
  }, []);

  useEffect(() => {
    load().catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Nem sikerült betölteni.'),
    );
  }, [load]);

  const dirty = useMemo(() => {
    if (!state) return false;
    const before = state.overrides;
    const keys = new Set([...Object.keys(before), ...Object.keys(draft)]);
    for (const key of keys) if (before[key] !== draft[key]) return true;
    return false;
  }, [state, draft]);

  function setValue(path: string, value: number | boolean | undefined) {
    setSaved(null);
    setDraft((previous) => {
      const next = { ...previous };
      if (value === undefined) delete next[path];
      else next[path] = value;
      return next;
    });
  }

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const next = await api.adminSaveGameplay(draft, note);
      setState(next);
      setDraft({ ...next.overrides });
      setNote('');
      setVersions(null);
      setSaved(`Mentve — ${next.version}. verzió.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'A mentés nem sikerült.');
    } finally {
      setBusy(false);
    }
  }

  async function rollback(version: number) {
    setBusy(true);
    setError(null);
    try {
      const next = await api.adminRollbackGameplay(version);
      setState(next);
      setDraft({ ...next.overrides });
      setVersions(null);
      setSaved(`Visszaállítva a(z) ${version}. verzióra — új verzió: ${next.version}.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'A visszaállítás nem sikerült.');
    } finally {
      setBusy(false);
    }
  }

  if (error && !state) return <p className="admin-error">{error}</p>;
  if (!state) return <p className="admin-muted">Betöltés…</p>;

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Játékszabályok</h1>
          <p className="admin-muted">
            {state.version === 0
              ? 'Még nincs mentett módosítás — minden érték az alapértéken áll.'
              : `${state.version}. verzió${state.updatedAt ? ` · ${new Date(state.updatedAt).toLocaleString('hu-HU')}` : ''}`}
          </p>
        </div>
        <Button
          variant="ghost"
          onClick={() => {
            if (versions) return setVersions(null);
            void api
              .adminGameplayVersions()
              .then((result) => setVersions(result.versions))
              .catch((cause: unknown) =>
                setError(cause instanceof Error ? cause.message : 'Nem sikerült.'),
              );
          }}
        >
          {versions ? 'Előzmény bezárása' : 'Előzmény'}
        </Button>
      </header>

      {/**
       * A hangolás lényege, hogy a hatás azonnal él — de a MÁR KIOSZTOTT pont
       * nem változik visszamenőleg. Ezt ki kell mondani, különben az első
       * állításnál jogos a kérdés, hogy „akkor most újraszámolódik minden?".
       */}
      <p className="admin-note">
        A módosítás a mentés után egy percen belül minden kiszolgálón érvényes. A már
        jóváírt pontokat nem számoljuk újra — minden aktivitás azzal a verzióval marad
        elszámolva, amivel feldolgoztuk.
      </p>

      {versions ? (
        <section className="admin-card">
          <h2>Verziótörténet</h2>
          {versions.length === 0 ? (
            <p className="admin-muted">Még nincs mentett verzió.</p>
          ) : (
            <ul className="admin-versions">
              {versions.map((item) => (
                <li key={item.version}>
                  <div>
                    <strong>{item.version}. verzió</strong>
                    <span className="admin-muted">
                      {item.updatedAt ? new Date(item.updatedAt).toLocaleString('hu-HU') : ''}
                      {` · ${Object.keys(item.overrides).length} eltérés`}
                    </span>
                    {item.note ? <p className="admin-muted">{item.note}</p> : null}
                  </div>
                  <Button
                    variant="ghost"
                    disabled={busy || item.version === state.version}
                    onClick={() => void rollback(item.version)}
                  >
                    {item.version === state.version ? 'Ez az aktuális' : 'Visszaállítás'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {state.groups.map((group) => (
        <section key={group.group} className="admin-card">
          <h2>{group.group}</h2>
          <div className="admin-tunables">
            {group.items.map((item) => (
              <TunableRow
                key={item.path}
                item={item}
                draft={draft[item.path]}
                onChange={(value) => setValue(item.path, value)}
              />
            ))}
          </div>
        </section>
      ))}

      <div className="admin-savebar">
        <TextField
          label="Megjegyzés (a verziótörténetbe)"
          placeholder="Pl. a bringás alappont felemelve teszteléshez"
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
        {error ? <p className="admin-error">{error}</p> : null}
        {saved ? <p className="admin-ok">{saved}</p> : null}
        <div className="admin-savebar__actions">
          <Button
            variant="ghost"
            disabled={!dirty || busy}
            onClick={() => setDraft({ ...state.overrides })}
          >
            Elvetés
          </Button>
          <Button disabled={!dirty || busy} onClick={() => void save()}>
            {busy ? 'Mentés…' : 'Mentés'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TunableRow({
  item,
  draft,
  onChange,
}: {
  item: TunableItem;
  draft: number | boolean | undefined;
  onChange: (value: number | boolean | undefined) => void;
}) {
  const current = draft ?? item.defaultValue;
  const changed = draft !== undefined && draft !== item.defaultValue;

  if (item.kind === 'boolean') {
    return (
      <div className={`admin-tunable${changed ? ' admin-tunable--changed' : ''}`}>
        <Switch
          checked={Boolean(current)}
          label={item.label}
          description={item.help}
          onChange={(checked) =>
            onChange(checked === item.defaultValue ? undefined : checked)
          }
        />
        <ResetHint item={item} changed={changed} onReset={() => onChange(undefined)} />
      </div>
    );
  }

  return (
    <div className={`admin-tunable${changed ? ' admin-tunable--changed' : ''}`}>
      <label className="admin-tunable__label" htmlFor={`t-${item.path}`}>
        {item.label}
        {item.unit ? <span className="admin-muted"> ({item.unit})</span> : null}
      </label>
      <input
        id={`t-${item.path}`}
        className="admin-tunable__input"
        type="number"
        inputMode="decimal"
        step={item.kind === 'integer' ? 1 : 'any'}
        min={item.min}
        max={item.max}
        value={String(current)}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw === '') return onChange(undefined);
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) return;
          onChange(parsed === item.defaultValue ? undefined : parsed);
        }}
      />
      <p className="admin-tunable__help">{item.help}</p>
      <ResetHint item={item} changed={changed} onReset={() => onChange(undefined)} />
    </div>
  );
}

/**
 * Az alapérték mindig látszik, ha eltértünk tőle.
 *
 * Hangolás közben ez a legfontosabb információ: nem az, hogy mi az érték most,
 * hanem hogy mennyivel tértünk el attól, ami a specben van.
 */
function ResetHint({
  item,
  changed,
  onReset,
}: {
  item: TunableItem;
  changed: boolean;
  onReset: () => void;
}) {
  if (!changed) {
    return (
      <span className="admin-tunable__meta admin-muted">
        Alapérték: {String(item.defaultValue)}
        {item.unit ? ` ${item.unit}` : ''}
      </span>
    );
  }
  return (
    <span className="admin-tunable__meta">
      <span className="admin-badge">módosítva</span>
      <button type="button" className="admin-linkbtn" onClick={onReset}>
        Vissza az alapértékre ({String(item.defaultValue)})
      </button>
    </span>
  );
}
