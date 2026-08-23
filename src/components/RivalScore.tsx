import { formatArea, formatNumber } from '@/lib/format';
import type { Rival } from '@/lib/api';
import './rivalScore.css';

/**
 * Egy rivális mérlege: összecsapások, terület és cellamérleg.
 *
 * A fő szám a kicserélt mezők száma — ez a rangsor alapja is. Utána kisebb
 * betűvel, zölddel a szerzett, pirossal a vesztett (Geri, 2026-08-22).
 *
 * ⚠️ MEZŐ, NEM km². Az itteni számok jellemzően néhány tucat mezőt jelentenek,
 * ami km²-ben „0,000"-ként jelenne meg (egy hexagon 307 m², a `formatArea`
 * három tizedese ezer m²-es felbontás). A mérleg pont az apró különbségekről
 * szól, ezért itt a mezőszám a beszédes mérték — a km² a küldetés-kártyákon és
 * a profilon marad, ahol nagyságrendekről van szó.
 *
 * ⚠️ A `+` ÉS `−` JEL NEM DÍSZ. A két szám külön-külön is olvasható színek
 * nélkül — színvakon és fekete-fehér képernyőn is eldönthető, melyik a
 * szerzett és melyik a vesztett.
 */
export function RivalScore({ rival }: { rival: Rival }) {
  const encounters = rival.gainedEvents + rival.lostEvents;
  return (
    <span className="rival-score">
      <span className="rival-score__total">{formatNumber(encounters)}×</span>
      <span className="rival-score__area">{formatArea(rival.exchangedM2)}</span>
      <span className="rival-score__split">
        <span className="rival-score__gained">+{formatNumber(rival.gainedCells)}</span>
        <span className="rival-score__lost">−{formatNumber(rival.lostCells)}</span>
      </span>
      <span className="rival-score__sr">
        {`${encounters} összecsapás, ${formatArea(rival.exchangedM2)} gazdát cserélt terület: ${rival.gainedCells} szerzett, ${rival.lostCells} vesztett mező`}
      </span>
    </span>
  );
}
