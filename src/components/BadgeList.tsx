import { BADGES_BY_ID, type BadgeDef } from '@/game/badges';
import { EmptyState } from '@/components/ui';
import type { EarnedBadge } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import './badgeList.css';

/**
 * Megszerzett jelvények — pill-lista, a profilra.
 *
 * A NÉV, LEÍRÁS ÉS RITKASÁG a `src/game/badges.ts` katalógusból jön, ami a
 * szerverrel közös kód — a szerver csak `{id, earnedAt}`-et küld (lásd
 * `server/src/lib/badges.ts` → `toEarnedBadges`).
 *
 * Egy jelvény kimarad, ha az azonosítója nincs a katalógusban. Ez csak akkor
 * fordulhat elő, ha egy jelvényt visszavontak a kódból egy már kiosztott
 * kiosztás után — inkább hallgat el csendben, mint hogy egy névtelen,
 * leírás nélküli chip-et mutasson.
 */
export function BadgeList({
  badges,
  hideEmpty = false,
}: {
  badges: EarnedBadge[];
  /**
   * Idegen profilnál `true`: ha nincs jelvénye, egyszerűen nincs mit mutatni
   * — az „Még nincs jelvényed" felszólítás a SAJÁT profilon értelmes
   * cselekvésre hív, máséin csak zavaró lenne.
   */
  hideEmpty?: boolean;
}) {
  const resolved: { def: BadgeDef; earnedAt: number }[] = badges
    .map((earned) => {
      const def = BADGES_BY_ID.get(earned.id);
      return def ? { def, earnedAt: earned.earnedAt } : null;
    })
    .filter((entry): entry is { def: BadgeDef; earnedAt: number } => entry !== null)
    .sort((a, b) => b.earnedAt - a.earnedAt);

  if (resolved.length === 0) {
    if (hideEmpty) return null;
    return <EmptyState title="Még nincs jelvényed" description="Mozogj, foglalj területet, és az első jelvényed hamarosan megérkezik." />;
  }

  return (
    <ul className="badges" aria-label="Jelvények">
      {resolved.map(({ def, earnedAt }) => (
        <li
          key={def.id}
          className={`badge badge--${def.tier}`}
          title={`${def.description} — megszerezve: ${formatDateTime(earnedAt)}`}
        >
          <span className="badge__dot" aria-hidden="true" />
          <span className="badge__name">{def.name}</span>
        </li>
      ))}
    </ul>
  );
}
