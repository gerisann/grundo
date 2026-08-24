import type { CSSProperties } from 'react';
import { Avatar } from '@/components/ActivityCard';
import { RivalScore } from '@/components/RivalScore';
import { useInView } from '@/hooks/useInView';
import type { Rival } from '@/lib/api';
import './rivalRow.css';

/**
 * Egy rivális sora a teljes listában: két sáv, közöttük villám.
 *
 * A SOR EGY MÉRLEG KÉPE. A bal, lila sáv a tőle SZERZETT, a jobb, korall sáv a
 * neki VESZTETT mezőket mutatja; a kettő találkozási pontja — ahol a villám
 * csap le — a tényleges arány. Az avatár ugyanezen a ponton áll, tehát a
 * profilkép helyzete önmagában elárulja, ki áll nyerésre.
 *
 * ⚠️ A SÁVOK ARÁNYA VALÓS, NEM KOZMETIKA. A `--rival-gained` a szerzett mezők
 * részaránya. Szélsőséges esetben (csak vesztés) a villám a sor bal szélére
 * szorul és szinte teljesen kifut a képből — ez így helyes: a sor ilyenkor
 * végig korall. Ne „szépítsük meg” egy alsó/felső korláttal, mert azzal a kép
 * mást mondana, mint a számok.
 *
 * ⚠️ AZ ANIMÁCIÓ AKKOR INDUL, AMIKOR A SOR LÁTSZIK. Nem a betöltéskor: egy
 * hosszú listán az alsó sorok addigra lefutnának, mire a felhasználó odaér, és
 * ő csak kész, mozdulatlan sorokat találna. A `--live` osztály billenti át
 * mindkét oldalt — a CSS-animációkat és a számok pörgetését egyszerre —, hogy
 * a kettő ne csússzon szét.
 */
export function RivalRow({ rival, onOpen }: { rival: Rival; onOpen: () => void }) {
  // A sáv 120 pixerrel a képernyő alatt már „élesedik”, hogy a görgetés
  // közben ne a felhasználó szeme előtt kapcsoljon be.
  const { ref, inView } = useInView<HTMLButtonElement>({ rootMargin: '120px 0px' });

  // A nevező nulla is lehet (rivális esemény nélkül nem jönne létre, de a
  // védelem olcsó) — a `max(1, …)` osztás helyett 50%-os felezést ad.
  const total = Math.max(1, rival.gainedCells + rival.lostCells);
  const gained = Math.round((rival.gainedCells / total) * 100);

  return (
    <button
      ref={ref}
      type="button"
      className={`conn__row rival-row${inView ? ' rival-row--live' : ''}`}
      style={{ '--rival-gained': `${gained}%` } as CSSProperties}
      onClick={onOpen}
    >
      <span className="rival-row__bars" aria-hidden="true">
        <span className="rival-row__bar rival-row__bar--gain" />
        <span className="rival-row__bar rival-row__bar--loss" />
      </span>

      {/*
        A villám a két sáv VARRATÁN fut, ugyanazon a törtvonalon, amivel a
        korall sáv `clip-path`-ja kezdődik (`rivalRow.css`). Ha az egyiket
        átszabod, a másikat is át kell — különben a fénylő vonal elcsúszik a
        színhatártól. A `viewBox` 28×100, a `preserveAspectRatio="none"`
        magasságban nyújtja; a vonalvastagságot a `non-scaling-stroke` tartja.
      */}
      <svg
        className="rival-row__bolt"
        viewBox="0 0 28 100"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline points="24,0 12,44 24,44 8,100" vectorEffect="non-scaling-stroke" />
      </svg>

      <span className="rival-row__identity">
        <Avatar url={rival.photoURL} name={rival.username} size={44} />
        <span className="conn__name">{rival.username}</span>
      </span>

      <RivalScore rival={rival} countUp={inView} />
    </button>
  );
}
