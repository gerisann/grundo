import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import {
  markPerfSnapshotSynced,
  perfMeterEnabled,
  readPerfSnapshot,
  resetPerfMeter,
  savePerfSnapshot,
  setPerfMeterEnabled,
  type PerfSnapshot,
} from '@/lib/perfMeter';
import './perfOverlay.css';

/** Másodpercenként egyszer olvasunk — a rögzítés hurka sosem rajzol emiatt. */
const REFRESH_MS = 1000;

const EMPTY: PerfSnapshot = { stats: [], notes: [] };

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

/**
 * Főszál-mérő a rögzítés közbeni teljesítményhez (GRUNDO #32).
 *
 * CSAK ADMINNAK, és csak bekapcsolva mér — a hívó dolga eldönteni, hogy
 * megjeleníti-e egyáltalán. Alapból egyetlen pöttyre van összecsukva, hogy
 * valódi rögzítésnél ne takarja a felületet.
 */
export function PerfOverlay() {
  const [enabled, setEnabled] = useState(perfMeterEnabled);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<PerfSnapshot>(EMPTY);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'uploaded' | 'localOnly'>('idle');
  const [label, setLabel] = useState('');

  useEffect(() => {
    if (!enabled || !open) return;
    const read = () => setSnapshot(readPerfSnapshot());
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled, open]);

  function toggleMeter() {
    const next = !enabled;
    setPerfMeterEnabled(next);
    setEnabled(next);
    setSnapshot(EMPTY);
  }

  /**
   * A helyi mentés az elsődleges: terepen a hálózat bizonytalan, a mérés
   * viszont nem ismételhető meg. A feltöltés ezután jön, és ha elbukik, a
   * bejegyzés `synced: false` marad — az admin oldalról pótolható.
   */
  async function saveAndUpload(): Promise<void> {
    const entry = savePerfSnapshot(label);
    if (!entry) return;
    setSaveState('saving');
    try {
      await api.adminUploadPerfSnapshot(entry);
      markPerfSnapshotSynced(entry.id);
      setSaveState('uploaded');
    } catch {
      setSaveState('localOnly');
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        className={`perf-overlay__pill${enabled ? ' perf-overlay__pill--live' : ''}`}
        onClick={() => setOpen(true)}
        aria-label="Teljesítménymérő megnyitása"
      >
        ⏱
      </button>
    );
  }

  return (
    <section className="perf-overlay" aria-label="Teljesítménymérő">
      <header className="perf-overlay__head">
        <strong>Főszál-mérő</strong>
        <button type="button" onClick={() => setOpen(false)} aria-label="Bezárás">×</button>
      </header>

      <input
        className="perf-overlay__label"
        type="text"
        value={label}
        maxLength={60}
        placeholder="jelölés, pl. háttér / előtér"
        aria-label="A mérés jelölése"
        onChange={(event) => setLabel(event.target.value)}
      />

      <div className="perf-overlay__actions">
        <button
          type="button"
          className={enabled ? 'perf-overlay__on' : ''}
          onClick={toggleMeter}
        >
          {enabled ? 'Mérés BE' : 'Mérés KI'}
        </button>
        <button
          type="button"
          disabled={!enabled}
          onClick={() => {
            resetPerfMeter();
            setSnapshot(EMPTY);
          }}
        >
          Nullázás
        </button>
        <button
          type="button"
          disabled={!enabled || snapshot.stats.length === 0 || saveState === 'saving'}
          onClick={() => void saveAndUpload()}
        >
          {saveState === 'saving' ? 'Mentés…' : 'Mentés'}
        </button>
      </div>

      {saveState === 'uploaded' ? (
        <p className="perf-overlay__hint perf-overlay__saved">
          Mentve és feltöltve — az admin „Teljesítmény" oldalán megtekinthető.
        </p>
      ) : saveState === 'localOnly' ? (
        <p className="perf-overlay__hint perf-overlay__saved">
          Helyben mentve, feltöltés nem sikerült — az admin „Teljesítmény"
          oldalán később pótolható.
        </p>
      ) : null}

      {!enabled ? (
        <p className="perf-overlay__hint">
          Kapcsold be, indíts rögzítést, és itt olvasható lesz, mennyi ideig tart
          egy GPS-minta feldolgozása.
        </p>
      ) : snapshot.stats.length === 0 ? (
        <p className="perf-overlay__hint">Nincs még mérés — indíts rögzítést.</p>
      ) : (
        <>
          <table className="perf-overlay__table">
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
              {snapshot.stats.map((stat) => (
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
          <p className="perf-overlay__notes">
            {snapshot.notes.map(([key, value]) => (
              <span key={key}>{value} {NOTE_LABELS[key] ?? key}</span>
            ))}
          </p>
          <p className="perf-overlay__hint">
            Ezredmásodperc egy újraszámolásra, és hányszor fut percenként. A
            kettő szorzata a lényeg: ha 60 000 ms fölé megy percenként, a
            főszál folyamatosan foglalt.
          </p>
        </>
      )}
    </section>
  );
}
