import { Chip } from '@/components/ui';
import type { BandaRole } from '@/lib/api';

const ROLE_LABEL: Record<BandaRole, string> = {
  owner: 'Alapító',
  moderator: 'Moderátor',
  member: 'Tag',
};

/**
 * A rang színe: az alapító ARANY, a moderátor LILA, a tag semleges.
 *
 * Egy helyen, mert a rang négy képernyőn jelenik meg (banda oldal,
 * tagmodális, saját bandáim, beállítások) — külön-külön írva előbb-utóbb
 * elcsúsznának egymástól.
 */
export function BandaRoleChip({ role }: { role: BandaRole }) {
  const variant = role === 'owner' ? 'gold' : role === 'moderator' ? 'accent' : 'default';
  return <Chip variant={variant}>{ROLE_LABEL[role]}</Chip>;
}
