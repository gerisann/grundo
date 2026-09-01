import type { CSSProperties, ReactNode } from 'react';
import { Avatar } from '@/components/ActivityCard';
import { RivalScore } from '@/components/RivalScore';
import { useInView } from '@/hooks/useInView';
import { cellColorHexOrNull } from '@/lib/cellColors';
import type { ActivityAuthor, Rival } from '@/lib/api';
// A `.conn__row` (szélesség + flex alap) innen jön — enélkül a gomb a saját
// tartalmára zsugorodik, mert minden gyereke abszolút pozicionált.
import './connectionsSheet.css';
import './rivalRow.css';

/**
 * Egy rivális sora: két sáv, közöttük villám.
 *
 * A SOR EGY MÉRLEG KÉPE. A bal, lila sáv a tőle SZERZETT, a jobb, korall sáv a
 * neki VESZTETT mezőket mutatja; a kettő találkozási pontja — ahol a villám
 * csap le — a tényleges arány. Az avatár ugyanezen a ponton áll, tehát a
 * profilkép helyzete önmagában elárulja, ki áll nyerésre.
 *
 * ⚠️ EGYETLEN KOMPONENS HÁROM HELYEN: a teljes rivális-listán
 * (`/profil/rivalisok`), a profil TOP 3 szekciójában, és tömörítve az
 * aktivitás-kártyák alján. Geri kifejezetten kérte (2026-08-26), hogy a
 * kártyán is UGYANEZ a mérleg álljon, ugyanazokkal a halmozott számokkal —
 * ne egy hasonlító, de mást jelentő sáv. Ha ez a fájl változik, mind a három
 * hely változik vele; ez a lényeg, nem mellékhatás.
 *
 * ⚠️ A SÁVOK ARÁNYA VALÓS, NEM KOZMETIKA. A `--rival-gained` a szerzett mezők
 * részaránya. Szélsőséges esetben (csak vesztés) a villám a sor bal szélére
 * szorul és szinte teljesen kifut a képből — ez így helyes: a sor ilyenkor
 * végig korall. Ne „szépítsük meg” egy alsó/felső korláttal, mert azzal a kép
 * mást mondana, mint a számok.
 *
 * ⚠️ AZ AVATÁR VISZONT IGENIS BEHÚZÓDIK. A profilkép sosem megy közelebb a
 * sor széléhez, mint a saját méretének a KÉTSZERESE (`--rival-avatar-gap`) —
 * Geri kérése (2026-08-26). Ez NEM mond ellent a fentinek: a SÁVOK és a villám
 * a valós arányt tartják, csak az arckép húzódik beljebb, hogy látszódjon. A
 * kettő szándékosan válik el szélsőséges aránynál.
 *
 * ⚠️ A KORLÁT PIXELBEN VAN, NEM SZÁZALÉKBAN, és ez mérésből jött: egy
 * százalékos korlát (10–90%) keskeny sávon KEVESEBB pixelt hagy, mint amennyi
 * az arckép fele — a kép ilyenkor is kilógott. A `clamp()` a CSS-ben van, hogy
 * a sáv tényleges szélességéhez igazodjon, ne egy React-beli becsléshez.
 *
 * ⚠️ AZ ANIMÁCIÓ AKKOR INDUL, AMIKOR A TELJES KÁRTYA LÁTSZIK. Nem korábban:
 * a `rootMargin` előretöltése miatt a sávok lefutottak, mire a felhasználó
 * odagörgetett, és ő csak kész, mozdulatlan sorokat talált. Aktivitás-kártyán
 * belül a KÁRTYA a mérce, nem a sáv — a sáv a kártya alján ül, tehát az ő
 * láthatósága még nem jelenti, hogy a kártya is látszik.
 */
/**
 * Aktivitás-kártyán belül a KÁRTYA a mérce, önálló listasornál saját maga.
 *
 * Modulszintű állandó, nem soronkénti nyílfüggvény: a `useInView` függősége,
 * tehát új példány minden rendernél újraindítaná a megfigyelőt.
 */
const RESOLVE_CARD = (node: HTMLButtonElement): Element => node.closest('.acard') ?? node;

/** Ugyanezért állandó: tömb-literál minden rendernél új megfigyelőt indítana. */
const VISIBILITY_STEPS = [0, 1];

export function RivalRow({
  rival,
  onOpen,
  compact = false,
  extra,
  others = [],
  selfCellColor,
}: {
  rival: Rival;
  onOpen: () => void;
  /** Fele akkora magasság — az aktivitás-kártya alján ez a változat fut. */
  compact?: boolean;
  /** Bal felső pirula; a kártyán a körben elvett mezők száma. */
  extra?: ReactNode;
  /** További arcok a fő kép sarkában — a kör többi károsultja. */
  others?: readonly ActivityAuthor[];
  /**
   * A BAL oldal (a „nyert" sáv) gazdájának választott cellaszín-kulcsa.
   *
   * Mindenki a SAJÁT színén jelenik meg, ugyanúgy, mint a térképen (Geri
   * kérése, 2026-08-29): a bal sáv ezé a felhasználóé, a jobb a riválisé
   * (`rival.cellColor`). Amelyik fél nem választott színt, annak az oldala a
   * megszokott lila/korall marad — oldalanként külön dől el.
   */
  selfCellColor?: string | null;
}) {
  const { ref, inView } = useInView<HTMLButtonElement>({
    whole: true,
    // A `threshold: 1` csak azt szabja meg, mikor SZÓL a megfigyelő; a teljes
    // láthatóság ellenőrzése a hookban van (lásd az ottani figyelmeztetést).
    threshold: VISIBILITY_STEPS,
    resolveTarget: RESOLVE_CARD,
  });

  // A nevező nulla is lehet (rivális esemény nélkül nem jönne létre, de a
  // védelem olcsó) — a `max(1, …)` osztás helyett 50%-os felezést ad.
  const total = Math.max(1, rival.gainedCells + rival.lostCells);
  const gained = Math.round((rival.gainedCells / total) * 100);

  /*
    A két fél SAJÁT színe. `null`, ha az illető nem választott — ilyenkor az
    ADOTT OLDAL marad a régi lila/korall (a másik oldal ettől függetlenül
    kaphat színt). A gradienst a CSS képezi ebből az egy hexből, hogy a sáv
    átmenetes maradjon.
  */
  const gainColor = cellColorHexOrNull(selfCellColor);
  const lossColor = cellColorHexOrNull(rival.cellColor);

  /*
    UGYANAZ A SZÍN MINDKÉT OLDALON — ilyenkor a sáv egyetlen összefolyó
    foltnak látszana, és pont az veszne el belőle, amiért van: hogy hol a
    határ a nyert és a vesztett rész között. Geri kérése (2026-08-29): a bal
    oldal ilyenkor világosabb, a jobb sötétebb árnyalatot kap. A szétválasztás
    a CSS-ben történik (`rival-row--twin`), hogy egyetlen hexből képződjön.
  */
  const twin = gainColor !== null && gainColor === lossColor;

  return (
    <button
      ref={ref}
      type="button"
      className={`conn__row rival-row${compact ? ' rival-row--compact' : ''}${
        inView ? ' rival-row--live' : ''
      }${twin ? ' rival-row--twin' : ''}`}
      style={
        {
          '--rival-gained': `${gained}%`,
          ...(gainColor ? { '--rival-bar-gain': gainColor } : {}),
          ...(lossColor ? { '--rival-bar-loss': lossColor } : {}),
        } as CSSProperties
      }
      onClick={onOpen}
    >
      <span className="rival-row__bars" aria-hidden="true">
        <span
          className={`rival-row__bar rival-row__bar--gain${
            gainColor ? ' rival-row__bar--tinted' : ''
          }`}
        />
        <span
          className={`rival-row__bar rival-row__bar--loss${
            lossColor ? ' rival-row__bar--tinted' : ''
          }`}
        />
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
        <Avatar url={rival.photoURL} name={rival.username} size={compact ? 34 : 44} />
        {/* A tömör változatban nincs hely névcímkének, és nem is kell: ott a
            kártya fejléce már megmondta, kiről van szó. */}
        {compact ? null : <span className="conn__name">{rival.username}</span>}

        {others.length > 0 ? (
          <span className="rival-row__others" aria-hidden="true">
            {others.map((other) => (
              <Avatar key={other.uid} url={other.photoURL} name={other.username} size={14} />
            ))}
          </span>
        ) : null}
      </span>

      {extra}

      <RivalScore rival={rival} countUp={inView} />
    </button>
  );
}
