import { ScrollableTabs } from './ScrollableTabs';
import './profileTabs.css';

export type ProfileTab = 'profile' | 'missions' | 'rivals' | 'stats' | 'bandas' | 'badges';

const TABS: { id: ProfileTab; label: string; to: string }[] = [
  { id: 'profile', label: 'Profil', to: '/profil' },
  { id: 'stats', label: 'Statisztika', to: '/profil/statisztikak' },
  { id: 'missions', label: 'Küldetések', to: '/kuldetesek' },
  { id: 'rivals', label: 'Riválisok', to: '/profil/rivalisok' },
  { id: 'bandas', label: 'Bandák', to: '/profil/bandak' },
  { id: 'badges', label: 'Badgek', to: '/profil/badgek' },
];

export function ProfileTabs({ active }: { active: ProfileTab }) {
  return <ScrollableTabs tabs={TABS} active={active} ariaLabel="Profil fülek" />;
}
