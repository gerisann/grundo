import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar } from '@/components/ActivityCard';
import { BandaRoleChip } from '@/components/BandaRoleChip';
import { ProfileHeader } from '@/components/ProfileHeader';
import { RivalsSheet } from '@/components/RivalsSheet';
import { BadgeList } from '@/components/BadgeList';
import { Button, EmptyState, List, ListRow } from '@/components/ui';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, ApiError, type BandaWithRole } from '@/lib/api';
import type { ReactNode } from 'react';

function Shell({
  active,
  children,
}: {
  active: 'rivals' | 'stats' | 'bandas' | 'badges';
  children: ReactNode;
}) {
  return (
    <>
      <ProfileHeader active={active} />
      <div className="screen-body stack">
        {children}
      </div>
    </>
  );
}

export function ProfileRivalsScreen() {
  return <Shell active="rivals"><RivalsSheet embedded /></Shell>;
}

function Planned({ title, text }: { title: string; text: string }) {
  return (
    <section className="card empty">
      <div className="empty__icon" aria-hidden="true">⬡</div>
      <h2 className="empty__title">{title}</h2>
      <p className="empty__text">{text}</p>
    </section>
  );
}

export function ProfileStatsScreen() {
  return (
    <Shell active="stats">
      <Planned title="A statisztikáid itt kapnak helyet" text="Távok, tempó, GP, területszerzés és fejlődési trendek kerülnek majd erre a fülre." />
    </Shell>
  );
}

export function ProfileBadgesScreen() {
  const { profile } = useProfile();
  return (
    <Shell active="badges">
      <section className="card">
        <BadgeList badges={profile?.badges ?? []} />
      </section>
    </Shell>
  );
}

/**
 * A profil BANDÁK füle — a klán-helyőrző helyén.
 *
 * A klán sosem valósult meg; a bandák viszont igen, és a felhasználó itt
 * keresi, melyikben van benne. A lista ugyanaz, mint a Közösség →
 * Bandák „Saját bandáim" szakasza; innen csak megnyitni lehet őket,
 * létrehozni és csatlakozni továbbra is ott.
 */
export function ProfileBandasScreen() {
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
    <Shell active="bandas">
      {items === null ? (
        <div className="card">Betöltés…</div>
      ) : error && items.length === 0 ? (
        <div className="card" role="alert">{error}</div>
      ) : items.length === 0 ? (
        <>
          <EmptyState
            title="Még nem vagy egy bandában sem"
            description="A Közösség → Bandák oldalon csatlakozhatsz egy publikus bandához, léphetsz be meghívókóddal, vagy alapíthatsz sajátot."
          />
          <Button block onClick={() => navigate('/kozosseg/bandak')}>Bandák böngészése</Button>
        </>
      ) : (
        <List>
          {items.map((banda) => (
            <ListRow
              key={banda.id}
              label={banda.name}
              description={`${banda.memberCount} tag · ${banda.visibility === 'private' ? 'privát' : 'publikus'}`}
              leading={<Avatar url={banda.photoURL} name={banda.name} size={40} />}
              value={<BandaRoleChip role={banda.role} />}
              chevron
              onClick={() => navigate(`/bandak/${banda.id}`)}
            />
          ))}
        </List>
      )}
    </Shell>
  );
}
