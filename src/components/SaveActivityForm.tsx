import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, TextField } from '@/components/ui';
import {
  deleteActivityPhotos,
  MAX_PHOTOS,
  PhotoError,
  uploadActivityPhotos,
} from '@/lib/photos';
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
interface SaveActivityFormProps {
  activityId: string;
  uid: string;
  initialTitle?: string;
  initialDescription?: string;
  initialPhotos?: ActivityPhoto[];
  onSaved?: () => void;
}

export function SaveActivityForm({
  activityId,
  uid,
  initialTitle = '',
  initialDescription = '',
  initialPhotos = [],
  onSaved,
}: SaveActivityFormProps) {
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [keptPhotos, setKeptPhotos] = useState<ActivityPhoto[]>(initialPhotos);
  const [removedPaths, setRemovedPaths] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const previewUrls = useRef<string[]>([]);
  previewUrls.current = previews;

  const [status, setStatus] = useState<'idle' | 'saving' | 'done'>('idle');
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
  }, []);

  function addFiles(picked: FileList | null) {
    if (!picked || picked.length === 0) return;
    setError('');

    const room = MAX_PHOTOS - keptPhotos.length - files.length;
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

  function removeStoredPhoto(index: number) {
    const photo = keptPhotos[index];
    if (!photo) return;
    setKeptPhotos((current) => current.filter((_, i) => i !== index));
    setRemovedPaths((current) => [...current, photo.path]);
  }

  async function save() {
    if (!apiConfigured) {
      setError('A háttérszolgáltatás nincs beállítva, a mentés nem megy.');
      return;
    }

    setStatus('saving');
    setError('');
    try {
      let uploaded: ActivityPhoto[] = [];
      if (files.length > 0) {
        setProgress(`Kép feltöltése… (1/${files.length})`);
        uploaded = await uploadActivityPhotos(files, uid, activityId, ({ index, total }) =>
          setProgress(`Kép feltöltése… (${index}/${total})`),
        );
      }

      const photos = [...keptPhotos, ...uploaded];

      setProgress('Mentés…');
      await api.updateActivity(activityId, {
        title,
        description,
        photos,
      });

      await deleteActivityPhotos(removedPaths);

      for (const url of previews) URL.revokeObjectURL(url);
      setStatus('done');
      onSaved?.();
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

  if (status === 'done' && !onSaved) {
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
      {/*
        A MEZŐK GÖRGETHETŐK, A GOMB NEM.

        Rögzítés után ez az űrlap a képernyőt kitöltő panelben ül
        (`.track__panel--upload`), és a magassága a fotósortól függ: hat kép
        mellett hosszabb, mint a képernyő. Ha az egész egy dobozban lenne, a
        Mentés gomb kicsúszna a kép aljáról — ezért a törzs görget, a gombsor
        pedig a doboz alján marad.

        Beágyazva (aktivitás szerkesztése) ez a szerkezet nem változtat
        semmin: ott a törzs nem kap külön görgetést, a lap görget, mint eddig.
      */}
      <div className="save__body">
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
            Képek{' '}
            <span className="save__count">{keptPhotos.length + files.length}/{MAX_PHOTOS}</span>
          </span>

          <div className="save__photos">
            {keptPhotos.map((photo, index) => (
              <div key={photo.path} className="save__thumb">
                <img src={photo.url} alt="" />
                <button
                  type="button"
                  className="save__thumb-remove"
                  aria-label="Kép eltávolítása"
                  disabled={saving}
                  onClick={() => removeStoredPhoto(index)}
                >
                  ×
                </button>
              </div>
            ))}

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

            {keptPhotos.length + files.length < MAX_PHOTOS ? (
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
      </div>

      {/* A hiba a gomb FÖLÖTT, a nem görgő sávban: különben a felhasználó
          megnyomja a Mentést, és a magyarázat a kép alatt marad. */}
      <div className="save__actions">
        {error ? (
          <p className="save__error" role="alert">
            {error}
          </p>
        ) : null}

        <Button block onClick={() => void save()} disabled={saving}>
          {saving ? progress || 'Mentés…' : 'Mentés'}
        </Button>
      </div>
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
