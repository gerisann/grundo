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
import { BrowserPositionSource } from '@/tracking/browserSource';
import {
  applySample,
  createRecorder,
  finish as finishRecorder,
  pause as pauseRecorder,
  resume as resumeRecorder,
  start as startRecorder,
  type RecorderState,
} from '@/tracking/recorder';
import {
  createRunPersister,
  defaultRunStore,
  isResumable,
  type PersistedRun,
} from '@/tracking/storage';
import { TrackingError, type PositionSource } from '@/tracking/types';
import { requestWakeLock, wakeLockSupported, type WakeLock } from '@/tracking/wakeLock';

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

  begin: (type: ActivityType) => Promise<void>;
  pause: () => void;
  resume: () => void;
  finish: () => Promise<void>;
  discard: () => Promise<void>;
  /** A felajánlott félbehagyott rögzítés folytatása. */
  restore: () => Promise<void>;
  /** A felajánlott rögzítés eldobása. */
  dismissResumable: () => Promise<void>;
}

export function useRecorder(source?: PositionSource): RecorderApi {
  const positionSource = useMemo(() => source ?? new BrowserPositionSource(), [source]);
  const persister = useMemo(() => createRunPersister(defaultRunStore()), []);

  const stateRef = useRef<RecorderState>(createRecorder('run'));
  const [state, setState] = useState<RecorderState>(stateRef.current);
  const [error, setError] = useState<TrackingError | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const [resumable, setResumable] = useState<RecorderState | null>(null);
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
      return next;
    },
    [persister],
  );

  /* ── Félbehagyott rögzítés keresése induláskor ─────────────────── */

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const store = defaultRunStore();
      const saved: PersistedRun | null = await store.read().catch(() => null);
      if (cancelled || saved === null) return;
      if (isResumable(saved, Date.now())) setResumable(saved.state);
      else await store.clear().catch(() => undefined);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ── A forrás elindítása és leállítása ─────────────────────────── */

  const attach = useCallback(async () => {
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
      });
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
      positionSource.stop();
      void wakeRef.current?.release();
      void persister.flush();
    };
  }, [persister, positionSource]);

  /* ── Műveletek ─────────────────────────────────────────────────── */

  const begin = useCallback(
    async (type: ActivityType) => {
      setHasFix(false);
      apply(() => startRecorder(createRecorder(type), Date.now()));
      await acquireWakeLock();
      await attach();
    },
    [acquireWakeLock, apply, attach],
  );

  const pause = useCallback(() => {
    apply((current) => pauseRecorder(current, Date.now()));
  }, [apply]);

  const resume = useCallback(() => {
    apply((current) => resumeRecorder(current, Date.now()));
  }, [apply]);

  const finish = useCallback(async () => {
    positionSource.stop();
    apply((current) => finishRecorder(current, Date.now()));
    await releaseWakeLock();
    // Kiírás bevárva: a lezárt rögzítés nem veszhet el, mert épp egy
    // összevont írás volt függőben.
    await persister.flush();
  }, [apply, persister, positionSource, releaseWakeLock]);

  const discard = useCallback(async () => {
    positionSource.stop();
    await releaseWakeLock();
    await persister.clear();
    stateRef.current = createRecorder('run');
    setState(stateRef.current);
    setHasFix(false);
    setError(null);
  }, [persister, positionSource, releaseWakeLock]);

  const restore = useCallback(async () => {
    const saved = resumable;
    if (saved === null) return;
    setResumable(null);
    // Szüneteltetve vesszük át: a megszakítás óta eltelt idő nem mozgás volt,
    // és a felhasználónak kell eldöntenie, mikor folytatja.
    stateRef.current = saved.status === 'recording' ? pauseRecorder(saved, Date.now()) : saved;
    setState(stateRef.current);
    persister.save(stateRef.current);
    await acquireWakeLock();
    await attach();
  }, [acquireWakeLock, attach, persister, resumable]);

  const dismissResumable = useCallback(async () => {
    setResumable(null);
    await persister.clear();
  }, [persister]);

  return {
    state,
    error,
    hasFix,
    supportsBackground: positionSource.supportsBackground,
    wakeLockActive,
    resumable,
    begin,
    pause,
    resume,
    finish,
    discard,
    restore,
    dismissResumable,
  };
}
