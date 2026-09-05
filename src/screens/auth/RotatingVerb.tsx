import { useEffect, useState } from 'react';

/**
 * „Ne csak ingázz, Bringázz! / Fuss! / Sétálj!" — hengeren forgó szó.
 *
 * A három mozgásforma váltakozik: a kint lévő szó FELFELÉ gördül ki, az új
 * pedig LENTRŐL úszik be. Egy szó egy másodpercig áll, a váltás 400 ms.
 *
 * ⚠️ NEM CSAK CSS-ANIMÁCIÓ: a szavak eltérő szélességűek, és egy tisztán
 * CSS-es végtelen keyframe-lánc mindhárom szót egyszerre tartaná a DOM-ban,
 * a doboz szélessége pedig a leghosszabbhoz igazodna — a mondat végén tátongó
 * lyukkal. Ezért egyszerre EGY szó van kint, és a React cseréli.
 */

const VERBS = ['Bringázz', 'Fuss', 'Sétálj'] as const;

/** Ennyi ideig áll egy szó, mielőtt kigördül. */
const HOLD_MS = 1000;
/** A ki- és begördülés hossza — a CSS-animációval együtt kell mozognia. */
const SWAP_MS = 400;

export function RotatingVerb() {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const out = window.setTimeout(() => setLeaving(true), HOLD_MS);
    return () => window.clearTimeout(out);
  }, [index]);

  useEffect(() => {
    if (!leaving) return;
    const swap = window.setTimeout(() => {
      setIndex((current) => (current + 1) % VERBS.length);
      setLeaving(false);
    }, SWAP_MS);
    return () => window.clearTimeout(swap);
  }, [leaving]);

  return (
    <span className="verb-roll">
      {/*
        A látható szó és a `verb-roll__ghost` együtt adja a doboz méretét: a
        rejtett példány a LEGHOSSZABB szót tartalmazza, így a mondat többi
        része nem ugrál, ahogy a szavak váltják egymást.
      */}
      <span aria-hidden="true" className="verb-roll__ghost">
        Bringázz!
      </span>
      <span className={`verb-roll__word${leaving ? ' verb-roll__word--out' : ''}`}>
        {VERBS[index]}!
      </span>
    </span>
  );
}
