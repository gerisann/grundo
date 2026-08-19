/**
 * A területfoglalás haladása mentés közben.
 *
 * MIÉRT KELL? Egy nagyon nagy kör (Balaton-méret, ~600 km²) mentése ~25
 * másodperc: a motornak ki kell számolnia ~2 millió mezőt, és a foglalást
 * tizenöt Firestore-tranzakcióra bontva kell elszámolni. Enélkül a felhasználó
 * huszonöt másodpercig egy néma „Mentés folyamatban…" feliratot néz, és azt
 * hiszi, lefagyott.
 *
 * MIÉRT VALÓDI ADAT, NEM ANIMÁLT TIPPELÉS? Mert a darabolt mentés
 * csoportonként haladja, és minden csoport MEGÍRJA az aktivitás
 * dokumentumára, hogy hol tart (`claimProgress`). A kliens tehát a tényleges
 * állapotot látja — nem egy előre felvett folyamatjelzőt, ami hazudik, ha a
 * mentés lassabb vagy gyorsabb a vártnál.
 *
 * A hétköznapi aktivitás egyetlen tranzakcióban megy: ott `total === 1`, és a
 * felület nem is mutat szakaszolást, mert nincs mit.
 */

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface ClaimProgress {
  /** Elkészült blokkcsoportok. */
  done: number;
  /** Összes blokkcsoport. 1 = egytranzakciós, hétköznapi mentés. */
  total: number;
  /** `pending` = még dolgozunk rajta, `done` = a könyvelés is lezárult. */
  status: 'pending' | 'done';
}

export function useClaimProgress(activityId: string | null, active: boolean) {
  const [progress, setProgress] = useState<ClaimProgress | null>(null);

  useEffect(() => {
    if (!db || !activityId || !active) {
      setProgress(null);
      return;
    }

    /**
     * A dokumentum a mentés ELSŐ tranzakciójában jön létre, tehát a
     * feliratkozás egy pillanatra még üresen tér vissza. Ez nem hiba: amíg
     * nincs mit mutatni, `null`-t adunk, és a felület a sima „mentés" szöveget
     * írja ki.
     */
    return onSnapshot(
      doc(db, 'activities', activityId),
      (snapshot) => {
        const data = snapshot.data() as Record<string, unknown> | undefined;
        if (!data) {
          setProgress(null);
          return;
        }
        const raw = (data.claimProgress ?? {}) as { done?: number; total?: number };
        const total = Number(raw.total ?? 0);
        if (!Number.isFinite(total) || total <= 0) {
          setProgress(null);
          return;
        }
        setProgress({
          done: Math.min(total, Math.max(0, Number(raw.done ?? 0))),
          total,
          status: data.claimStatus === 'done' ? 'done' : 'pending',
        });
      },
      () => setProgress(null),
    );
  }, [activityId, active]);

  return progress;
}
