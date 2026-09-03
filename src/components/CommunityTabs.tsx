import { ScrollableTabs } from './ScrollableTabs';

export type CommunityTab = 'discover' | 'clubs' | 'challenges' | 'passport';

const TABS: { id: CommunityTab; label: string; to: string }[] = [
  { id: 'discover', label: 'Felfedezés', to: '/kozosseg' },
  { id: 'clubs', label: 'Klubok', to: '/kozosseg/klubok' },
  { id: 'challenges', label: 'Kihívások', to: '/kozosseg/kihivasok' },
  { id: 'passport', label: 'Útlevél', to: '/kozosseg/utlevel' },
];

export function CommunityTabs({ active }: { active: CommunityTab }) {
  return <ScrollableTabs tabs={TABS} active={active} ariaLabel="Közösség fülek" />;
}
