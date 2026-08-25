/**
 * Megosztott utolsó pozíció — a telefon fixe a gépen is használható.
 *
 * A BAJ: az asztali böngésző nem GPS-ből tájékozódik, hanem WiFi- és
 * IP-alapú becslésből. Ez Budapesten simán több kilométert téved — a tű a fél
 * városban máshova került. A MEGOLDÁS: a telefon jobb fixe megosztható a saját
 * privát dokumentumba, és a többi eszköz azt használhatja kiindulási pontnak.
 *
 * ⚠️ NEM JÁTÉKADAT. A területfoglaláshoz semmi köze: kizárólag azt dönti el,
 * hova középre a térkép. LAB E2E módban még ezt az egyetlen mellékhatást is
 * letiltjuk, hogy egy szimulált futás garantáltan zero production write legyen.
 */

import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';

export interface SharedPosition {
  lat: number;
  lng: number;
  /** A fix vízszintes pontossága méterben. Kisebb = jobb. */
  accuracyM: number;
  /** Mikor mérték (epoch ms). */
  at: number;
}

const GOOD_ENOUGH_M = 150;
const USELESS_ABOVE_M = 3_000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function useSharedPosition(uid: string | undefined, enabled = true) {
  const [own, setOwn] = useState<SharedPosition | null>(null);
  const [shared, setShared] = useState<SharedPosition | null>(null);
  const published = useRef(0);

  /* ── A saját fix ─────────────────────────────────────────────── */

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) =>
        setOwn({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracyM: Number.isFinite(p.coords.accuracy) ? p.coords.accuracy : 99_999,
          at: p.timestamp || Date.now(),
        }),
      () => undefined,
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 60_000 },
    );
  }, [enabled]);

  /* ── A közös fix figyelése ───────────────────────────────────── */

  useEffect(() => {
    if (!enabled || !db || !uid) {
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
        const raw = value.at as number | { toMillis?: () => number } | undefined;
        const at = typeof raw === 'number'
          ? raw
          : typeof raw?.toMillis === 'function'
            ? raw.toMillis()
            : 0;
        setShared({ lat, lng, accuracyM: Number(value.accuracyM ?? 99_999), at });
      },
      () => setShared(null),
    );
  }, [enabled, uid]);

  /* ── A jobb fix megosztása ───────────────────────────────────── */

  useEffect(() => {
    if (!enabled || !db || !uid || !own) return;
    if (own.accuracyM > USELESS_ABOVE_M) return;

    const better = shared === null || own.accuracyM < shared.accuracyM;
    const staleAbove = shared !== null && Date.now() - shared.at > MAX_AGE_MS;
    if (!better && !staleAbove) return;
    if (published.current === own.at) return;
    published.current = own.at;

    void setDoc(
      doc(db, 'users', uid, 'private', 'position'),
      {
        lat: own.lat,
        lng: own.lng,
        accuracyM: Math.round(own.accuracyM),
        at: own.at,
        updatedAt: Date.now(),
      },
      { merge: true },
    ).catch(() => undefined);
  }, [enabled, uid, own, shared]);

  if (!enabled) return null;
  if (own && own.accuracyM <= GOOD_ENOUGH_M) return own;
  if (shared && Date.now() - shared.at <= MAX_AGE_MS) {
    if (!own || shared.accuracyM < own.accuracyM) return shared;
  }
  return own;
}
