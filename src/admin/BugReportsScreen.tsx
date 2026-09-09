import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import {
  api,
  type AdminBugReportDetail,
  type AdminBugReportListItem,
  type BugReportKind,
  type BugReportSeverity,
  type BugReportStatus,
} from '@/lib/api';
import './bug-reports.css';

/**
 * Bugreportok — a tesztelői beküldések triázsa.
 *
 * A lista alapból a NYITOTT bejelentéseket mutatja: a lezártak visszakereshetők,
 * de a napi munkában csak zajt csinálnának.
 *
 * ⚠️ TÖRLÉS NINCS, szándékosan. A beküldés bizonyíték: ami egyszer megérkezett,
 * az a `wontfix`/`duplicate` státusszal kerül félre, nem tűnik el. Minden
 * módosítás naplózódik (`adminAudit`).
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md → 8.
 */

const KIND_LABEL: Record<BugReportKind, string> = {
  report: 'Report',
  screenshot: 'Képernyőkép',
  video: 'Videó',
  crash: 'Összeomlás',
};

const KIND_ICON: Record<BugReportKind, string> = {
  report: '📝',
  screenshot: '📷',
  video: '🎬',
  crash: '💥',
};

const STATUS_LABEL: Record<BugReportStatus, string> = {
  new: 'Új',
  triaged: 'Átnézve',
  in_progress: 'Folyamatban',
  fixed: 'Javítva',
  wontfix: 'Nem javítjuk',
  duplicate: 'Duplikátum',
};

const SEVERITY_LABEL: Record<BugReportSeverity, string> = {
  low: 'Apróság',
  normal: 'Zavaró',
  high: 'Használhatatlan',
};

const STATUS_ORDER: BugReportStatus[] = [
  'new',
  'triaged',
  'in_progress',
  'fixed',
  'wontfix',
  'duplicate',
];

/** A lezárt státuszok — ezekre kap a bejelentés `resolvedAt`-et a szerveren. */
const CLOSED: BugReportStatus[] = ['fixed', 'wontfix', 'duplicate'];

function fmtDateTime(ms: number): string {
  if (!ms) return '—';
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fmtTime(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function firstLine(note: string): string {
  const line = note.split('\n', 1)[0] ?? '';
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
}

/** Egy sekély kulcs–érték doboz kirajzolása. A mélyebb szintet is kibontjuk. */
function Bag({ title, value }: { title: string; value: Record<string, unknown> }) {
  const entries = Object.entries(value ?? {});
  if (entries.length === 0) return null;
  return (
    <div className="bug-bag">
      <h3>{title}</h3>
      <dl>
        {entries.map(([key, raw]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              {raw !== null && typeof raw === 'object'
                ? Object.entries(raw as Record<string, unknown>)
                    .map(([innerKey, innerValue]) => `${innerKey}: ${String(innerValue)}`)
                    .join(' · ')
                : String(raw)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Tesztelői jog kiosztása.
 *
 * ⚠️ Ez dönti el, kinek jelenik meg egyáltalán az üzemmód-választó és a lebegő
 * hibabejelentő gomb. Enélkül a tesztelői kört csak kézzel, a Firestore
 * konzolból lehetne kezelni — és az nem naplózódna sehol.
 */
function TesterCard() {
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  function apply(tester: boolean) {
    setBusy(true);
    setMessage('');
    setError('');
    api
      .adminSetTester(username.trim(), tester)
      .then((result) => {
        setMessage(
          `${result.username}: tesztelői jog ${result.tester ? 'bekapcsolva' : 'kikapcsolva'}.`,
        );
        setUsername('');
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'A módosítás nem sikerült.');
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="admin-card">
      <h2>Tesztelők</h2>
      <p className="admin-muted">
        A tesztelői jog nyitja meg az üzemmód-választót és a lebegő hibabejelentő gombot. Admin
        szerepkörrel ez amúgy is elérhető.
      </p>
      <div className="bug-testers">
        <input
          type="text"
          value={username}
          placeholder="felhasználónév"
          disabled={busy}
          onChange={(event) => setUsername(event.target.value)}
        />
        <Button disabled={busy || username.trim().length === 0} onClick={() => apply(true)}>
          Bekapcsolás
        </Button>
        <Button
          variant="ghost"
          disabled={busy || username.trim().length === 0}
          onClick={() => apply(false)}
        >
          Kikapcsolás
        </Button>
      </div>
      {message ? <p className="admin-ok">{message}</p> : null}
      {error ? <p className="admin-error">{error}</p> : null}
    </div>
  );
}

export function BugReportsScreen() {
  const [status, setStatus] = useState<BugReportStatus | ''>('new');
  const [kind, setKind] = useState<BugReportKind | ''>('');
  const [rows, setRows] = useState<AdminBugReportListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<AdminBugReportDetail | null>(null);
  const [adminNote, setAdminNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.adminBugReports({ status, kind });
      setRows(result.reports);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A lista nem tölthető be.');
    } finally {
      setBusy(false);
    }
  }, [status, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    api
      .adminBugReport(selectedId)
      .then((result) => {
        if (cancelled) return;
        setDetail(result.report);
        setAdminNote(result.report.adminNote);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'A bejelentés nem tölthető be.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function patch(changes: {
    status?: BugReportStatus;
    severity?: BugReportSeverity;
    adminNote?: string;
  }) {
    if (!detail) return;
    setSaving(true);
    setError('');
    try {
      await api.adminUpdateBugReport(detail.id, changes);
      const fresh = await api.adminBugReport(detail.id);
      setDetail(fresh.report);
      setAdminNote(fresh.report.adminNote);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A módosítás nem sikerült.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-page">
      <div className="admin-page__head">
        <div>
          <h1>Bugreportok</h1>
          <p className="admin-muted">
            Tesztelői beküldések. A build, az eszköz és a napló minden bejelentésben benne van.
          </p>
        </div>
        <Button variant="ghost" onClick={() => void load()} disabled={busy}>
          Frissítés
        </Button>
      </div>

      {error ? <p className="admin-error">{error}</p> : null}

      <div className="admin-card">
        <div className="bug-filters">
          <label>
            <span className="label">Státusz</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as BugReportStatus | '')}
            >
              <option value="">Mind</option>
              {STATUS_ORDER.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Típus</span>
            <select
              value={kind}
              onChange={(event) => setKind(event.target.value as BugReportKind | '')}
            >
              <option value="">Mind</option>
              {(Object.keys(KIND_LABEL) as BugReportKind[]).map((value) => (
                <option key={value} value={value}>
                  {KIND_LABEL[value]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <TesterCard />

      <div className="bug-split">
        <div className="admin-card bug-list">
          <h2>{busy ? 'Betöltés…' : `${rows.length} bejelentés`}</h2>
          {rows.length === 0 && !busy ? (
            <p className="admin-muted">Ezzel a szűrővel nincs bejelentés.</p>
          ) : null}
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              className={`bug-row${selectedId === row.id ? ' bug-row--on' : ''}`}
              onClick={() => setSelectedId(row.id)}
            >
              <span className="bug-row__top">
                <span aria-hidden="true">{KIND_ICON[row.kind]}</span>
                <strong>{row.username || row.uid}</strong>
                <span className={`admin-badge bug-badge--${row.status}`}>
                  {STATUS_LABEL[row.status]}
                </span>
              </span>
              <span className="bug-row__note">{firstLine(row.note) || '(nincs megjegyzés)'}</span>
              <span className="bug-row__meta admin-muted">
                {fmtDateTime(row.createdAt)} · {row.platform || '?'} · v{row.appVersion || '?'} ·{' '}
                {row.revision || '?'}
                {row.mediaCount > 0 ? ` · ${row.mediaCount} melléklet` : ''}
              </span>
            </button>
          ))}
        </div>

        <div className="admin-card bug-detail">
          {!detail ? (
            <p className="admin-muted">Válassz egy bejelentést a listából.</p>
          ) : (
            <>
              <h2>
                {KIND_LABEL[detail.kind]} · {detail.username || detail.uid}
              </h2>
              <p className="bug-detail__note">{detail.note || '(nincs megjegyzés)'}</p>

              <div className="bug-controls">
                <label>
                  <span className="label">Státusz</span>
                  <select
                    value={detail.status}
                    disabled={saving}
                    onChange={(event) =>
                      void patch({ status: event.target.value as BugReportStatus })
                    }
                  >
                    {STATUS_ORDER.map((value) => (
                      <option key={value} value={value}>
                        {STATUS_LABEL[value]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="label">Súlyosság</span>
                  <select
                    value={detail.severity}
                    disabled={saving}
                    onChange={(event) =>
                      void patch({ severity: event.target.value as BugReportSeverity })
                    }
                  >
                    {(Object.keys(SEVERITY_LABEL) as BugReportSeverity[]).map((value) => (
                      <option key={value} value={value}>
                        {SEVERITY_LABEL[value]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {CLOSED.includes(detail.status) ? (
                <p className="admin-muted">Lezárva: {fmtDateTime(detail.resolvedAt)}</p>
              ) : null}

              <label className="bug-adminnote">
                <span className="label">Admin jegyzet</span>
                <textarea
                  rows={3}
                  value={adminNote}
                  disabled={saving}
                  onChange={(event) => setAdminNote(event.target.value)}
                />
                <Button
                  variant="ghost"
                  disabled={saving || adminNote === detail.adminNote}
                  onClick={() => void patch({ adminNote })}
                >
                  Jegyzet mentése
                </Button>
              </label>

              {detail.media.length > 0 ? (
                <div className="bug-media">
                  <h3>Mellékletek</h3>
                  {detail.media.map((item) => (
                    <div key={item.path}>
                      {item.contentType.startsWith('image/') ? (
                        <img src={item.url} alt="Bugreport melléklet" />
                      ) : (
                        <video src={item.url} controls />
                      )}
                    </div>
                  ))}
                </div>
              ) : null}

              {detail.crash ? <Bag title="Összeomlás" value={detail.crash} /> : null}
              <Bag title="Eszköz" value={detail.device} />
              <Bag title="Kontextus" value={detail.context} />
              <Bag title="Állapot" value={detail.state} />

              {/*
                A NAPLÓ a legértékesebb rész: nem azt mutatja, mi történt, hanem
                azt, mi történt ELŐTTE. Ezért idővonalként, sorrendben.
              */}
              <div className="bug-bag">
                <h3>Napló ({detail.logs.length})</h3>
                <div className="bug-log">
                  {detail.logs.length === 0 ? (
                    <span className="admin-muted">Üres.</span>
                  ) : (
                    detail.logs.map((entry, index) => (
                      <span
                        key={`${entry.t}-${index}`}
                        className={`bug-log__row${entry.level === 'error' ? ' bug-log__row--error' : ''}`}
                      >
                        <span className="bug-log__time">{fmtTime(entry.t)}</span>
                        <span>
                          [{entry.level}] {entry.msg}
                        </span>
                      </span>
                    ))
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
