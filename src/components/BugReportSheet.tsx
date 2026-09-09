import { useState } from 'react';
import { Button } from '@/components/ui';
import type { BugReportKind, BugReportSeverity } from '@/lib/api';
import { submitBugReport } from '@/lib/bugReport';
import type { CrashHint } from '@/lib/debugMode';
import './debug.css';

/**
 * A hibabejelentés űrlapja — a report és a crash report is ezt használja.
 *
 * A tesztelő ide EGY mondatot ír; minden más (build, eszköz, útvonal,
 * engedélyek, morzsanapló) magától kerül a bejelentésbe. Ezért nincs az
 * űrlapon se verzió-, se eszközmező: amit kézzel kellene kitölteni, azt
 * senki nem tölti ki pontosan.
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md
 */

const NOTE_MAX = 2000;

const SEVERITIES: { value: BugReportSeverity; label: string }[] = [
  { value: 'low', label: 'Apróság' },
  { value: 'normal', label: 'Zavaró' },
  { value: 'high', label: 'Használhatatlan' },
];

export function BugReportSheet({
  kind,
  crash,
  recorder,
  title,
  lead,
  onClose,
}: {
  kind: BugReportKind;
  crash?: CrashHint;
  recorder?: string;
  title: string;
  lead: string;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [severity, setSeverity] = useState<BugReportSeverity>('normal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sentId, setSentId] = useState('');

  function submit() {
    setBusy(true);
    setError('');
    submitBugReport({ kind, severity, note, crash, recorder })
      .then(setSentId)
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : 'A bejelentést nem sikerült elküldeni.');
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="dbg-menu" role="dialog" aria-label={title}>
      <button type="button" className="dbg-menu__scrim" aria-label="Bezárás" onClick={onClose} />
      <div className="dbg-menu__panel">
        <span className="dbg-menu__title">{title}</span>

        {sentId ? (
          <>
            {/*
              A visszaigazolás AZONOSÍTÓT is mutat. Enélkül a tesztelő csak
              annyit tud mondani, hogy „küldtem egyet", és a triázsban nem
              lehet összepárosítani azzal, amiről beszél.
            */}
            <p className="dbg-menu__note">
              Elküldve. Azonosító: <strong>{sentId}</strong>
            </p>
            <Button block onClick={onClose}>
              Kész
            </Button>
          </>
        ) : (
          <>
            <p className="dbg-menu__note">{lead}</p>

            <div className="dbg-sev">
              {SEVERITIES.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  className={`dbg-sev__item${severity === item.value ? ' dbg-sev__item--on' : ''}`}
                  aria-pressed={severity === item.value}
                  onClick={() => setSeverity(item.value)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <label className="dbg-note">
              <span className="label">Mi történt?</span>
              <textarea
                className="dbg-note__textarea"
                rows={4}
                maxLength={NOTE_MAX}
                value={note}
                placeholder="Például: a Play gombra koppintva nem indult el a visszaszámlálás."
                onChange={(event) => setNote(event.target.value)}
              />
            </label>

            {error ? (
              <p className="dbg-status dbg-status--error" role="alert">
                {error}
              </p>
            ) : null}

            <div className="dbg-actions">
              <Button variant="ghost" onClick={onClose} disabled={busy}>
                Mégse
              </Button>
              {/*
                A `report` típushoz kötelező a szöveg — a szerver is ezt kéri.
                A crash reportnál nem: ott a napló önmagában is használható,
                és a tesztelő gyakran nem tudja, mi történt.
              */}
              <Button
                loading={busy}
                disabled={kind === 'report' && note.trim().length === 0}
                onClick={submit}
              >
                Küldés
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
