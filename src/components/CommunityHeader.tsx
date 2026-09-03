import { CommunityTabs, type CommunityTab } from './CommunityTabs';
import './communityHeader.css';

export function CommunityHeader({ active }: { active: CommunityTab }) {
  return (
    <div className="community-header">
      <header className="screen-header">
        <h1 className="screen-header__title">Közösség</h1>
      </header>
      <CommunityTabs active={active} />
    </div>
  );
}
