/**
 * A négy küldetés-karakter közös leírása — címke, szín-hangnem, terület-sor.
 *
 * Külön fájlban, mert a Küldetések képernyő ÉS a Mentett útvonalak lap is
 * ugyanezt rajzolja ki. Egy helyen tartva nem mehet szét a kettő (pl. ha egy
 * címke megváltozik, csak itt kell).
 */

import { GAMEPLAY } from '@/config/gameplay';
import type { Mission } from './api';
import { formatArea } from './format';

export const MISSION_KIND_META: Record<Mission['kind'], { label: string; tone: string }> = {
  conquest: { label: 'Hódítás', tone: 'conquest' },
  raid: { label: 'Rajtaütés', tone: 'raid' },
  fortify: { label: 'Erősítés', tone: 'fortify' },
  explore: { label: 'Felfedezés', tone: 'explore' },
};

/**
 * A terület-rovat KARAKTERENKÉNT MÁST mér.
 *
 * Az erősítésnél a szerzett terület per definíció NULLA — a cellák már a
 * tieid, csak a védelmük nő. „Terület: 0,000 km²" ott hibásnak látszana,
 * pedig a küldetésnek épp az a lényege, hogy a MEGLÉVŐ grundodat erősíted.
 * Ezért ott a megerősített területet mutatjuk, saját felirattal.
 */
export function missionAreaStat(mission: Mission): { label: string; value: string } {
  if (mission.kind === 'fortify') {
    const cells = mission.counts?.reclaimed ?? 0;
    return { label: 'Megerősített', value: formatArea(cells * GAMEPLAY.CELL_AREA_M2) };
  }
  return { label: 'Új terület', value: formatArea(mission.areaM2) };
}
