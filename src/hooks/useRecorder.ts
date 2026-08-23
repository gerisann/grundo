/**
 * A rögzítés bekötése a felülethez.
 *
 * Ez az egyetlen hely, ahol a négy darab összeér: a pozíció forrása, az
 * állapotgép, a megőrzés és a képernyőzár. Maga a logika egyikben sincs itt —
 * ez a réteg csak összeköti őket, és Reactté fordítja.
 *
 * A LEGFONTOSABB RÉSZLET: az állapotot `useRef` is tartja, nem csak `useState`.
 * A pozíció forrása egy visszahívást kap, ami a feliratkozáskor érvényes
 * lezárásban ragadna — az onnan látott `state` percekkel később is a
 * rögzítés indulásakori állapot lenne, és minden minta felülírná az előzőt.
 * A ref mindig az aktuálisat adja.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ActivityType } from '@/types';
import { clearGhostRoute } from '@/lib/ghostRoute';
import { isNativeApp } from '@/lib/platform';
import { BrowserPositionSource } from '@/tracking/browserSource';
import { NativePositionSource } from '@/tracking/nativeSource';
import {
  applySample,
  createRecorder,
  finish as finishRecorder,
  markLap as markLapRecorder,
  movingMs as movingMsOf,
  pause as pauseRecorder,
  resume as resumeRecorder,
  start as startRecorder,
  type RecorderState,
} from '@/tracking/recorder';
import {
  createRunPersister,
  defaultRunStore,
  isResumable,
  prepareForRestore,
  type PersistedRun,
} from '@/tracking/storage';
import {
  TrackingError,
  type PositionActivityState,
  type PositionSource,
} from '@/tracking/types';
import { ApiError, api, apiConfigured, type ActivitySummary } from '@/lib/api';
import { requestWakeLock, wakeLockSupported, type WakeLock } from '@/tracking/wakeLock';
import {
  currentNavigationType,
  describeResumeCause,
  installLifecycleDiagnostics,
  readLastLifecycleEvent,
} from '@/tracking/lifecycle';

export interface RecorderApi {
  state: RecorderState;
  /** Az utolsó hiba a helymeghatározásból. A rögzítés ettől még futhat. */
  error: TrackingError | null;
  /** Érkezett-e már használható fix. Amíg nem, a felület jelet keres. */
  hasFix: boolean;
  /** Mér-e a forrás a háttérben. Böngészőben mindig hamis. */
  supportsBackground: boolean;
  /** Sikerült-e ébren tartani a képernyőt. */
  wakeLockActive: boolean;
  /** Félbehagyott, folytatható rögzítés a korábbi munkamenetből. */
  resumable: RecorderState | null;
  /** Miért állt helyre helyi mentésből a rögzítés. */
  resumableNotice: string | null;

  /** A feltöltés állapota és eredménye. */
  upload: UploadState;
  /** Feltöltés — a szerver újraszámol mindent, és az ő eredménye a hiteles. */
  uploadActivity: () => Promise<void>;

  /**
   * A KÖVETKEZŐ rögzítés mozgásformája.
   *
   * A rögzítőben él, nem a képernyőn: az indítógomb a dokkban van, tehát a
   * választásnak el kell jutnia oda. Korábban a képernyő saját állapotában
   * volt, amit a dokk nem látott — ezért indult minden rögzítés futásként,
   * hiába választott a felhasználó bringát.
   */
  pendingType: ActivityType;
  setPendingType: (type: ActivityType) => void;

  begin: (type?: ActivityType) => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Új kör kezdése. */
  markLap: () => void;
  finish: () => Promise<void>;
  discard: () => Promise<void>;
  /** A felajánlott félbehagyott rögzítés folytatása. */
  restore: () => Promise<void>;
  /** A felajánlott rögzítés eldobása. */
  dismissResumable: () => Promise<void>;
}

export type UploadState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'done'; summary: ActivitySummary; duplicate: boolean }
  | { status: 'error'; message: string; retryable: boolean };

export function useRecorder(source?: PositionSource): RecorderApi {
  const positionSource = useMemo<PositionSource>(
    () => source ?? (isNativeApp() ? new NativePositionSource() : new BrowserPositionSource()),
    [source],
  );
  const persister = useMemo(() => createRunPersister(defaultRunStore()), []);

  const stateRef = useRef<RecorderState>(createRecorder('run'));
  const [state, setState] = useState<RecorderState>(stateRef.current);
  const [error, setError] = useState<TrackingError | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const [resumable, setResumable] = useState<RecorderState | null>(null);
  const [resumableNotice, setResumableNotice] = useState<string | null>(null);
  const resumableRun = useRef<PersistedRun | null>(null);
  const [pendingType, setPendingType] = useState<ActivityType>('run');
  const wakeRef = useRef<WakeLock | null>(null);
  const [wakeLockActive, setWakeLockActive] = useState(false);

  /** Minden állapotváltozás egy helyen fut át: ref, React, megőrzés. */
  const apply = useCallback(
    (change: (current: RecorderState) => RecorderState) => {
      const next = change(stateRef.current);
      if (next === stateRef.current) return next;
      stateRef.current = next;
      setState(next);
      persister.save(next);
      const activityState = toPositionActivityState(next);
      if (activityState) void positionSource.syncActivity?.(activityState);
      return next;
    },
    [persister, positionSource],
  );

  /* ── Félbehagyott rögzítés keresése induláskor ─────────────────── */

  useEffect(() => {
    return installLifecycleDiagnostics();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = defaultRunStore();
      const saved: PersistedRun | null = await store.read().catch(() => null);
      if (cancelled || saved === null) return;
      if (isResumable(saved, Date.now())) {
        resumableRun.current = saved;
        setResumable(saved.state);
        setResumableNotice(describeResumeCause(readLastLifecycleEvent(), currentNavigationType()));
      }
      else await store.clear().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── A forrás elindítása és leállítása ─────────────────────────── */

  const attach = useCallback(async (
    activityType: ActivityType = stateRef.current.type,
    activityState: RecorderState = stateRef.current,
  ) => {
    setError(null);
    try {
      await positionSource.start({
        onSample: (sample) => {
          setHasFix(true);
          // A hibát töröljük: ha jön fix, a korábbi jelvesztés már nem áll fenn.
          setError(null);
          apply((current) => applySample(current, sample));
        },
        onError: (err) => setError(err),
      }, activityType, toPositionActivityState(activityState) ?? undefined);
    } catch (err) {
      setError(
        err instanceof TrackingError
          ? err
          : new TrackingError('unavailable', 'A helymeghatározás nem indult el.'),
      );
      throw err;
    }
  }, [apply, positionSource]);

  const acquireWakeLock = useCallback(async () => {
    if (!wakeLockSupported()) return;
    wakeRef.current = await requestWakeLock();
    setWakeLockActive(wakeRef.current.active);
  }, []);

  const releaseWakeLock = useCallback(async () => {
    await wakeRef.current?.release();
    wakeRef.current = null;
    setWakeLockActive(false);
  }, []);

  /**
   * Leiratkozás a lap elhagyásakor.
   *
   * A képernyőzárat MINDENKÉPP el kell engedni: ha itt bent maradna, a
   * felhasználó telefonja a rögzítés vége után is ébren maradna, és ezt már
   * semmiből nem tudná visszakapcsolni.
   */
  useEffect(() => {
    return () => {
      void positionSource.stop();
      void wakeRef.current?.release();
      void persister.flush();
    };
  }, [persister, positionSource]);

  /* ── Műveletek ─────────────────────────────────────────────────── */

  const begin = useCallback(
    async (type?: ActivityType) => {
      setHasFix(false);
      const started = apply(() => startRecorder(createRecorder(type ?? pendingType), Date.now()));
      await acquireWakeLock();
      await attach(type ?? pendingType, started);
    },
    [acquireWakeLock, apply, attach, pendingType],
  );

  const pause = useCallback(() => {
    apply((current) => pauseRecorder(current, Date.now()));
  }, [apply]);

  const resume = useCallback(() => {
    apply((current) => resumeRecorder(current, Date.now()));
  }, [apply]);

  const markLap = useCallback(() => {
    apply((current) => markLapRecorder(current, Date.now()));
  }, [apply]);

  const [upload, setUpload] = useState<UploadState>({ status: 'idle' });

  const uploadActivity = useCallback(async () => {
    const current = stateRef.current;
    if (current.status !== 'finished' || current.points.length < 2) return;
    if (!apiConfigured) {
      setUpload({
        status: 'error',
        message: 'A háttérszolgáltatás nincs beállítva, a mentés nem megy.',
        retryable: false,
      });
      return;
    }

    setUpload({ status: 'sending' });
    try {
      const result = await api.uploadActivity({
        activityId: current.id,
        type: current.type,
        points: current.points,
        startedAt: current.startedAt ?? Date.now(),
        endedAt: current.endedAt ?? Date.now(),
        // A lezárt rögzítésnél az `endedAt` már megvan, tehát a „most"
        // paraméternek nincs szerepe — de a függvény kéri.
        movingMs: movingMsOf(current, current.endedAt ?? Date.now()),
      });
      setUpload({
        status: 'done',
        summary: result.summary,
        duplicate: result.duplicate === true,
      });
      // A mentett rögzítést nem kell tovább őrizni: a szerveren már megvan.
      await persister.clear();
    } catch (err) {
      /**
       * A hálózati hiba ÚJRAPRÓBÁLHATÓ, a szabálysértés nem.
       *
       * A különbségtétel azért fontos, mert a „túl rövid" vagy „hibás
       * nyomvonal" hiba újrapróbálásra sem lesz jobb — a felhasználónak nem
       * gombot kell nyomnia, hanem megérteni, mi történt.
       */
      const retryable =
        err instanceof ApiError ? err.status === 0 || err.status >= 500 : true;
      setUpload({
        status: 'error',
        message: err instanceof Error ? err.message : 'A mentés nem sikerült.',
        retryable,
      });
    }
  }, [persister]);

  const finish = useCallback(async () => {
    await positionSource.stop();
    apply((current) => finishRecorder(current, Date.now()));
    await releaseWakeLock();
    // Kiírás bevárva: a lezárt rögzítés nem veszhet el, mert épp egy
    // összevont írás volt függőben.
    await persister.flush();
  }, [apply, persister, positionSource, releaseWakeLock]);

  const discard = useCallback(async () => {
    await positionSource.stop();
    await releaseWakeLock();
    await persister.clear();
    stateRef.current = createRecorder('run');
    setState(stateRef.current);
    setHasFix(false);
    setError(null);
    setUpload({ status: 'idle' });
    // A szellemvonal EGYETLEN rögzítésre szólt — a következő induljon nélküle,
    // különben egy már mentett vagy eldobott küldetés vonala kísértene tovább.
    clearGhostRoute();
  }, [persister, positionSource, releaseWakeLock]);

  const restore = useCallback(async () => {
    const saved = resumableRun.current;
    if (saved === null || resumable === null) return;
    resumableRun.current = null;
    setResumable(null);
    setResumableNotice(null);
    // Szüneteltetve vesszük át: a megszakítás óta eltelt idő nem mozgás volt,
    // és a felhasználónak kell eldöntenie, mikor folytatja.
    stateRef.current = prepareForRestore(saved);
    setState(stateRef.current);
    persister.save(stateRef.current);
    await acquireWakeLock();
    await attach(stateRef.current.type);
  }, [acquireWakeLock, attach, persister, resumable]);

  const dismissResumable = useCallback(async () => {
    resumableRun.current = null;
    setResumable(null);
    setResumableNotice(null);
    await persister.clear();
  }, [persister]);

  return {
    state,
    error,
    hasFix,
    supportsBackground: positionSource.supportsBackground,
    wakeLockActive,
    resumable,
    resumableNotice,
    pendingType,
    setPendingType,
    upload,
    uploadActivity,
    begin,
    pause,
    resume,
    markLap,
    finish,
    discard,
    restore,
    dismissResumable,
  };
}

function toPositionActivityState(state: RecorderState): PositionActivityState | null {
  if (state.startedAt === null || (state.status !== 'recording' && state.status !== 'paused')) {
    return null;
  }
  return {
    startedAt: state.startedAt,
    distanceM: state.distanceM,
    pausedMs: state.pausedMs,
    pausedAt: state.pausedAt,
    status: state.status,
  };
}
