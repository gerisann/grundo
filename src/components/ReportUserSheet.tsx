import { useState } from 'react';
import { Button } from '@/components/ui';
import { api, type ReportCategory } from '@/lib/api';
import './reportUserSheet.css';

/**
 * Felhasználó bejelentése.
 *
 * A KATEGÓRIA KÖTELEZŐ, a leírás nem. Ennek moderációs oka van: a `docs/05`
 * szerint a kategória dönti el, melyik ágra kerül a bejelentés (`technical`
 * vagy `content`), és ezt az emberi olvasás nem tudja kiváltani. A szabad
 * szöveg viszont sokszor üres marad, és kár lenne emiatt elveszíteni a
 * bejelentést.
 *
 * A szövegek NEM ígérnek visszajelzést. A bejelentő a `firestore.rules`
 * szerint a saját bejelentését sem olvashatja vissza — ha az app azt írná,
 * hogy „értesítünk az eredményről", az hazugság lenne.
 */

const CATEGORIES: { value: ReportCategory; label: string; help: string }[] = [
  {
    value: 'gps_spoof',
    label: 'Hamisított helyadat',
    help: 'A nyomvonal nem valódi mozgásból származik.',
  },
  {
    value: 'vehicle',
    label: 'Járművel tette meg',
    help: 'Autóval, motorral vagy más járművel rögzített futást vagy sétát.',
  },
  {
    value: 'wrong_type',
    label: 'Rossz aktivitástípus',
    help: 'Például bringázást rögzített futásként.',
  },
  { value: 'offensive', label: 'Sértő tartalom', help: 'Bántó név, kép vagy szöveg.' },
  {
    value: 'privacy',
    label: 'Adatvédelmi aggály',
    help: 'Más ember adatait vagy képét osztja meg engedély nélkül.',
  },
  { value: 'other', label: 'Egyéb', help: 'Ami a fenti okok közé nem fér bele.' },
];

const NOTE_MAX = 500;

export function ReportUserSheet({
  username,
  displayName,
  onClose,
  onDone,
}: {
  username: string;
  displayName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function submit() {
    if (category === null) return;
    setBusy(true);
    setError('');
    api
      .reportUser(username, category, note)
      .then(onDone)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'A bejelentést nem sikerült elküldeni.');
      })
      .finally(() => setBusy(false));
  }

  return (
    <div className="rsheet" role="dialog" aria-label={`${displayName} jelentése`}>
      <button type="button" className="rsheet__scrim" aria-label="Bezárás" onClick={onClose} />
      <div className="rsheet__panel">
        <div className="rsheet__head">
          <span className="rsheet__title">{displayName} jelentése</span>
          <p className="rsheet__lead">
            Mi a gond? A bejelentést moderátor nézi át. A bejelentő kiléte a bejelentett felé nem
            derül ki.
          </p>
        </div>

        <div className="rsheet__list">
          {CATEGORIES.map((item) => (
            <button
              key={item.value}
              type="button"
              className={`rsheet__option${category === item.value ? ' rsheet__option--on' : ''}`}
              aria-pressed={category === item.value}
              onClick={() => setCategory(item.value)}
            >
              <span className="rsheet__option-label">{item.label}</span>
              <span className="rsheet__option-help">{item.help}</span>
            </button>
          ))}
        </div>

        <label className="rsheet__note">
          <span className="label">Leírás (nem kötelező)</span>
          <textarea
            className="rsheet__textarea"
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            placeholder="Ha van olyan részlet, ami segít, írd ide."
            onChange={(event) => setNote(event.target.value)}
          />
          <span className="rsheet__count">
            {note.length} / {NOTE_MAX}
          </span>
        </label>

        {error ? (
          <p className="field__error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="rsheet__actions">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Mégse
          </Button>
          <Button variant="danger" loading={busy} disabled={category === null} onClick={submit}>
            Bejelentés elküldése
          </Button>
        </div>
      </div>
    </div>
  );
}
