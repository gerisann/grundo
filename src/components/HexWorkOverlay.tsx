import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import './hexWorkOverlay.css';

/**
 * Hosszú művelet várakozó képernyője — hatszögekkel.
 *
 * MIÉRT KELL ENNYI? Mert ezek a műveletek HOSSZÚK: az útvonaltervezés mérve
 * 3,6–7 másodperc plusz a területszámítás, a küldetés-generálás és a nagy
 * körök mentése szintén. Egy pörgő ikon ennyi idő alatt elakadásnak látszik —
 * itt látszania kell, hogy a rendszer dolgozik, és annak is, hogy MIN.
 *
 * A formanyelv a játéké: hatszög, ugyanazzal a `clip-path`-szal, amit a
 * rögzítés mentés-jelzője használ. A középső ábra a mező FOGLALÁSÁT idézi:
 * egy cella megjelenik, majd sorban a hat szomszédja — aztán ugyanabban a
 * sorrendben tűnnek el. A háttérben halvány mezők lélegeznek, hogy a kép ne
 * legyen üres, de ne is vonja el a figyelmet.
 *
 * ⚠️ HA VAN VALÓDI HALADÁS, AZ FONTOSABB AZ ANIMÁCIÓNÁL. A `progress` és a
 * `note` ezért kap helyet a kép alatt: a „3/7 szakasz” többet mond, mint
 * bármilyen szép mozgás, és ilyenkor az időzített szövegek helyett a tényleges
 * állapot vezet.
 */

export interface OverlayMessage {
  /** Hány ezredmásodperc után váltson erre a szövegre. */
  after: number;
  text: string;
}

/**
 * A hat szomszéd a középső cellához képest, MEGJELENÉSI sorrendben.
 *
 * Pointy-top rácson (ez a projekt hatszög-alakja) a vízszintes szomszéd egy
 * teljes szélességnyire van, az átlósak fél szélességre és háromnegyed
 * magasságra. Az óramutató járása szerint indulunk a jobb-felsőtől — ez adja
 * a „körbeépül” érzetet.
 */
const NEIGHBOURS: readonly [number, number][] = [
  [0, 0], // 1 — a mag
  [0.5, -0.75], // 2 — jobb-fel
  [1, 0], // 3 — jobb
  [0.5, 0.75], // 4 — jobb-le
  [-0.5, 0.75], // 5 — bal-le
  [-1, 0], // 6 — bal
  [-0.5, -0.75], // 7 — bal-fel
];

/** A hatszög mérete képpontban (szélesség; a magasság ebből jön). */
const HEX_W = 34;

/**
 * Rés a mezők között.
 *
 * A hatszögrács pontosan illeszkedik, de úgy a hét mező EGY TÖMBNEK látszik.
 * A játékban külön cellákat foglalunk, és a kép is ezt mondja — pár százalék
 * távolság elég hozzá, hogy az alakzat összetartson, de a mezők látszódjanak.
 */
const GAP = 1.09;

/**
 * Az útvonaltervezés szövegei.
 *
 * ⚠️ NEM HAZUDNAK: a szerver nem küld részfolyamat-jelzést, tehát ezek IDŐ
 * alapján váltanak, nem tényleges fázisokból. Ezért fogalmaznak általánosan —
 * egyik sem állítja, hogy „most épp X fut”.
 */
export const PLANNING_MESSAGES: readonly OverlayMessage[] = [
  { after: 0, text: 'Térkép leporolása…' },
  { after: 4000, text: 'Ötszögek hatszögesítése…' },
  { after: 9000, text: 'Próbálunk nem beküldeni egy bokorba…' },
  { after: 20000, text: 'Aszfalt-molekulák elemzése…' },
];

/** A küldetés-ajánló szövegei. */
export const MISSION_MESSAGES: readonly OverlayMessage[] = [
  { after: 0, text: 'Köröket keresünk a környéken…' },
  { after: 4000, text: 'Megnézzük, mennyi területet zárnak be…' },
  { after: 10000, text: 'Kiválasztjuk a legjobbakat…' },
  { after: 20000, text: 'Mindjárt megvan — ez a környék bőven ad lehetőséget.' },
];

/** A rögzítés mentésének szövegei. */
export const SAVING_MESSAGES: readonly OverlayMessage[] = [
  { after: 0, text: 'Mentjük a mozgásodat…' },
  { after: 3000, text: 'Elszámoljuk a megszerzett területet…' },
  { after: 10000, text: 'Nagy kör — ez eltarthat egy kicsit.' },
];

export function HexWorkOverlay({
  messages = PLANNING_MESSAGES,
  sub,
  progress,
  note,
  inline = false,
}: {
  messages?: readonly OverlayMessage[];
  /** A kép alatti halk magyarázat; elhagyható. */
  sub?: string;
  /** Valódi haladás 0 és 1 között — ha van, ez vezet az időzített szöveg előtt. */
  progress?: number | null;
  /** A haladás melletti pontosítás, például „3 / 7 szakasz”. */
  note?: string | null;
  /**
   * PANELKÉNT, a helyén — nem teljes képernyőn.
   *
   * ⚠️ NEM DÍSZBELI KAPCSOLÓ. A rögzítés mentése más elemek MELLETT áll a
   * képernyőn (például a „túl rövid lett" figyelmeztetés mellett); teljes
   * képernyőssé téve azokat elrejtenénk. Ott tehát a hatszög-ábra ugyanaz,
   * csak a helyén marad.
   */
  inline?: boolean;
}) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 500);
    return () => window.clearInterval(timer);
  }, []);

  const message = useMemo(() => {
    let text = messages[0]?.text ?? '';
    for (const item of messages) if (elapsed >= item.after) text = item.text;
    return text;
  }, [elapsed, messages]);

  /*
    A HÁTTÉR MEZŐI EGYSZER SZÜLETNEK MEG. Ha minden képkockánál újragenerálnánk
    a véletlen pozíciókat, a mezők ugrálnának — itt viszont épp a nyugodt,
    lassú lélegzés a cél.
  */
  const backdrop = useMemo(
    () =>
      Array.from({ length: 18 }, (_, index) => ({
        left: Math.random() * 100,
        top: Math.random() * 100,
        scale: 0.6 + Math.random() * 1.1,
        delay: Math.random() * 3.2,
        duration: 2.6 + Math.random() * 2.4,
        key: index,
      })),
    [],
  );

  const body = (
    <div className={inline ? 'rpo rpo--inline' : 'rpo'} role="status" aria-live="polite">
      <div className="rpo__backdrop" aria-hidden="true">
        {backdrop.map((hex) => (
          <span
            key={hex.key}
            className="rpo__drift"
            style={{
              left: `${hex.left}%`,
              top: `${hex.top}%`,
              width: `${HEX_W * hex.scale}px`,
              height: `${HEX_W * hex.scale * 1.1547}px`,
              animationDelay: `${hex.delay}s`,
              animationDuration: `${hex.duration}s`,
            }}
          />
        ))}
      </div>

      <div className="rpo__stage" aria-hidden="true">
        {NEIGHBOURS.map(([dx, dy], index) => (
          <span
            key={index}
            className="rpo__cell"
            style={{
              width: `${HEX_W}px`,
              height: `${HEX_W * 1.1547}px`,
              transform: `translate(${dx * HEX_W * GAP}px, ${dy * HEX_W * 1.1547 * GAP}px)`,
              /*
                A KÉSLELTETÉS ADJA A SORRENDET, és ugyanez adja az eltűnését is:
                egyetlen keyframe fut mindegyiken, tehát amelyik előbb jelent
                meg, az tűnik el előbb — pontosan a kért módon.
              */
              animationDelay: `${index * 0.13}s`,
            }}
          />
        ))}
      </div>

      <p className="rpo__message">{message}</p>

      {/* A VALÓDI haladás megelőzi az időzített szöveget — lásd a fejlécet. */}
      {typeof progress === 'number' ? (
        <div className="rpo__bar" role="progressbar" aria-valuemin={0} aria-valuemax={100}
          aria-valuenow={Math.round(progress * 100)}>
          <div className="rpo__fill" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      ) : null}
      {note ? <p className="rpo__sub">{note}</p> : null}

      {sub ? <p className="rpo__sub">{sub}</p> : null}
    </div>
  );

  /* Teljes képernyőn portálban — lásd `RoutePlannerSheet`: a dokk különben fölé kerül. */
  return inline ? body : createPortal(body, document.body);
}

/**
 * Az útvonaltervezés várakozó képernyője — a `HexWorkOverlay` beállított
 * változata. Külön név, hogy a hívó helyeken olvasható maradjon, mire várunk.
 */
export function RoutePlanningOverlay() {
  return (
    <HexWorkOverlay
      messages={PLANNING_MESSAGES}
      sub="Az útvonaltervezés a valós úthálózatot követi."
    />
  );
}
