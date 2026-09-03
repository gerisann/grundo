import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { BandaFeedWall } from '@/components/BandaFeedWall';
import { BandaInviteSheet } from '@/components/BandaInviteSheet';
import { Button, Chip, EmptyState, List, ListRow, ScreenHeader } from '@/components/ui';
import {
  api,
  ApiError,
  canInvite,
  type Banda,
  type BandaMember,
  type BandaRole,
  type BandaSettings,
} from '@/lib/api';
import { formatArea } from '@/lib/format';

const ROLE_LABEL: Record<BandaRole, string> = {
  owner: 'Alapító',
  moderator: 'Moderátor',
  member: 'Tag',
};

const hu = new Intl.NumberFormat('hu-HU');

/**
 * Egy banda részletei (GRUNDO #29 Phase 1 → #30 Phase 2 folytatás).
 *
 * Nincs a Közösség-fülsor alatt — önálló képernyő, saját fejléccel, mint a
 * `/profil/rivalisok`. A hírfolyam és a chat fal (`BandaFeedWall`) és a
 * meghívás (`BandaInviteSheet`) itt élnek. Az alapító jobb felül a
 * fogaskerékkel jut a külön Phase 3 beállítás- és tagkezelő képernyőre.
 */
export function BandaScreen() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [banda, setBanda] = useState<Banda | null>(null);
  const [role, setRole] = useState<BandaRole | null>(null);
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [settings, setSettings] = useState<BandaSettings | null>(null);
  const [members, setMembers] = useState<BandaMember[] | null>(null);
  const [error, setError] = useState('');
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setError('');
    api.bandas
      .detail(id)
      .then((result) => {
        if (!alive) return;
        setBanda(result.banda);
        setRole(result.role);
        setInviteCode(result.inviteCode);
        setSettings(result.settings);
      })
      .catch((problem: unknown) => {
        if (!alive) return;
        setError(problem instanceof ApiError ? problem.message : 'A banda most nem tölthető be.');
      });
    api.bandas
      .members(id)
      .then((result) => {
        if (alive) setMembers(result.items);
      })
      .catch(() => {
        if (alive) setMembers([]);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const memberIds = useMemo(() => new Set((members ?? []).map((member) => member.uid)), [members]);

  if (error) {
    return (
      <>
        <ScreenHeader title="Banda" backTo="/kozosseg/bandak" />
        <div className="screen-body stack">
          <div className="card" role="alert">
            {error}
          </div>
        </div>
      </>
    );
  }

  if (!banda) {
    return (
      <>
        <ScreenHeader title="Banda" backTo="/kozosseg/bandak" />
        <div className="screen-body stack">
          <div className="card">Betöltés…</div>
        </div>
      </>
    );
  }

  return (
    <>
      <ScreenHeader
        title={banda.name}
        backTo="/kozosseg/bandak"
        action={role === 'owner' && id ? (
          <button
            type="button"
            className="screen-header__back"
            aria-label="Banda beállításai"
            onClick={() => navigate(`/bandak/${encodeURIComponent(id)}/beallitasok`)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21h-4v-.09A1.7 1.7 0 0 0 8.95 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3v-4h.09A1.7 1.7 0 0 0 4.6 8.95a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 8.95 4.6 1.7 1.7 0 0 0 9.97 3.04V3h4v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 8.95a1.7 1.7 0 0 0 1.56 1.03H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
            </svg>
          </button>
        ) : undefined}
      />
      <div className="screen-body stack">
        <section className="card stack">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-3)' }}>
            <Avatar url={banda.photoURL} name={banda.name} size={56} />
            <div className="stack" style={{ gap: 4 }}>
              <strong>{banda.name}</strong>
              <span className="search__note" style={{ margin: 0 }}>
                {hu.format(banda.memberCount)} tag
              </span>
            </div>
            <Chip variant={banda.visibility === 'private' ? 'default' : 'success'}>
              {banda.visibility === 'private' ? 'Privát' : 'Publikus'}
            </Chip>
          </div>
          {banda.description ? <p>{banda.description}</p> : null}
          {role && inviteCode ? (
            <p>
              Meghívókód: <strong>{inviteCode}</strong>
            </p>
          ) : null}
        </section>

        <section className="card stack">
          <h2 className="discover-feed__title">Terület</h2>
          <List>
            <ListRow label="Ma" value={formatArea(sumFootBike(banda.totals.areaDayM2))} />
            <ListRow label="Ezen a héten" value={formatArea(sumFootBike(banda.totals.areaWeekM2))} />
            <ListRow label="Ebben a hónapban" value={formatArea(sumFootBike(banda.totals.areaMonthM2))} />
            <ListRow label="Mindenkori" value={formatArea(sumFootBike(banda.totals.areaM2))} />
          </List>
          <h2 className="discover-feed__title">GP</h2>
          <List>
            <ListRow label="Ezen a héten" value={hu.format(banda.totals.gpWeek)} />
            <ListRow label="Ebben a hónapban" value={hu.format(banda.totals.gpMonth)} />
            <ListRow label="Mindenkori" value={hu.format(banda.totals.gpTotal)} />
          </List>
        </section>

        <section className="stack">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-2)' }}>
            <h2 className="discover-feed__title" style={{ margin: 0 }}>
              Tagok
            </h2>
            {role && settings && canInvite(role, settings.whoCanInvite) ? (
              <Button size="sm" variant="secondary" onClick={() => setInviteSheetOpen(true)}>
                Meghívás
              </Button>
            ) : null}
          </div>
          {members === null ? (
            <div className="card">Betöltés…</div>
          ) : (
            <List>
              {members.map((member) => (
                <ListRow
                  key={member.uid}
                  label={member.username}
                  value={<Chip variant={member.role === 'owner' ? 'accent' : 'default'}>{ROLE_LABEL[member.role]}</Chip>}
                />
              ))}
            </List>
          )}
        </section>

        {role && settings ? (
          <BandaFeedWall bandaId={id ?? ''} canPostFeed={canInvite(role, settings.postPermission)} />
        ) : (
          <EmptyState
            title="Csak tagoknak"
            description="A hírfolyam és a chat fal csak a banda tagjainak látszik — csatlakozz, hogy megnézhesd."
          />
        )}
      </div>

      {inviteSheetOpen && id ? (
        <BandaInviteSheet bandaId={id} memberIds={memberIds} onClose={() => setInviteSheetOpen(false)} />
      ) : null}
    </>
  );
}

function sumFootBike(area: { foot: number; bike: number }): number {
  return area.foot + area.bike;
}
