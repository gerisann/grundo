import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CommunityHeader } from '@/components/CommunityHeader';
import { Avatar } from '@/components/ActivityCard';
import { Button, Chip, EmptyState, List, ListRow, TextField, SegmentedControl } from '@/components/ui';
import { api, ApiError, type Banda, type BandaRole, type BandaVisibility, type BandaWithRole } from '@/lib/api';
import '@/screens/search.css';
import '@/screens/discover.css';

const DEBOUNCE_MS = 300;

const ROLE_LABEL: Record<BandaRole, string> = {
  owner: 'Alapító',
  moderator: 'Moderátor',
  member: 'Tag',
};

/**
 * Bandák (docs/02 → Közösség → Bandák, GRUNDO #29).
 *
 * Phase 1: saját bandáim, meghívókóddal csatlakozás, publikus keresés +
 * azonnali csatlakozás, létrehozás. Az appon belüli meghívás (értesítéssel),
 * a hírfolyam, a chat fal és a beállítások Phase 2/3 tárgya — a
 * `BandaScreen` ezekre "hamarosan érkezik" kártyát mutat.
 */
export function CommunityBandasScreen() {
  return (
    <>
      <CommunityHeader active="bandas" />
      <div className="screen-body stack">
        <MyBandas />
        <JoinByCode />
        <CreateBanda />
        <SearchPublicBandas />
      </div>
    </>
  );
}

function MyBandas() {
  const navigate = useNavigate();
  const [items, setItems] = useState<BandaWithRole[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    api.bandas
      .mine()
      .then((result) => {
        if (alive) setItems(result.items);
      })
      .catch((problem: unknown) => {
        if (!alive) return;
        setItems([]);
        setError(problem instanceof ApiError ? problem.message : 'A bandáid most nem tölthetők be.');
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <section className="stack">
      <h2 className="discover-feed__title">Saját bandáim</h2>
      {items === null ? (
        <div className="card">Betöltés…</div>
      ) : error && items.length === 0 ? (
        <div className="card" role="alert">
          {error}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          title="Még nem vagy egy bandában sem"
          description="Csatlakozz meghívókóddal, keress rá egy publikus bandára, vagy hozz létre egy sajátot."
        />
      ) : (
        <List>
          {items.map((banda) => (
            <ListRow
              key={banda.id}
              label={banda.name}
              description={`${banda.memberCount} tag · ${banda.visibility === 'private' ? 'privát' : 'publikus'}`}
              value={<Chip variant={banda.role === 'owner' ? 'accent' : 'default'}>{ROLE_LABEL[banda.role]}</Chip>}
              chevron
              onClick={() => navigate(`/bandak/${banda.id}`)}
            />
          ))}
        </List>
      )}
    </section>
  );
}

function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const trimmed = code.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.bandas.joinByCode(trimmed);
      navigate(`/bandak/${result.bandaId}`);
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A csatlakozás most nem sikerült.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card stack">
      <h2 className="discover-feed__title">Csatlakozás meghívókóddal</h2>
      <div style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'flex-end' }}>
        <div style={{ flex: 1 }}>
          <TextField
            label="Meghívókód"
            placeholder="8 karakter"
            value={code}
            maxLength={8}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
          />
        </div>
        <Button loading={busy} onClick={submit} disabled={!code.trim()}>
          Belépés
        </Button>
      </div>
      {error ? (
        <p className="search__note" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function CreateBanda() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<BandaVisibility>('public');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ banda: Banda; inviteCode: string | null } | null>(null);

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.bandas.create({
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
      });
      setCreated({ banda: result.banda, inviteCode: result.inviteCode });
    } catch (problem) {
      setError(problem instanceof ApiError ? problem.message : 'A létrehozás most nem sikerült.');
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <section className="card stack">
        <h2 className="discover-feed__title">„{created.banda.name}" létrejött</h2>
        {created.inviteCode ? (
          <p>
            Meghívókód: <strong>{created.inviteCode}</strong> — ezt oszd meg azokkal, akiket meg akarsz hívni.
          </p>
        ) : (
          <p>A banda publikus — bárki megtalálja a keresésben, és azonnal csatlakozhat.</p>
        )}
        <Button onClick={() => navigate(`/bandak/${created.banda.id}`)}>Megnyitás</Button>
      </section>
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" block onClick={() => setOpen(true)}>
        + Banda létrehozása
      </Button>
    );
  }

  return (
    <section className="card stack">
      <h2 className="discover-feed__title">Új banda</h2>
      <TextField label="Név" value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
      <TextField
        label="Leírás (nem kötelező)"
        value={description}
        maxLength={300}
        onChange={(event) => setDescription(event.target.value)}
      />
      <SegmentedControl
        label="Láthatóság"
        options={[
          { value: 'public', label: 'Publikus' },
          { value: 'private', label: 'Privát' },
        ]}
        value={visibility}
        onChange={setVisibility}
        block
      />
      {error ? (
        <p className="search__note" role="alert">
          {error}
        </p>
      ) : null}
      <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
        <Button variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
          Mégse
        </Button>
        <Button loading={busy} onClick={submit} disabled={!name.trim()}>
          Létrehozás
        </Button>
      </div>
    </section>
  );
}

function SearchPublicBandas() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Banda[] | null>(null);
  const [error, setError] = useState('');
  const [joinError, setJoinError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setItems(null);
      setError('');
      return;
    }
    let alive = true;
    const timer = window.setTimeout(() => {
      api.bandas
        .search(trimmed)
        .then((result) => {
          if (alive) setItems(result.items);
        })
        .catch((problem: unknown) => {
          if (!alive) return;
          setItems([]);
          setError(problem instanceof ApiError ? problem.message : 'A keresés most nem működik.');
        });
    }, DEBOUNCE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [query]);

  async function join(banda: Banda) {
    if (busyId) return;
    setBusyId(banda.id);
    setJoinError('');
    try {
      await api.bandas.join(banda.id);
      navigate(`/bandak/${banda.id}`);
    } catch (problem) {
      setJoinError(problem instanceof ApiError ? problem.message : 'A csatlakozás most nem sikerült.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="card discover-search">
      <h2 className="discover-feed__title">Publikus bandák keresése</h2>
      <div className="search__field" style={{ marginTop: 'var(--sp-3)' }}>
        <input
          type="search"
          inputMode="search"
          className="search__input"
          placeholder="Banda neve"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Banda keresése"
        />
        {query ? (
          <button type="button" className="search__clear" aria-label="Keresés törlése" onClick={() => setQuery('')}>
            ×
          </button>
        ) : null}
      </div>

      {joinError ? (
        <p className="search__note" role="alert" style={{ margin: 'var(--sp-2) 0' }}>
          {joinError}
        </p>
      ) : null}

      {!query.trim() ? null : items === null ? (
        <p className="search__note">Keresés…</p>
      ) : error && items.length === 0 ? (
        <p className="search__note" role="alert">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="search__note">Nincs ilyen nevű publikus banda.</p>
      ) : (
        <div className="search__list" style={{ marginTop: 'var(--sp-2)' }}>
          {items.map((banda) => (
            <div className="search__row discover-search__row" key={banda.id}>
              <span className="discover-search__identity">
                <Avatar url={banda.photoURL} name={banda.name} size={40} />
                <span className="search__identity">
                  <span className="search__name">{banda.name}</span>
                  <span className="search__note" style={{ margin: 0 }}>
                    {banda.memberCount} tag
                  </span>
                </span>
              </span>
              <Button size="sm" loading={busyId === banda.id} onClick={() => join(banda)}>
                Csatlakozás
              </Button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
