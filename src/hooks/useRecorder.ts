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
  shouldAutoUpload,
  start as startRecorder,
  type RecorderState,
} from '@/tracking/recorder';
import {
  createRunPersister,
  defaultRunStore,
  prepareForRestore,
  restoreStrategy,
  type PersistedRun,
  type RunStore,
} from '@/tracking/storage';
import {
  TrackingError,
  type PositionActivityState,
  type PositionSource,
} from '@/tracking/types';
import { ApiError, api, apiConfigured, type ActivitySummary } from '@/lib/api';
import { GAMEPLAY } from '@/config/gameplay';
import { requestWakeLock, wakeLockSupported, type WakeLock } from '@/tracking/wakeLock';
import {
  currentNavigationType,
  describeResumeCause,
  installLifecycleDiagnostics,
  readLastLifecycleEvent,
} from '@/tracking/lifecycle';

export interface RecorderUploadInput {
  activityId: string;
  type: ActivityType;
  points: RecorderState['points'];
  startedAt: number;
  endedAt: number;
  movingMs: number;
}

export interface RecorderUploadResult {
  summary: ActivitySummary;
  duplicate?: boolean;
}

export type RecorderUploader = (input: RecorderUploadInput) => Promise<RecorderUploadResult>;

/**
 * Injektálható környezet a recorder köré.
 *
 * Normál appban minden mező elhagyható: natív/browser GPS, IndexedDB,
 * production API és restore marad az alap. A LAB ugyanazt a recordert kapja,
 * de memória-store-ral és sandbox uploaderrel, ezért nem tudja sem a valódi
 * félbehagyott futást, sem a production activity endpointot megérinteni.
 */
export interface RecorderOptions {
  store?: RunStore;
  uploader?: RecorderUploader;
  restoreSavedRun?: boolean;
}

export interface RecorderApi {
  state: RecorderState;
  /** Az utolsó hiba a helymeghatározásból. A rögzítés ettől még futhat. */
  error: TrackingError | null;
  /** Érkezett-e már használható fix. Amíg nem, a felület jelet keres. */
  hasFix: boolean;
  /**
   * A legfrissebb, megjelenítésre alkalmas fix — a térkép ezt követi.
   * Lásd a `LivePosition` magyarázatát: szándékosan gyorsabb, mint a
   * nyomvonal, és szándékosan nem befolyásol semmilyen játékbeli értéket.
   */
  livePosition: LivePosition | null;
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
   *
   * `null`: MÉG NINCS VÁLASZTVA. Geri kérése (2026-08-27): a mozgásforma-
   * választó minden indításnál üresen nyíljon, ne az előző választást
   * mutassa — ezért ez SOSEM őrződik meg (sem lokálisan, sem munkameneten
   * belül a következő nyitásra, lásd `Dock.tsx` `openPicker`).
   */
  pendingType: ActivityType | null;
  setPendingType: (type: ActivityType | null) => void;

  /**
   * Nyitva van-e a mozgásforma-választó (a Dock indítógombja fölött).
   *
   * A DOKK nyitja/zárja (első koppintás nyit, a második — választás után —
   * zár és indítja a visszaszámlálást), a TrackingScreen csak OLVASSA, hogy
   * megjelenítse a választó modult. Ide, a rögzítőbe kerül, mert mindkét
   * komponensnek látnia kell, és ez az egyetlen közös szülőjük.
   */
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;

  /**
   * A 3-2-1 visszaszámlálás — `null`, ha nem fut. A DOKK ÍRJA (a Play gomb
   * második megnyomása indítja, a `setTimeout`-lánc is ott ketyeg), a
   * TrackingScreen csak OLVASSA, hogy az „Indítás" jelzőnyilat is elrejtse
   * ilyenkor (2026-08-27, Geri: a nyíl a visszaszámláló számra mutatott).
   */
  countdown: number | null;
  setCountdown: (value: number | null) => void;

  /**
   * A statisztika-panel TELJES KÉPERNYŐS nézetben van-e (a lenti csíkra
   * kétszeri koppintással érhető el, lásd `TrackingScreen.tsx` `StatsPanel`).
   * A TrackingScreen írja (ő tudja, melyik nézetben van a panel), a DOKK
   * olvassa — teljes nézetben a dokk háttere „beleolvad" a panelbe, nincs
   * két külön rétege a felületnek.
   */
  statsFullView: boolean;
  setStatsFullView: (value: boolean) => void;

  /**
   * A BEFEJEZÉS-GESZTUS — Geri kérése (2026-08-27): a felhasználó választja
   * a Beállítások → Preferenciák → Működés alatt (`/beallitasok/mukodes`).
   *   'hold'  — nyomva tartós gomb (a régi, alapértelmezett viselkedés)
   *   'swipe' — húzásos, „slide to unlock" mintájú gomb
   * A `localStorage`-ban él (eszközhöz kötött beállítás, nem fiókhoz — más
   * felhasználók, más eszközök más gesztust preferálhatnak), a `Dock`
   * ebből olvassa ki, melyik gombot rajzolja ki.
   */
  finishGesture: FinishGesture;
  setFinishGesture: (value: FinishGesture) => void;

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

/**
 * A MEGJELENÍTÉSHEZ használt legfrissebb fix — NEM a nyomvonal része.
 *
 * MIÉRT KELL KÜLÖN? A nyomvonalba csak az a minta kerül be, ami legalább
 * `FILTER.MIN_MOVE_M` (5 m) távolságra van az előzőtől: enélkül egy piros
 * lámpánál álló felhasználó „megtenne" pár száz métert a GPS zajából. A
 * mellékhatás viszont az volt, hogy a térképen a pötty is CSAK ötméterenként
 * mozdult — sétatempóban ez 3-4 másodperces szakadozás, ami a felhasználónak
 * úgy néz ki, mintha az app lefagyott volna.
 *
 * Ezért a két dolgot szétválasztjuk: a nyomvonal (és vele a távolság, a
 * cellák, a GP — minden, amit a játékmotor lát) változatlan szűréssel épül, a
 * térkép viszont MINDEN elfogadható pontosságú mintát megkap, másodpercenként.
 * A `livePosition` sehol nem folyik bele a számításba: kizárólag a pötty, a
 * kamera és a menetirány használja.
 */
export interface LivePosition {
  lat: number;
  lng: number;
  t: number;
  accuracy: number;
}

export type UploadState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'done'; summary: ActivitySummary; duplicate: boolean }
  | { status: 'error'; message: string; retryable: boolean };

export type FinishGesture = 'hold' | 'swipe';

const FINISH_GESTURE_KEY = 'grundo.finishGesture';

function readFinishGesture(): FinishGesture {
  try {
    return localStorage.getItem(FINISH_GESTURE_KEY) === 'swipe' ? 'swipe' : 'hold';
  } catch {
    return 'hold';
  }
}

export function useRecorder(source?: PositionSource, options: RecorderOptions = {}): RecorderApi {
  const positionSource = useMemo<PositionSource>(
    () => source ?? (isNativeApp() ? new NativePositionSource() : new BrowserPositionSource()),
    [source],
  );
  const runStore = useMemo(() => options.store ?? defaultRunStore(), [options.store]);
  const persister = useMemo(() => createRunPersister(runStore), [runStore]);
  const restoreSavedRun = options.restoreSavedRun !== false;
  const uploader = options.uploader;

  const stateRef = useRef<RecorderState>(createRecorder('run'));
  const [state, setState] = useState<RecorderState>(stateRef.current);
  const [error, setError] = useState<TrackingError | null>(null);
  const [hasFix, setHasFix] = useState(false);
  const [livePosition, setLivePosition] = useState<LivePosition | null>(null);
  const [resumable, setResumable] = useState<RecorderState | null>(null);
  const [resumableNotice, setResumableNotice] = useState<string | null>(null);
  const resumableRun = useRef<PersistedRun | null>(null);
  const [pendingType, setPendingType] = useState<ActivityType | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [statsFullView, setStatsFullView] = useState(false);
  const [finishGesture, setFinishGestureState] = useState<FinishGesture>(readFinishGesture);
  const setFinishGesture = useCallback((value: FinishGesture) => {
    setFinishGestureState(value);
    try {
      localStorage.setItem(FINISH_GESTURE_KEY, value);
    } catch {
      /* nem baj — a beállítás csak erre a munkamenetre él tovább */
    }
  }, []);
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
          // A térképé MINDEN pontos minta, a nyomvonalé csak a szűrésen
          // átjutó. A pontossági kapu itt is kell: egy 200 méteres hálózati
          // becslés a pöttyöt a szomszéd utcába vinné.
          if (isDisplayableFix(sample)) {
            setLivePosition((previous) =>
              // Natív forrásból ébredés után kötegelve, sorrenden kívül is
              // érkezhet minta; a pötty nem ugorhat vissza a múltba.
              previous !== null && sample.t < previous.t
                ? previous
                : { lat: sample.lat, lng: sample.lng, t: sample.t, accuracy: sample.accuracy },
            );
          }
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

  /**
   * A KÉPERNYŐZÁR-TILTÁS CSAK A BÖNGÉSZŐNEK KELL.
   *
   * A `wakeLock.ts` maga mondja meg, miért létezik: a WEBES rögzítésnek
   * feltétele, mert elalvó képernyőnél a lap nem látható, és a
   * `watchPosition` elhallgat.
   *
   * A natív appban ez az indok nem áll fenn. Ott a `BackgroundLocationPlugin`
   * mér (iOS: Core Location a `UIBackgroundModes: location` alatt; Android:
   * location típusú foreground service), a WebView alvása közben érkező
   * pontok pedig tartós sorba kerülnek, és a következő ébredéskor a `drain`
   * átveszi őket. A kijelző ébren tartása tehát semmit nem véd meg —
   * cserébe egy órás futás alatt végig világít a képernyő a zsebben, ami egy
   * telefonon nagyságrendekkel többet fogyaszt, mint maga a GPS.
   *
   * (GRUNDO #21 energiaelemzés, B1. ⚠️ Hogy a WKWebView egyáltalán MEGADJA-e
   * a zárat, azt nem mértük — de a natív ágon így sem kérjük, tehát a kérdés
   * tárgytalanná vált.)
   */
  const acquireWakeLock = useCallback(async () => {
    if (isNativeApp()) return;
    if (!wakeLockSupported()) return;
    wakeRef.current = await requestWakeLock();
    setWakeLockActive(wakeRef.current.active);
  }, []);

  const releaseWakeLock = useCallback(async () => {
    await wakeRef.current?.release();
    wakeRef.current = null;
    setWakeLockActive(false);
  }, []);

  useEffect(() => {
    if (!restoreSavedRun) return;
    let cancelled = false;
    void (async () => {
      const saved: PersistedRun | null = await runStore.read().catch(() => null);
      if (cancelled || saved === null) return;

      const strategy = restoreStrategy(saved, Date.now(), isNativeApp());
      if (strategy === 'automatic') {
        // A natív WebView újraindulhat, miközben a natív helyszolgáltatás
        // tovább fut. Ez nem félbehagyott út: a mentett
        // állapotot kérdés és mesterséges szünet nélkül visszavesszük, majd a
        // natív sorból azonnal beolvassuk a közben érkezett pontokat.
        stateRef.current = saved.state;
        setState(saved.state);
        persister.save(saved.state);
        await attach(saved.state.type, saved.state);
        if (!cancelled) await acquireWakeLock();
        return;
      }
      if (strategy === 'prompt') {
        resumableRun.current = saved;
        setResumable(saved.state);
        setResumableNotice(describeResumeCause(readLastLifecycleEvent(), currentNavigationType()));
        return;
      }
      await runStore.clear().catch(() => undefined);
    })().catch((err: unknown) => {
      if (!cancelled) {
        setError(
          err instanceof TrackingError
            ? err
            : new TrackingError('unavailable', 'A folyamatban lévő mérés helyreállítása nem sikerült.'),
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [acquireWakeLock, attach, persister, restoreSavedRun, runStore]);

  /**
   * Leiratkozás a lap elhagyásakor.
   *
   * A képernyőzárat MINDENKÉPP el kell engedni: ha itt bent maradna, a
   * felhasználó telefonja a rögzítés vége után is ébren maradna, és ezt már
   * semmiből nem tudná visszakapcsolni.
   */
  useEffect(() => {
    return () => {
      const active = stateRef.current.status === 'recording' || stateRef.current.status === 'paused';
      // Natív aktív mérésnél a React/WebView leválása nem jelent befejezést.
      // Csak a JS-listenereket bontjuk; a Core Location a következő WebView
      // kapcsolódásáig folytatja a tartós sor gyűjtését.
      void (active && positionSource.detach ? positionSource.detach() : positionSource.stop());
      void wakeRef.current?.release();
      void persister.flush();
    };
  }, [persister, positionSource]);

  /* ── Műveletek ─────────────────────────────────────────────────── */

  const begin = useCallback(
    async (type?: ActivityType) => {
      setHasFix(false);
      // Az előző rögzítés utolsó pöttye nem kísérthet az újba.
      setLivePosition(null);
      // A `?? 'run'` védelem: a gombot a Dock csak választott mozgásforma
      // mellett engedi megnyomni, ez tehát a gyakorlatban sosem sül el —
      // csak arra való, hogy egy hívó véletlenül se indíthasson típus nélkül.
      const resolvedType = type ?? pendingType ?? 'run';
      const started = apply(() => startRecorder(createRecorder(resolvedType), Date.now()));
      await acquireWakeLock();
      try {
        await attach(resolvedType, started);
      } catch {
        // Engedélymegtagadás vagy natív szolgáltatáshiba után nem maradhat
        // látszólag futó, valójában pontot nem gyűjtő aktivitás.
        await Promise.resolve(positionSource.stop()).catch(() => undefined);
        await releaseWakeLock();
        await persister.clear();
        stateRef.current = createRecorder(resolvedType);
        setState(stateRef.current);
      }
    },
    [acquireWakeLock, apply, attach, pendingType, persister, positionSource, releaseWakeLock],
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
    if (!uploader && !apiConfigured) {
      setUpload({
        status: 'error',
        message: 'A háttérszolgáltatás nincs beállítva, a mentés nem megy.',
        retryable: false,
      });
      return;
    }

    const input: RecorderUploadInput = {
      activityId: current.id,
      type: current.type,
      points: current.points,
      startedAt: current.startedAt ?? Date.now(),
      endedAt: current.endedAt ?? Date.now(),
      // A lezárt rögzítésnél az `endedAt` már megvan, tehát a „most"
      // paraméternek nincs szerepe — de a függvény kéri.
      movingMs: movingMsOf(current, current.endedAt ?? Date.now()),
    };

    setUpload({ status: 'sending' });
    try {
      const result = uploader ? await uploader(input) : await api.uploadActivity(input);
      setUpload({
        status: 'done',
        summary: result.summary,
        duplicate: result.duplicate === true,
      });
      // A mentett rögzítést nem kell tovább őrizni: a szerveren/sandboxban már megvan.
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
  }, [persister, uploader]);

  /**
   * A BEFEJEZÉS UTÁNI FELTÖLTÉS ITT INDUL, NEM A KÉPERNYŐN.
   *
   * ⚠️ EZ EGY VALÓDI, ÉLES ADATVESZTÉS JAVÍTÁSA (2026-08-26). Korábban ez a
   * hatás a `TrackingScreen`-ben ült — a Befejezés gomb viszont a `Dock`-ban
   * van, ami MINDEN képernyőn ott van. Aki rögzítés közben a böngésző
   * „vissza" gombjával elhagyta a rögzítés képernyőjét, majd befejezte a
   * mérést, annál a feltöltés SOHA nem indult el: a képernyő nem volt
   * felcsatolva, tehát a hatása sem futott. A felhasználó azt látta, hogy
   * befejezte és elmentette; a szerverre semmi nem érkezett.
   *
   * Éles adaton visszaigazolva (`nagz`, 2026-08-26): nulla aktivitás, nulla
   * trust-dokumentum, nulla GP-tétel — vagyis a kérés el sem jutott a
   * szerverig, nem pedig ott hasalt el.
   *
   * A feltöltés a RÖGZÍTŐ dolga, nem a képernyőé. Itt a provider alatt fut,
   * ami a routerNÉL feljebb van, tehát nem tud kikerülni a fa alól.
   */
  useEffect(() => {
    if (!shouldAutoUpload(state, upload.status, GAMEPLAY.MIN_DISTANCE_M)) return;
    void uploadActivity();
    // A `state` OBJEKTUM minden mintánál új, ezért csak a ténylegesen használt
    // két mezőjétől függünk — különben a hatás minden GPS-pontnál újrafutna.
  }, [state.status, state.distanceM, upload.status, uploadActivity]);

  /**
   * FIGYELMEZTETÉS AZ OLDAL ELHAGYÁSÁRA, amíg van mentetlen mérés.
   *
   * A böngésző „vissza" gombja egyetlen előzmény-bejegyzésnél KILÉP az
   * oldalról — a React Router ilyenkor már nem tud közbeszólni, és a memóriában
   * élő rögzítés a lap bezárásával elszáll. A megőrzött másolat visszakínálja
   * ugyan a futást, de csak ha a felhasználó egyáltalán visszatér.
   *
   * ⚠️ CSAK FUTÓ VAGY MENTETLEN MÉRÉSNÉL. Egy mindig ott lógó „biztosan
   * elhagyod?" ablak a leggyakoribb úton (nincs rögzítés) puszta bosszúság
   * lenne, és pont attól szoknák le róla az emberek, hogy elolvassák.
   *
   * A szöveget a böngészők nem jelenítik meg (saját, általános üzenetet
   * mutatnak) — a `preventDefault` az, ami számít.
   */
  useEffect(() => {
    const vanFuto = state.status === 'recording' || state.status === 'paused';
    const vanMentetlen = state.status === 'finished' && upload.status !== 'done';
    if (!vanFuto && !vanMentetlen) return;

    const figyelmeztet = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', figyelmeztet);
    return () => window.removeEventListener('beforeunload', figyelmeztet);
  }, [state.status, upload.status]);

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
    setLivePosition(null);
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
    livePosition,
    supportsBackground: positionSource.supportsBackground,
    wakeLockActive,
    resumable,
    resumableNotice,
    pendingType,
    setPendingType,
    pickerOpen,
    setPickerOpen,
    countdown,
    setCountdown,
    statsFullView,
    setStatsFullView,
    finishGesture,
    setFinishGesture,
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

/**
 * Kirajzolható-e ez a fix?
 *
 * Ugyanaz a pontossági küszöb, mint a nyomvonalszűrőben — csak a
 * távolság- és sebességfeltételek nélkül. Így a pötty soha nem kerül olyan
 * helyre, ahova a nyomvonal sem kerülhetne, viszont minden másodpercben
 * frissül.
 */
function isDisplayableFix(sample: { lat: number; lng: number; accuracy: number }): boolean {
  if (!Number.isFinite(sample.lat) || !Number.isFinite(sample.lng)) return false;
  // `!(x <= y)` és nem `x > y`: így a NaN pontosság is kiesik.
  return !!(sample.accuracy <= GAMEPLAY.MAX_GPS_ACCURACY_M);
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
