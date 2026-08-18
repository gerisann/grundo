import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField } from '@/components/ui';
import { MAX_PHOTOS, PhotoError, uploadActivityPhotos } from '@/lib/photos';
import { api, apiConfigured, type ActivityPhoto } from '@/lib/api';
import './saveActivityForm.css';

/**
 * Név, leírás és fotók a most mentett aktivitáshoz.
 *
 * MIÉRT A FELTÖLTÉS UTÁN, ÉS NEM ELŐTTE? Mert a területfoglalás nem várhat
 * arra, hogy a felhasználó címet találjon ki. A nyomvonal a befejezés
 * pillanatában felmegy, a terület azonnal a tiéd — ez az űrlap már csak a
 * leíró mezőket egészíti ki, és nyugodtan ki is hagyható.
 *
 * A KÉPEK NEM a backenden mennek át, hanem közvetlenül a Storage-ba, és
 * feltöltés előtt elveszítik az EXIF-adataikat (lásd src/lib/photos.ts) —
 * különben egy otthon készült fotó GPS-koordinátája megkerülné a privát zónát.
 */
export function SaveActivityForm({ activityId, uid }: { activityId: string; uid: string }) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError('');

    const room = MAX_PHOTOS - files.length;
    if (room <= 0) {
      setError(`Legfeljebb ${MAX_PHOTOS} kép tartozhat egy aktivitáshoz.`);
      return;
    }

    const accepted = [...picked].slice(0, room);
    if (accepted.length < picked.length) {
      setError(`Csak ${MAX_PHOTOS} kép fér el, a többit kihagytam.`);
    }

    setFiles((current) => [...current, ...accepted]);
    // Helyi előnézet: a feltöltés még el sem indult, de a felhasználó máris
    // látja, mit választott — és tud törölni belőle.
    setPreviews((current) => [...current, ...accepted.map((file) => URL.createObjectURL(file))]);
  }

  function removeFile(index: number) {
    const url = previews[index];
    // A blob-URL-t kézzel kell elengedni, különben a lap élettartamáig
    // memóriában tartja a képet.
    if (url) URL.revokeObjectURL(url);
    setFiles((current) => current.filter((_, i) => i !== index));
    setPreviews((current) => current.filter((_, i) => i !== index));
  }

  async function save() {
    if (!apiConfigured) {
      setError('A háttérszolgáltatás nincs beállítva, a mentés nem megy.');
      return;
    }

    setStatus('saving');
    setError('');
    try {
      let photos: ActivityPhoto[] = [];
      if (files.length > 0) {
        setProgress(`Kép feltöltése… (1/${files.length})`);
        photos = await uploadActivityPhotos(files, uid, activityId, ({ index, total }) =>
          setProgress(`Kép feltöltése… (${index}/${total})`),
        );
      }

      setProgress('Mentés…');
      await api.updateActivity(activityId, {
        title,
        description,
        ...(photos.length > 0 ? { photos } : {}),
      });

      for (const url of previews) URL.revokeObjectURL(url);
      setStatus('done');
    } catch (err) {
      setStatus('idle');
      setError(
        err instanceof PhotoError || err instanceof Error
          ? err.message
          : 'A mentés nem sikerült.',
      );
    } finally {
      setProgress('');
    }
  }

  if (status === 'done') {
    return (
      <div className="save save--done">
        <p className="save__done">Elmentve.</p>
        <Button size="sm" variant="ghost" onClick={() => navigate(`/aktivitas/${activityId}`)}>
          Megnézem
        </Button>
      </div>
    );
  }

  const saving = status === 'saving';

  return (
    <div className="save">
      <TextField
        label="Név"
        placeholder="Pl. Reggeli kör a Duna-parton"
        value={title}
        maxLength={80}
        onChange={(event) => setTitle(event.target.value)}
        hint="Ha üresen hagyod, a napszak és a mozgásforma adja a nevet."
      />

      <label className="save__field">
        <span className="save__label">Leírás</span>
        <textarea
          className="save__textarea"
          rows={3}
          maxLength={2000}
          placeholder="Milyen volt? Mi történt útközben?"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>

      <div className="save__field">
        <span className="save__label">
          Képek <span className="save__count">{files.length}/{MAX_PHOTOS}</span>
        </span>

        <div className="save__photos">
          {previews.map((url, index) => (
            <div key={url} className="save__thumb">
              <img src={url} alt="" />
              <button
                type="button"
                className="save__thumb-remove"
                aria-label="Kép eltávolítása"
                disabled={saving}
                onClick={() => removeFile(index)}
              >
                ×
              </button>
            </div>
          ))}

          {files.length < MAX_PHOTOS ? (
            <button
              type="button"
              className="save__add"
              disabled={saving}
              onClick={() => fileInput.current?.click()}
            >
              <PlusIcon />
              <span>Kép</span>
            </button>
          ) : null}
        </div>

        <input
          ref={fileInput}
          className="save__file"
          type="file"
          accept="image/*"
          multiple
          onChange={(event) => {
            addFiles(event.target.files);
            // Ugyanazt a fájlt máskor is ki lehessen választani: az input
            // értékét nullázni kell, különben nem tüzel újra a `change`.
            event.target.value = '';
          }}
        />
      </div>

      {error ? (
        <p className="save__error" role="alert">
          {error}
        </p>
      ) : null}

      <Button block onClick={() => void save()} disabled={saving}>
        {saving ? progress || 'Mentés…' : 'Mentés'}
      </Button>
    </div>
  );
}

function PlusIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
