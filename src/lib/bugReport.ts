/**
 * A hibabejelentés összeállítása és beküldése.
 *
 * Amit a tesztelő ír, az egy mondat. Amit a fejlesztő keres, az a build, az
 * eszköz, az útvonal, az engedélyek állapota és az, ami az esemény ELŐTT
 * történt. Ez a modul rakja össze a kettőt.
 *
 * ⚠️ SEMMI, AMI HELYADAT. A kontextusban nincs koordináta, se pontosság, se
 * cellaazonosító — a rögzítés állapota állapotnév marad (lásd
 * `src/lib/breadcrumbs.ts` fejlécét).
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md
 */

import { api, type BugReportInput, type BugReportKind, type BugReportSeverity } from '@/lib/api';
import { readBreadcrumbs } from '@/lib/breadcrumbs';
import { currentSessionId, currentSessionStartedAt, type CrashHint } from '@/lib/debugMode';
import { captureDeviceInfo } from '@/tracking/deviceInfo';

export interface BugReportDraft {
  kind: BugReportKind;
  severity: BugReportSeverity;
  note: string;
  /** A rögzítő állapota, ha a hívó tudja — mindig állapotnév, sosem adat. */
  recorder?: string;
  crash?: CrashHint;
}

/**
 * Engedélyek állapota, ha a böngésző elárulja.
 *
 * A `navigator.permissions` a Safariban és a WKWebView-ban hiányos: a
 * `geolocation` lekérdezése ott dobhat vagy egyszerűen nem létezik. Ezért nem
 * hiba, ha `ismeretlen` marad — az is információ, hogy nem tudjuk.
 */
async function readPermissions(): Promise<Record<string, string>> {
  const out: Record<string, string> = { location: 'ismeretlen', notifications: 'ismeretlen' };

  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    if (status) out.location = status.state;
  } catch {
    // marad `ismeretlen`
  }

  try {
    if (typeof Notification !== 'undefined') out.notifications = Notification.permission;
  } catch {
    // marad `ismeretlen`
  }

  return out;
}

function readMemoryMB(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize?: number } }).memory;
  const bytes = memory?.usedJSHeapSize;
  return typeof bytes === 'number' ? Math.round(bytes / (1024 * 1024)) : null;
}

export async function buildBugReport(draft: BugReportDraft): Promise<BugReportInput> {
  const startedAt = currentSessionStartedAt();
  const permissions = await readPermissions();
  const memoryMB = readMemoryMB();

  return {
    kind: draft.kind,
    severity: draft.severity,
    note: draft.note.trim(),
    device: captureDeviceInfo(),
    context: {
      route: `${window.location.pathname}${window.location.search}`,
      sessionId: currentSessionId(),
      online: navigator.onLine,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      dpr: window.devicePixelRatio,
      startedAt,
      uptimeMs: startedAt ? Date.now() - startedAt : 0,
      ...(memoryMB == null ? {} : { memoryMB }),
    },
    state: {
      permissions,
      ...(draft.recorder ? { recorder: draft.recorder } : {}),
    },
    logs: readBreadcrumbs(),
    ...(draft.crash
      ? {
          crash: {
            previousSessionId: draft.crash.previousSessionId,
            lastRoute: draft.crash.lastRoute,
            startedAt: draft.crash.startedAt,
            seenAt: draft.crash.seenAt,
          },
        }
      : {}),
  };
}

/** Összeállítás és beküldés egy lépésben. A visszatérés a bejelentés azonosítója. */
export async function submitBugReport(draft: BugReportDraft): Promise<string> {
  const input = await buildBugReport(draft);
  const created = await api.submitBugReport(input);
  return created.reportId;
}
