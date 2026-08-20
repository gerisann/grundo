import { useCallback, useEffect, useState } from 'react';
import {
  api,
  type AdminModifier,
  type CreateModifierInput,
  type ModifierKindName,
  type ModifierScopeName,
} from '@/lib/api';
import { Button, TextField } from '@/components/ui';

/**
 * Akciók — időszakos szorzók.
 *
 * A modifier NEM az `appConfig` átírása: külön dokumentum, kötelezően véges
 * élettartammal. Ez a különbség adja a biztonságot, és később ugyanide fog
 * írni az automatikus esemény-generálás is — az `appConfig`-hoz nem nyúlhat.
 *
 * Három művelet, három különböző súllyal:
 *   **Szerkesztés** — futó akción is; a korábbi jóváírásokat nem érinti, mert a
 *     `gpLedger` a jóváírás pillanatában érvényes szorzót őrzi meg magában.
 *   **Lezárás** — a hatás megszűnik, a nyom marad. Ez a szelíd megállítás.
 *   **Törlés** — a dokumentum eltűnik. Szabad, mert a főkönyv nem hivatkozásként,
 *     hanem pillanatképként tárolja az akciót; a teljes rekord a törlés előtt
 *     bekerül az `adminAudit`-ba.
 *
 * docs/06-architektura-es-admin.md → Modifierek
 */

const KIND_LABEL: Record<ModifierKindName, string> = {
  gp_multiplier: 'Minden pont',
  claim_multiplier: 'Területfoglalás',
  hold_multiplier: 'Tartás-bónusz',
};

const KIND_HELP: Record<ModifierKindName, string> = {
  gp_multiplier: 'Az aktivitás teljes pontszámát szorozza — az alappontot is.',
  claim_multiplier:
    'Csak a bezárt területért járó igénypontot szorozza (és rajta keresztül a lopás- és áttörésbónuszt).',
  hold_multiplier:
    'A napi tartás-bónuszt szorozza. Területi hatókör itt egyelőre nem érvényesül.',
};

const SCOPE_LABEL: Record<ModifierScopeName, string> = {
  global: 'Mindenki',
  area: 'Terület',
  segment: 'Szegmens',
};

const STATE_LABEL: Record<AdminModifier['state'], string> = {
  active: 'fut',
  scheduled: 'ütemezve',
  expired: 'lejárt',
  cancelled: 'lezárva',
};

/** ISO-alak a `datetime-local` mezőhöz, helyi idő szerint. */
function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ModifiersScreen() {
  const [items, setItems] = useState<AdminModifier[] | null>(null);
  const [showExpired, setShowExpired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminModifier | null>(null);

  const load = useCallback(async (expired: boolean) => {
    const result = await api.adminModifiers(expired);
    setItems(result.modifiers);
  }, []);

  useEffect(() => {
    load(showExpired).catch((cause: unknown) =>
      setError(cause instanceof Error ? cause.message : 'Nem sikerült betölteni.'),
    );
  }, [load, showExpired]);

  function closeForm() {
    setOpen(false);
    setEditing(null);
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load(showExpired);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'A művelet nem sikerült.');
    } finally {
      setBusy(false);
    }
  }

  function remove(item: AdminModifier) {
    /**
     * A megerősítés szövege attól függ, futott-e már.
     *
     * Egy még el nem indult akció törlése következmény nélküli takarítás; egy
     * lefutotté viszont már osztott pontokat, és bár a főkönyv önállóan megőrzi
     * a nyomát, ezt ki kell mondani, mielőtt eltűnik a listából.
     */
    const ran = item.state !== 'scheduled';
    const message = ran
      ? `Törlöd? Ez az akció már futott, tehát osztott pontokat. A jóváírások megmaradnak, és a teljes rekord bekerül a naplóba — a listából viszont eltűnik.\n\n„${item.reason}"`
      : `Törlöd? Ez az akció még el sem indult, tehát nyoma sem lesz a pontokban.\n\n„${item.reason}"`;
    if (!window.confirm(message)) return;
    void run(() => api.adminDeleteModifier(item.id));
  }

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Akciók</h1>
          <p className="admin-muted">Időszakos szorzók. Minden akció lejár magától.</p>
        </div>
        <Button
          onClick={() => {
            if (open) return closeForm();
            setEditing(null);
            setOpen(true);
          }}
        >
          {open ? 'Mégsem' : 'Új akció'}
        </Button>
      </header>

      {open ? (
        <ModifierForm
          editing={editing}
          onCancel={closeForm}
          onSaved={() => {
            closeForm();
            void load(showExpired);
          }}
        />
      ) : null}

      {error ? <p className="admin-error">{error}</p> : null}

      <label className="admin-check">
        <input
          type="checkbox"
          checked={showExpired}
          onChange={(event) => setShowExpired(event.target.checked)}
        />
        Lejárt és lezárt akciók mutatása
      </label>

      {items === null ? (
        <p className="admin-muted">Betöltés…</p>
      ) : items.length === 0 ? (
        <p className="admin-muted">
          Nincs akció. Az „Új akció" gombbal tehetsz ki egyet — például dupla pontot egy
          hétvégére.
        </p>
      ) : (
        <ul className="admin-modifiers">
          {items.map((item) => (
            <li key={item.id} className={`admin-modifier admin-modifier--${item.state}`}>
              <div className="admin-modifier__head">
                <span className="admin-modifier__value">{item.value}×</span>
                <div>
                  <strong>{KIND_LABEL[item.kind]}</strong>
                  <span className="admin-muted">
                    {' · '}
                    {SCOPE_LABEL[item.scope]}
                    {item.scope === 'area' && item.area
                      ? ` (${item.area.radiusKm} km, ${item.areaCellCount} mező)`
                      : ''}
                    {item.scope === 'segment' && item.segment?.inactiveDays
                      ? ` (${item.segment.inactiveDays}+ napja inaktív)`
                      : ''}
                  </span>
                </div>
                <span className={`admin-badge admin-badge--${item.state}`}>
                  {STATE_LABEL[item.state]}
                  {item.source === 'auto' ? ' · automatikus' : ''}
                </span>
              </div>
              <p className="admin-modifier__reason">{item.reason}</p>
              <p className="admin-muted">
                {item.from ? new Date(item.from).toLocaleString('hu-HU') : '?'} —{' '}
                {item.to ? new Date(item.to).toLocaleString('hu-HU') : '?'}
              </p>

              <div className="admin-modifier__actions">
                {item.state === 'active' || item.state === 'scheduled' ? (
                  <>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditing(item);
                        setOpen(true);
                      }}
                    >
                      Szerkesztés
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void run(() => api.adminCancelModifier(item.id))}
                    >
                      Lezárás
                    </Button>
                  </>
                ) : null}
                <Button variant="danger" disabled={busy} onClick={() => remove(item)}>
                  Törlés
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModifierForm({
  editing,
  onCancel,
  onSaved,
}: {
  editing: AdminModifier | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const now = new Date();
  const inTwoDays = new Date(now.getTime() + 2 * 86_400_000);

  const [kind, setKind] = useState<ModifierKindName>(editing?.kind ?? 'gp_multiplier');
  const [scope, setScope] = useState<ModifierScopeName>(editing?.scope ?? 'global');
  const [value, setValue] = useState(String(editing?.value ?? 2));
  const [reason, setReason] = useState(editing?.reason ?? '');
  const [from, setFrom] = useState(
    toLocalInput(editing?.from ? new Date(editing.from) : now),
  );
  const [to, setTo] = useState(toLocalInput(editing?.to ? new Date(editing.to) : inTwoDays));
  const [lat, setLat] = useState(String(editing?.area?.lat ?? 47.4979));
  const [lng, setLng] = useState(String(editing?.area?.lng ?? 19.0402));
  const [radiusKm, setRadiusKm] = useState(String(editing?.area?.radiusKm ?? 5));
  const [inactiveDays, setInactiveDays] = useState(
    String(editing?.segment?.inactiveDays ?? 7),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const started = editing !== null && editing.state === 'active';

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const input: CreateModifierInput = {
        kind,
        scope,
        value: Number(value),
        reason: reason.trim(),
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
      };
      if (scope === 'area') {
        input.area = { lat: Number(lat), lng: Number(lng), radiusKm: Number(radiusKm) };
      }
      if (scope === 'segment') {
        input.segment = { inactiveDays: Number(inactiveDays) };
      }

      if (editing) await api.adminUpdateModifier(editing.id, input);
      else await api.adminCreateModifier(input);
      onSaved();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'A mentés nem sikerült.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="admin-card">
      <h2>{editing ? 'Akció szerkesztése' : 'Új akció'}</h2>

      {started ? (
        <p className="admin-note">
          Ez az akció MÁR FUT. A módosítás mostantól érvényes; a korábbi jóváírásokat nem
          írja át, mert a főkönyv a jóváírás pillanatában érvényes szorzót őrzi meg. A
          kezdést viszont nem lehet korábbra húzni.
        </p>
      ) : null}

      <div className="admin-form">
        <label className="admin-field">
          <span>Mire hat</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as ModifierKindName)}>
            {(Object.keys(KIND_LABEL) as ModifierKindName[]).map((key) => (
              <option key={key} value={key}>
                {KIND_LABEL[key]}
              </option>
            ))}
          </select>
          <p className="admin-muted">{KIND_HELP[kind]}</p>
        </label>

        <label className="admin-field">
          <span>Kire hat</span>
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as ModifierScopeName)}
          >
            {(Object.keys(SCOPE_LABEL) as ModifierScopeName[]).map((key) => (
              <option key={key} value={key}>
                {SCOPE_LABEL[key]}
              </option>
            ))}
          </select>
          {scope === 'area' ? (
            <p className="admin-muted">
              A területi akció ARÁNYOSAN hat: ha a bezárt terület negyede esik a körbe, a
              2× szorzóból 1,25× lesz.
            </p>
          ) : null}
        </label>

        <TextField
          label="Szorzó"
          type="number"
          step="any"
          min={0}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          hint="1 = nincs hatás. A több egyszerre futó akció szorzói összeszorzódnak, de az eredő plafonozva van."
        />

        <TextField
          label="Kezdés"
          type="datetime-local"
          value={from}
          onChange={(event) => setFrom(event.target.value)}
          hint={started ? 'Futó akciónál nem tolható korábbra.' : undefined}
        />
        <TextField
          label="Vége"
          type="datetime-local"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          hint="Kötelező. Ez teszi az akciót visszavonhatóvá akkor is, ha mindenki elfelejti."
        />

        {scope === 'area' ? (
          <>
            <TextField
              label="Középpont — szélesség"
              type="number"
              step="any"
              value={lat}
              onChange={(event) => setLat(event.target.value)}
            />
            <TextField
              label="Középpont — hosszúság"
              type="number"
              step="any"
              value={lng}
              onChange={(event) => setLng(event.target.value)}
            />
            <TextField
              label="Sugár (km)"
              type="number"
              step="any"
              min={0}
              value={radiusKm}
              onChange={(event) => setRadiusKm(event.target.value)}
            />
          </>
        ) : null}

        {scope === 'segment' ? (
          <TextField
            label="Legalább ennyi napja inaktív"
            type="number"
            step={1}
            min={1}
            value={inactiveDays}
            onChange={(event) => setInactiveDays(event.target.value)}
          />
        ) : null}

        <TextField
          label="Indoklás"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="Ez a szöveg a JÁTÉKOSNAK is megjelenik. Enélkül egy néma szorzó maradna, amit három hónappal később senki nem tud megmagyarázni."
          placeholder="Pl. Hétvégi dupla pont a nyitóhéten"
        />
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-savebar__actions">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Mégsem
        </Button>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy ? 'Mentés…' : editing ? 'Mentés' : 'Létrehozás'}
        </Button>
      </div>
    </section>
  );
}
