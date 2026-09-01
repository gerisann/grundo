/**
 * A valós idejű cellahang bekötése — minden új mezőnél egy koppanás.
 *
 * A DÖNTÉS a `lib/cellStepSound.ts` tiszta függvényeiben van; ez a réteg
 * csak azt tudja, hol tartottunk legutóbb, és mikor kell újrahangolni.
 *
 * ⚠️ AZ ELSŐ MEGFIGYELÉS SOSEM SZÓL. Munkamenet-váltáskor (új rögzítés,
 * félbehagyott futás visszaállítása) a cellalánc nulláról egyből több
 * százra ugorhat — az nem most történt. Ilyenkor a kiindulás némán beáll.
 */

import { useEffect, useRef } from 'react';
import type { CellId } from '@/types';
import {
  cellStepSounds,
  CELL_STEP_GAP_MS,
  type CellOwner,
} from '@/lib/cellStepSound';
import { playSoundSequence } from '@/lib/sound';

export function useCellStepSound(
  path: readonly CellId[],
  ownership: ReadonlyMap<CellId, CellOwner>,
  myUid: string,
  sessionKey: string,
  active: boolean,
): void {
  const processed = useRef(0);
  const session = useRef<string | null>(null);
  /**
   * A BIRTOKVISZONY REFBŐL, NEM FÜGGŐSÉGBŐL.
   *
   * A `/api/tiles` válasz percenként többször is új `Map`-et ad, a
   * cellalánc viszont ettől nem nő. Ha a hatás az `ownership`-re is
   * feliratkozna, minden csempeválasz újrafuttatná — és a lejátszás
   * elmaradna vagy megkettőződne. A hang mindig a LEGFRISSEBB ismert
   * birtokviszonyt használja, de az esemény továbbra is az új mező.
   */
  const ownershipRef = useRef(ownership);
  ownershipRef.current = ownership;
  const uidRef = useRef(myUid);
  uidRef.current = myUid;

  useEffect(() => {
    if (!active) {
      processed.current = 0;
      session.current = null;
      return;
    }

    if (session.current !== sessionKey) {
      session.current = sessionKey;
      processed.current = path.length;
      return;
    }

    /**
     * Rövidebb lánc = a geometria újraépült (GPS-korrekció, visszaállítás).
     * Ilyenkor csak igazítjuk a jelzőt; ami már elhangzott, nem szól újra.
     */
    if (path.length < processed.current) {
      processed.current = path.length;
      return;
    }

    const sounds = cellStepSounds(processed.current, path, ownershipRef.current, uidRef.current);
    processed.current = path.length;
    if (sounds.length > 0) playSoundSequence(sounds, CELL_STEP_GAP_MS);
  }, [active, sessionKey, path]);
}
