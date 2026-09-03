import type { ReactNode } from 'react';
import { CommunityHeader } from '@/components/CommunityHeader';
import type { CommunityTab } from '@/components/CommunityTabs';

function Shell({ active, children }: { active: CommunityTab; children: ReactNode }) {
  return (
    <>
      <CommunityHeader active={active} />
      <div className="screen-body stack">{children}</div>
    </>
  );
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

export function CommunityChallengesScreen() {
  return (
    <Shell active="challenges">
      <Planned
        title="A kihívások hamarosan érkeznek"
        text="Időszakos, admin által kiírt feladatok — távolság, terület, lopás, sorozat, felfedezés — kártyás listája és a haladásod itt jelenik majd meg."
      />
    </Shell>
  );
}

export function CommunityPassportScreen() {
  return (
    <Shell active="passport">
      <Planned
        title="Az útlevél hamarosan érkezik"
        text="0 / 242 ország zászlórácsa, ország-lapokkal — mikor jártál ott, hány aktivitás és mennyi terület."
      />
    </Shell>
  );
}
