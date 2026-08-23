/**
 * Saját rögzítés utolsó mobilos állapotának Firestore-szinkronja.
 *
 * Nem teljes értékű élő követés: 15 másodpercenként egy tömör pillanatképet
 * írunk a tulajdonos privát dokumentumába. A másik eszköz mindig a legutóbb
 * sikeresen látott helyzetet mutatja, hálózati szakadáskor is őszintén jelezve
 * az időbélyeget.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { decodePolyline, encodePolyline, simplifyTrace } from '@/game/polyline';
import { db } from '@/lib/firebase';
import { currentSpeedMps, movingMs, type RecorderState, type RecorderStatus } from './recorder';
import {
  BASIC_RESUME_WINDOW_MS,
  isRemoteTrackingVisible,
} from './resumePolicy';
import type { ActivityType, TracePoint } from '@/types';

const SYNC_INTERVAL_MS = 15_000;
const MAX_SYNC_POINTS = 400;
const DEVICE_KEY = 'grundo.deviceId';

export interface SyncedTrackingState {
  activityId: string;
  deviceId: string;
  status: Exclude<RecorderStatus, 'idle'>;
  type: ActivityType;
  points: TracePoint[];
  distanceM: number;
  movingMs: number;
  speedMps: number | null;
  startedAt: number | null;
  updatedAt: number;
}

export function useTrackingCloudSync(uid: string | undefined, state: RecorderState) {
  const deviceId = useRef(deviceIdForBrowser());
  const latest = useRef(state);
  const previousStatus = useRef<RecorderStatus>('idle');
  const [remote, setRemote] = useState<SyncedTrackingState | null>(null);
  latest.current = state;

  const writeSnapshot = useCallback(async () => {
    if (!db || !uid) return;
    const current = latest.current;
    const ref = doc(db, 'users', uid, 'private', 'tracking');

    // Üres állapottal nem töröljük felül a legutóbbi mobilos helyzetet: a PC
    // kifejezetten azt mutatja, amit a másik eszköztől UTOLJÁRA látott.
    if (current.status === 'idle') return;

    const now = Date.now();
    await setDoc(ref, {
      deviceId: deviceId.current,
      activityId: current.id,
      status: current.status,
      type: current.type,
      route: syncRoute(current.points),
      distanceM: current.distanceM,
      movingMs: movingMs(current, now),
      speedMps: currentSpeedMps(current),
      startedAt: current.startedAt,
      lastPoint: current.points.at(-1) ?? null,
      pointCount: current.points.length,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }, [uid]);

  // A másik eszköz utolsó pillanatképe valós időben érkezik. A saját
  // eszközünk visszhangját kiszűrjük, nehogy „távoli" futásként jelenjen meg.
  useEffect(() => {
    if (!db || !uid) {
      setRemote(null);
      return;
    }
    let expiryTimer: number | null = null;
    const clearExpiry = () => {
      if (expiryTimer !== null) window.clearTimeout(expiryTimer);
      expiryTimer = null;
    };
    const unsubscribe = onSnapshot(doc(db, 'users', uid, 'private', 'tracking'), (snapshot) => {
      clearExpiry();
      const value = snapshot.data() as Record<string, unknown> | undefined;
      if (!value || value.deviceId === deviceId.current || value.status === 'idle') {
        setRemote(null);
        return;
      }
      const status = value.status;
      if (status !== 'recording' && status !== 'paused' && status !== 'finished') {
        setRemote(null);
        return;
      }
      const stamp = value.updatedAt as { toMillis?: () => number } | undefined;
      const updatedAt = typeof stamp?.toMillis === 'function' ? stamp.toMillis() : 0;
      if (!isRemoteTrackingVisible(status, updatedAt, Date.now())) {
        setRemote(null);
        return;
      }
      setRemote({
        activityId: String(value.activityId ?? ''),
        deviceId: String(value.deviceId ?? ''),
        status,
        type: value.type === 'walk' || value.type === 'ride' ? value.type : 'run',
        points: decodeSafe(String(value.route ?? '')),
        distanceM: Number(value.distanceM ?? 0),
        movingMs: Number(value.movingMs ?? 0),
        speedMps: Number.isFinite(Number(value.speedMps)) ? Number(value.speedMps) : null,
        startedAt: Number.isFinite(Number(value.startedAt)) ? Number(value.startedAt) : null,
        updatedAt,
      });
      const remaining = BASIC_RESUME_WINDOW_MS - Math.max(0, Date.now() - updatedAt);
      expiryTimer = window.setTimeout(() => setRemote(null), remaining + 50);
    }, () => setRemote(null));
    return () => {
      clearExpiry();
      unsubscribe();
    };
  }, [uid]);

  // Indítás, szünet, folytatás és befejezés azonnal szinkronizálódik.
  useEffect(() => {
    if (state.status === previousStatus.current) return;
    previousStatus.current = state.status;
    if (state.status !== 'idle') void writeSnapshot().catch(() => undefined);
  }, [state.status, writeSnapshot]);

  // Mozgás közben takarékos, fix ritmusú checkpoint. Nem írunk minden GPS-
  // pontra, mert az mobilnetet és Firestore-műveletet égetne.
  useEffect(() => {
    if (!uid) return;
    const timer = window.setInterval(() => {
      if (latest.current.status !== 'idle') void writeSnapshot().catch(() => undefined);
    }, SYNC_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && latest.current.status !== 'idle') {
        void writeSnapshot().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [uid, writeSnapshot]);

  return remote;
}

function syncRoute(points: readonly TracePoint[]): string {
  if (points.length < 2) return '';
  let reduced = simplifyTrace(points, 8);
  for (let epsilon = 16; reduced.length > MAX_SYNC_POINTS && epsilon <= 512; epsilon *= 2) {
    reduced = simplifyTrace(points, epsilon);
  }
  return encodePolyline(reduced);
}

function decodeSafe(route: string): TracePoint[] {
  if (!route) return [];
  try {
    return decodePolyline(route).map((point) => ({ ...point, t: 0 }));
  } catch {
    return [];
  }
}

function deviceIdForBrowser(): string {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing) return existing;
    const value = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, value);
    return value;
  } catch {
    return `session-${Math.random().toString(36).slice(2)}`;
  }
}
