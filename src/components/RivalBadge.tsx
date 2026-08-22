import { useRivals } from '@/hooks/RivalProvider';
import './rivalBadge.css';

/**
 * „RIVÁLIS" címke egy felhasználónév mellé.
 *
 * A komponens MAGA DÖNTI EL, kell-e — a hívónak elég az uid-et átadnia, nem
 * kell a rivális-halmazt ismernie. Így egy névsor bővítése egyetlen sor, és
 * nem lehet elfelejteni a feltételt.
 *
 * ⚠️ AZ `aria-label` NEM ISMÉTLI a szöveget: a képernyőolvasó egyébként
 * „RIVÁLIS"-t mondana, ami magában nem mond semmit a név mellett. A teljes
 * mondat („rivális játékos") érthetőbb.
 */
export function RivalBadge({ uid }: { uid: string | null | undefined }) {
  const { isRival } = useRivals();
  if (!isRival(uid)) return null;
  return (
    <span className="rival-badge" aria-label="rivális játékos">
      RIVÁLIS
    </span>
  );
}
