import { useState } from 'react';
import { Button } from '@/components/ui';
import { clearPerfHistory, readPerfHistory, type PerfHistoryEntry } from '@/lib/perfMeter';
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

/**
 * A `PerfOverlay`-ban mentett terepi mérések — admin nézet (GRUNDO #35).
 *
 * MIÉRT KÜLÖN OLDAL, NEM RÉSZ AZ ÁTTEKINTŐBEN: a mérés a JÁTÉKOS eszközén
 * történik és a `localStorage`-ba mentődik (lásd `src/lib/perfMeter.ts`),
 * tehát ez a lista csak akkor mutat valamit, ha UGYANAZON az eszközön (és
 * böngészőben) nyitod meg az admint, amelyiken a mérés készült — nincs
 * szerveroldali szinkron. Ez a `docs/ai/CURRENT_STATE.md` #34-es nyitott
 * ügyének (3. pont) a megoldása: eddig a Főszál-mérő csak élőben látszott.
 */
export function PerfHistoryScreen() {
  const [entries, setEntries] = useState<PerfHistoryEntry[]>(() => readPerfHistory());

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Teljesítmény</h1>
          <p className="admin-muted">
            A Főszál-mérőben (rögzítés közben, „⏱" gomb) mentett terepi mérések —
            csak erről az eszközről.
          </p>
        </div>
        {entries.length > 0 ? (
          <Button
            variant="secondary"
            onClick={() => {
              clearPerfHistory();
              setEntries([]);
            }}
          >
            Előzmény törlése
          </Button>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <section className="admin-card">
          <p className="admin-muted">
            Még nincs mentett mérés. Kapcsold be a Főszál-mérőt a rögzítő
            képernyőn, indíts egy tesztsétát, és a mérőn belül nyomd meg a
            „Mentés" gombot.
          </p>
        </section>
      ) : (
        entries.map((entry) => (
          <section className="admin-card" key={entry.id}>
            <h2>{new Date(entry.at).toLocaleString('hu-HU')}</h2>
            <p className="admin-muted">
              {entry.platform} · {shortUserAgent(entry.userAgent)}
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
    </div>
  );
}
