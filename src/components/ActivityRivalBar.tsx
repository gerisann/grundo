import type { CSSProperties } from 'react';
import { Avatar } from '@/components/ActivityCard';
import { useInView } from '@/hooks/useInView';
import { formatNumber } from '@/lib/format';
import type { FeedActivity } from '@/lib/api';
import './activityRivalBar.css';

/**
 * Az aktivitás-kártya alján futó rivális-sáv.
 *
 * UGYANAZ A KÉP, MINT A RIVÁLIS-SOR, csak fele olyan magas és EGYETLEN
 * aktivitásról szól — nem a teljes, halmozott rivalitásról. A két oldal:
 *
 *   lila  (bal)  — amit SZABAD FÖLDRŐL szerzett a kör
 *   korall (jobb) — amit MÁS JÁTÉKOSTÓL vett el
 *
 * A villám a kettő varratán csap le, és ott áll annak a játékosnak a képe,
 * akitől a LEGTÖBBET vette el. Ha többektől is lopott, a többiek apró
 * jelvényként sorakoznak a fő kép jobb alsó sarkában (Geri, 2026-08-26).
 *
 * ⚠️ A `reclaimed` NEM RÉSZE EGYIK OLDALNAK SEM. A saját, már birtokolt
 * cella újbóli bejárása védelmet épít, de nem növeli a területet — a motor
 * is így számol. Ha beleszámítanánk a lila oldalba, a sáv többet mutatna,
 * mint amennyivel a grund ténylegesen nőtt.
 *
 * ⚠️ NEM JELENIK MEG, HA NULLA MEZŐT SZERZETT. Ilyen a be nem zárt kör: a
 * kártya lábléce amúgy is kiírja, hogy „nincs új terület", egy üres mérőszalag
 * „+0"-val csak zaj lenne.
 *
 * A RÉGI AKTIVITÁSOK IS MEGJELENNEK. A `claimCounts` mezőt a mentés csak
 * 2026-08-26 óta írja, de a bontás visszamenőleg is PONTOSAN ismert: a
 * károsultak a `territoryEvents` történetből jönnek (a
 * `backfill:activity-rivals` szkript tölti vissza őket a `stolenFrom`-ba), a
 * szerzett mezők száma pedig az `areaGainedM2`-ből, ami definíció szerint
 * `cellák × CELL_AREA_M2`. Ez nem becslés és nem újraszámolás — a szerver
 * mindkét adatot leírta a mentés pillanatában. Részletek:
 * `server/src/scripts/backfillActivityRivals.ts`.
 */
export function ActivityRivalBar({ item }: { item: FeedActivity }) {
  // A sáv az aktivitás-kártya alján ül, tehát jellemzően a képernyő alsó
  // pereme alól görgetve érkezik — 120 px ráhagyással már „éles", mire
  // odaér a szem.
  const { ref, inView } = useInView<HTMLDivElement>({ rootMargin: '120px 0px' });

  if (item.cellsGained <= 0) return null;

  const stolen = Math.min(item.cellsStolen, item.cellsGained);
  const fromFreeGround = item.cellsGained - stolen;
  const gainedShare = Math.round((fromFreeGround / item.cellsGained) * 100);

  const [mainVictim, ...otherVictims] = item.victims;

  return (
    <div
      ref={ref}
      className={`arival${inView ? ' arival--live' : ''}`}
      style={{ '--rival-gained': `${gainedShare}%` } as CSSProperties}
    >
      <span className="arival__bars" aria-hidden="true">
        <span className="arival__bar arival__bar--gain" />
        <span className="arival__bar arival__bar--loss" />
      </span>

      {/*
        A villám a két sáv VARRATÁN fut, ugyanazon a törtvonalon, amivel a
        korall sáv `clip-path`-ja kezdődik (`activityRivalBar.css`). A kettőt
        együtt kell módosítani, különben a fénylő vonal elcsúszik a
        színhatártól. Lopás nélkül nincs varrat, tehát villám sincs.
      */}
      {stolen > 0 ? (
        <svg
          className="arival__bolt"
          viewBox="0 0 20 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline points="17,0 8,44 17,44 5,100" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : null}

      {mainVictim ? (
        <span className="arival__victim">
          <Avatar url={mainVictim.photoURL} name={mainVictim.username} size={30} />
          {otherVictims.length > 0 ? (
            <span className="arival__others" aria-hidden="true">
              {otherVictims.map((victim) => (
                <Avatar
                  key={victim.uid}
                  url={victim.photoURL}
                  name={victim.username}
                  size={14}
                />
              ))}
            </span>
          ) : null}
        </span>
      ) : null}

      {/* A megszerzett mezők — ugyanaz a pirula, mint jobbra a szorzó. */}
      <span className="arival__stat arival__stat--gain" aria-hidden="true">
        +{formatNumber(item.cellsGained)}
        <HexIcon />
      </span>

      {item.victims.length > 0 ? (
        <span className="arival__stat arival__stat--rivals" aria-hidden="true">
          {item.victims.length}×
        </span>
      ) : null}

      {/*
        A látható részek `aria-hidden`-ek: külön-külön felolvasva („+24",
        „2×", egy avatár) semmit nem mondanának. Helyettük egy összefüggő
        mondat megy ki.
      */}
      <span className="arival__sr">{summary(item, stolen, fromFreeGround)}</span>
    </div>
  );
}

function summary(item: FeedActivity, stolen: number, fromFreeGround: number): string {
  const total = `${item.cellsGained} megszerzett mező`;
  if (stolen === 0) return `${total}, mind szabad területről.`;

  const names = item.victims.map((victim) => `${victim.username} (${victim.cells})`).join(', ');
  return `${total}: ${fromFreeGround} szabad területről, ${stolen} más játékostól — ${names}.`;
}

/** Csak szegély, fehéren — a szöveggel egy magas. */
function HexIcon() {
  return (
    <svg
      className="arival__hex"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" />
    </svg>
  );
}
