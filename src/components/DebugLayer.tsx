import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { DebugFab } from '@/components/DebugFab';
import { ModeChooser } from '@/components/ModeChooser';
import { BugReportSheet } from '@/components/BugReportSheet';
import { armBreadcrumbs, addBreadcrumb, disarmBreadcrumbs } from '@/lib/breadcrumbs';
import {
  askModeOnStart,
  closeAppSession,
  getAppMode,
  noteSessionMode,
  noteSessionRoute,
  reopenAppSession,
  setAppMode,
  setAskModeOnStart,
  startAppSession,
  subscribeAppMode,
  takeCrashHint,
  type AppMode,
  type CrashHint,
} from '@/lib/debugMode';
import './debug.css';

/**
 * A tesztelői debug réteg — EGY helyen minden, ami csak a tesztelőnek fut.
 *
 * ⚠️ A komponens LUSTÁN töltődik (`App.tsx`), és csak akkor kerül a fába, ha a
 * felhasználó jogosult rá. A normál felhasználó böngészője egyetlen bájtot sem
 * tölt le belőle — ugyanaz az elv, mint az admin területnél (`docs/06`).
 *
 * Felelősségei:
 * 1. menet nyitása és zárása (ebből derül ki, ha az előző nem zárult rendesen),
 * 2. az üzemmód-választó megjelenítése hidegindításkor,
 * 3. debug módban a morzsanapló bekapcsolása és a lebegő gomb,
 * 4. crash report felajánlása, ha az előző menet nyitva maradt.
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md
 */

export function DebugLayer({ recorder }: { recorder?: string }) {
  const { pathname } = useLocation();
  const [mode, setMode] = useState<AppMode>(getAppMode);
  const [asking, setAsking] = useState(false);
  const [crash, setCrash] = useState<CrashHint | null>(null);
  const [crashDismissed, setCrashDismissed] = useState(false);

  /* 1. A menet nyitása — pontosan egyszer, a réteg életében. */
  useEffect(() => {
    const hint = startAppSession(getAppMode(), window.location.pathname);
    setCrash(hint);
    setAsking(askModeOnStart());

    /**
     * ⚠️ A `beforeunload` natív WebView-ban megbízhatatlan — a `pagehide` és a
     * `visibilitychange` az, ami háttérbe küldéskor tényleg lefut. Ugyanazt a
     * két eseményt figyeli a rögzítő is (`src/tracking/lifecycleTimeline.ts`),
     * tehát nem kell hozzá új Capacitor-plugin és vele új natív build.
     */
    const onHide = () => closeAppSession();
    const onShow = () => reopenAppSession();
    const onVisibility = () => {
      const visible = document.visibilityState === 'visible';
      addBreadcrumb('life', visible ? 'előtérbe került' : 'háttérbe került');
      if (visible) reopenAppSession();
      else closeAppSession();
    };

    window.addEventListener('pagehide', onHide);
    window.addEventListener('pageshow', onShow);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('pageshow', onShow);
      document.removeEventListener('visibilitychange', onVisibility);
      closeAppSession();
    };
  }, []);

  /**
   * Az üzemmód a Beállításokból is átállítható — a réteg onnan is értesül
   * róla, különben a lebegő gomb csak újraindítás után tűnne el vagy jelenne
   * meg.
   */
  useEffect(() => subscribeAppMode(setMode), []);

  /* 3. A napló csak debug módban gyűjt — a bekapcsolás itt dől el. */
  useEffect(() => {
    if (mode !== 'debug') {
      disarmBreadcrumbs();
      return;
    }
    const disarm = armBreadcrumbs();
    addBreadcrumb('info', 'Debug mód bekapcsolva');
    return disarm;
  }, [mode]);

  /* Az útvonal a menetrekordba és a naplóba is bekerül. */
  useEffect(() => {
    noteSessionRoute(pathname);
    addBreadcrumb('route', pathname);
  }, [pathname]);

  /**
   * A rögzítő állapotátmenetei — ÁLLAPOTNÉV, sosem adat.
   *
   * Sok hibajelentés a mentés körül keletkezik („nem tűnt el a mentőlap",
   * „elveszett a rögzítés"), és ilyenkor a legfontosabb kérdés, hogy a
   * feltöltés melyik állapotban ragadt meg.
   */
  useEffect(() => {
    if (recorder) addBreadcrumb('info', `rögzítő: ${recorder}`);
  }, [recorder]);

  function choose(next: AppMode, askAgain: boolean) {
    setAppMode(next);
    noteSessionMode(next);
    setAskModeOnStart(askAgain);
    setMode(next);
    setAsking(false);
  }

  if (asking) return <ModeChooser current={mode} onChoose={choose} />;
  if (mode !== 'debug') return null;

  /**
   * A crash-felajánlás szövege NEM állítja, hogy összeomlott.
   *
   * Ugyanígy néz ki a valódi összeomlás, az app-váltóból kihúzás és az OS
   * memória-visszavétele is — mérni nem tudjuk szét őket, tehát nem is
   * mondhatjuk meg. A natív bizonyíték az F4-es Crashlytics lesz.
   */
  if (crash && !crashDismissed) {
    return (
      <BugReportSheet
        kind="crash"
        crash={crash}
        recorder={recorder}
        title="Az app váratlanul bezárult"
        lead="Elküldöd, mi történt előtte? A napló és az utolsó képernyő automatikusan hozzákerül. Ha emlékszel rá, írd le, mit csináltál."
        onClose={() => {
          setCrashDismissed(true);
          takeCrashHint();
        }}
      />
    );
  }

  return <DebugFab recorder={recorder} />;
}
