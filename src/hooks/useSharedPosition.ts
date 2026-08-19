/**
 * Megosztott utolsó pozíció — a telefon fixe a gépen is használható.
 *
 * A BAJ: az asztali böngésző nem GPS-ből tájékozódik, hanem WiFi- és
 * IP-alapú becslésből. Ez Budapesten simán több kilométert téved — a
 * felhasználó a saját grundja helyett egy másik kerületet lát, és azt hiszi,
 * elromlott a térkép.
 *
 * A MEGOLDÁS: a pontosságot (`accuracy`) is megnézzük, nem csak a koordinátát.
 * Amelyik eszköz jobb fixet kapott, annak az adata kerül a közös
 * `users/{uid}/private/position` dokumentumba, és a többi eszköz onnan
 * indítja a térképet, ha a sajátja rosszabb.
 *
 * MIÉRT NEM A `private/tracking`-BE MEGY? Mert az a RÖGZÍTÉS pillanatképe:
 * csak aktív mérés közben íródik, és `idle` állapotban szándékosan nem
 * frissül. Ez viszont akkor is kell, amikor a felhasználó éppen nem mozog —
 * ezért külön, kicsi dokumentum.
 *
 * ⚠️ NEM JÁTÉKADAT. A területfoglaláshoz semmi köze: kizárólag azt dönti el,
 * hova középre a térkép. A `firestore.rules` a `users/{uid}/private/*` alatt
 * amúgy is csak a tulajdonost engedi olvasni és írni.
 */

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface SharedPosition {
  lat: number;
  lng: number;
  /** A fix vízszintes pontossága méterben. Kisebb = jobb. */
  accuracyM: number;
  /** Mikor mérték (epoch ms). */
  at: number;
}

/**
 * Ennél pontatlanabb saját fixnél érdemes megnézni, van-e jobb a felhőben.
 *
 * A telefonos GPS jellemzően 5–30 m, az asztali WiFi-becslés 500–5000 m. A
 * 150 méteres határ tehát tisztán elválasztja a kettőt anélkül, hogy egy
 * gyengébb, de valódi mobilfixet elvetne.
 */
const GOOD_ENOUGH_M = 150;

/** Ennél régebbi megosztott fixre már nem hagyatkozunk. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function useSharedPosition(uid: string | undefined) {
  const [own, setOwn] = useState<SharedPosition | null>(null);
  const [shared, setShared] = useState<SharedPosition | null>(null);
  /** Amit már felírtunk — hogy ugyanazt ne írjuk ki újra és újra. */
  const published = useRef(0);

  /* ── A saját fix ─────────────────────────────────────────────── */

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setOwn({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : 99_999,
          at: p.timestamp || Date.now(),
        }),
      () => undefined,
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, []);

  /* ── A közös fix figyelése ───────────────────────────────────── */

  useEffect(() => {
    if (!db || !uid) {
      setShared(null);
      return;
    }
    return onSnapshot(
      doc(db, 'users', uid, 'private', 'position'),
      (snapshot) => {
        const value = snapshot.data() as Record<string, unknown> | undefined;
        const lat = Number(value?.lat);
        const lng = Number(value?.lng);
        if (!value || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          setShared(null);
          return;
        }
        const stamp = value.at as { toMillis?: () => number } | undefined;
        setShared({
          lat,
          lng,
          accuracyM: Number(value.accuracyM ?? 99_999),
          at: typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0,
        });
      },
      () => setShared(null),
    );
  }, [uid]);

  /* ── A jobb fix megosztása ───────────────────────────────────── */

  useEffect(() => {
    if (!db || !uid || !own) return;
    // Csak akkor írunk, ha a miénk JOBB, mint ami fent van — vagy ha a fenti
    // már elavult. Enélkül az asztali gép folyamatosan felülírná a telefon
    // pontos fixét a saját, kilométeres becslésével.
    const better = shared === null || own.accuracyM < shared.accuracyM;
    const staleAbove = shared !== null && Date.now() - shared.at > MAX_AGE_MS;
    if (!better && !staleAbove) return;
    if (published.current === own.at) return;
    published.current = own.at;

    void setDoc(
      doc(db, 'users', uid, 'private', 'position'),
      { lat: own.lat, lng: own.lng, accuracyM: Math.round(own.accuracyM), at: serverTimestamp() },
      { merge: true },
    ).catch(() => undefined);
  }, [uid, own, shared]);

  /* ── Melyiket használjuk? ────────────────────────────────────── */

  /**
   * A saját fix nyer, ha elég pontos — az a friss és a valódi.
   * Különben a megosztott, ha az pontosabb és nem túl régi.
   */
  if (own && own.accuracyM <= GOOD_ENOUGH_M) return own;
  if (shared && Date.now() - shared.at <= MAX_AGE_MS) {
    if (!own || shared.accuracyM < own.accuracyM) return shared;
  }
  return own;
}
