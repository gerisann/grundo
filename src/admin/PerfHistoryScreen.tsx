import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { api, type ServerPerfSnapshot } from '@/lib/api';
import {
  clearPerfHistory,
  markPerfSnapshotSynced,
  readPerfHistory,
  type PerfHistoryEntry,
} from '@/lib/perfMeter';
import '@/components/perfOverlay.css';

/** Magyar felirat a mérőkulcsokhoz; ismeretlen kulcs a saját nevén jelenik meg. */
const LABELS: Record<string, string> = {
  'preview.total': 'Teljes preview',
  'preview.geometry': '· geometria',
  'preview.process': '· elszámolás',
  'preview.fates': '· cellalista',
};

const NOTE_LABELS: Record<string, string> = {
  points: 'pont',
  cells: 'cella',
  loops: 'hurok',
  fates: 'foglalt',
};

function fmtMs(ms: number): string {
  if (ms >= 100) return `${Math.round(ms)}`;
  if (ms >= 10) return ms.toFixed(1);
  return ms.toFixed(2);
}

/** A user agentből csak az OS/eszköz-részt tartjuk meg, kezelhető hosszon. */
function shortUserAgent(ua: string): string {
  if (!ua) return '—';
  return ua.length > 70 ? `${ua.slice(0, 70)}…` : ua;
}

interface Row extends PerfHistoryEntry {
  /** Megvan-e a szerveren. Ami nincs, az csak ezen az eszközön létezik. */
  onServer: boolean;
}

/**
 * A `PerfOverlay`-ban mentett terepi mérések — admin nézet (GRUNDO #35, #36).
 *
 * A mérés a JÁTÉKOS eszközén készül, és először mindig a `localStorage`-ba
 * kerül: rögzítés közben nem lehet a hálózatra bízni. A mentés ezért fel is
 * tölti a szerverre (`/api/admin/perf-snapshots`), és ez a lista a KETTŐ
 * uniója. Így egy telefonos mérés a gépen is elemezhető — enélkül a #35-ös
 * változat csak azon az egy készüléken mutatott bármit, amelyiken a mérés
 * készült.
 *
 * Ha a feltöltés a terepen nem sikerült, a bejegyzés helyben `synced: false`
 * marad; ez az oldal megnyitáskor újra megpróbálja felküldeni.
 */
export function PerfHistoryScreen() {
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);

  const load = useCallback(async () => {
    setBusy(true);
    const local = readPerfHistory();
    let server: ServerPerfSnapshot[] = [];
    try {
      server = (await api.adminPerfSnapshots()).entries;
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'A szerveroldali lista nem érhető el.');
    }

    const merged = new Map<string, Row>();
    for (const entry of server) merged.set(entry.id, { ...entry, onServer: true });
    for (const entry of local) {
      if (!merged.has(entry.id)) merged.set(entry.id, { ...entry, onServer: false });
    }

    setRows([...merged.values()].sort((a, b) => b.at - a.at));
    setBusy(false);
  }, []);

  useEffect(() => {
    /**
     * Megnyitáskor pótoljuk a terepen elmaradt feltöltéseket. A végpont a
     * mérés saját azonosítójára ír, tehát az ismételt küldés ártalmatlan.
     */
    async function loadAndCatchUp(): Promise<void> {
      const pending = readPerfHistory().filter((entry) => entry.synced !== true);
      for (const entry of pending) {
        try {
          await api.adminUploadPerfSnapshot(entry);
          markPerfSnapshotSynced(entry.id);
        } catch {
          // Nincs hálózat vagy nincs jogosultság — a helyi másolat megmarad.
        }
      }
      await load();
    }
    void loadAndCatchUp();
  }, [load]);

  const localOnly = rows.filter((row) => !row.onServer).length;

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Teljesítmény</h1>
          <p className="admin-muted">
            A Főszál-mérőben (rögzítés közben, „⏱" gomb) mentett terepi mérések.
            A mentés felkerül a szerverre, tehát a telefonos mérés itt, gépen is
            olvasható.
          </p>
        </div>
        {readPerfHistory().length > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              clearPerfHistory();
              void load();
            }}
          >
            Helyi előzmény törlése
          </Button>
        ) : null}
      </header>

      {error ? (
        <section className="admin-card">
          <p className="admin-muted">
            A szerveroldali lista nem érhető el: {error}. Ami látszik, az ennek
            az eszköznek a helyi előzménye.
          </p>
        </section>
      ) : null}

      {busy ? (
        <section className="admin-card">
          <p className="admin-muted">Betöltés…</p>
        </section>
      ) : rows.length === 0 ? (
        <section className="admin-card">
          <p className="admin-muted">
            Még nincs mentett mérés. Kapcsold be a Főszál-mérőt a rögzítő
            képernyőn, indíts egy tesztsétát, és a mérőn belül nyomd meg a
            „Mentés" gombot.
          </p>
        </section>
      ) : (
        rows.map((entry) => (
          <section className="admin-card" key={entry.id}>
            <h2>
              {entry.label ? `${entry.label} — ` : ''}
              {new Date(entry.at).toLocaleString('hu-HU')}
            </h2>
            <p className="admin-muted">
              {entry.platform} · {shortUserAgent(entry.userAgent)}
              {entry.onServer ? '' : ' · csak ezen az eszközön'}
            </p>

            <table className="perf-overlay__table admin-perf-table">
              <thead>
                <tr>
                  <th scope="col">Mit</th>
                  <th scope="col">átl.</th>
                  <th scope="col">p95</th>
                  <th scope="col">max</th>
                  <th scope="col">/perc</th>
                </tr>
              </thead>
              <tbody>
                {entry.stats.map((stat) => (
                  <tr key={stat.key}>
                    <th scope="row">{LABELS[stat.key] ?? stat.key}</th>
                    <td>{fmtMs(stat.avgMs)}</td>
                    <td>{fmtMs(stat.p95Ms)}</td>
                    <td className="perf-overlay__max">{fmtMs(stat.maxMs)}</td>
                    <td>{stat.perMinute === null ? '—' : Math.round(stat.perMinute)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {entry.notes.length > 0 ? (
              <p className="perf-overlay__notes admin-muted">
                {entry.notes.map(([key, value]) => (
                  <span key={key}>{value} {NOTE_LABELS[key] ?? key}</span>
                ))}
              </p>
            ) : null}
          </section>
        ))
      )}

      {localOnly > 0 ? (
        <p className="admin-muted">
          {localOnly} mérés csak ezen az eszközön van meg — a feltöltés nem
          sikerült. Az oldal újratöltése újra megpróbálja.
        </p>
      ) : null}
    </div>
  );
}
