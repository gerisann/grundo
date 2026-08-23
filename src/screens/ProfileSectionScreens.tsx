import { ProfileTabs } from '@/components/ProfileTabs';
import { RivalsSheet } from '@/components/RivalsSheet';
import { BadgeList } from '@/components/BadgeList';
import { useProfile } from '@/hooks/ProfileProvider';
import type { ReactNode } from 'react';

function Shell({
  active,
  title,
  children,
}: {
  active: 'rivals' | 'stats' | 'clans' | 'badges';
  title: string;
  children: ReactNode;
}) {
  return (
    <>
      <header className="screen-header"><h1 className="screen-header__title">{title}</h1></header>
      <div className="screen-body stack">
        <ProfileTabs active={active} />
        {children}
      </div>
    </>
  );
}

export function ProfileRivalsScreen() {
  return <Shell active="rivals" title="Riválisok"><RivalsSheet embedded /></Shell>;
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
    <Shell active="stats" title="Statisztika">
      <Planned title="A statisztikáid itt kapnak helyet" text="Távok, tempó, GP, területszerzés és fejlődési trendek kerülnek majd erre a fülre." />
    </Shell>
  );
}

export function ProfileBadgesScreen() {
  const { profile } = useProfile();
  return (
    <Shell active="badges" title="Badges">
      <section className="card">
        <BadgeList badges={profile?.badges ?? []} />
      </section>
    </Shell>
  );
}

export function ProfileClansScreen() {
  return (
    <Shell active="clans" title="Klánok">
      <Planned title="A klánok hamarosan érkeznek" text="Itt tudsz majd klánt létrehozni, csatlakozni és követni a közös grundotokat." />
    </Shell>
  );
}
