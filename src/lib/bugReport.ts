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

import { ref, uploadBytes } from 'firebase/storage';
import { api, type BugReportInput, type BugReportKind, type BugReportSeverity } from '@/lib/api';
import { readBreadcrumbs } from '@/lib/breadcrumbs';
import { currentSessionId, currentSessionStartedAt, type CrashHint } from '@/lib/debugMode';
import { storage } from '@/lib/firebase';
import { captureDeviceInfo } from '@/tracking/deviceInfo';

export class BugReportMediaError extends Error {}

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

/**
 * A melléklet feltöltése a bejelentés Storage-előtagja alá, majd rögzítése a
 * dokumentumon.
 *
 * A dokumentumot a szerver hozza létre (`uploadPrefix`-et is ő ad vissza), de
 * a bájtok közvetlenül a Storage-ba mennek — a `storage.rules` a beküldőt a
 * saját előtagjára korlátozza, a szerver a `mediaPathBelongsTo()`-val
 * ugyanezt ellenőrzi feltöltés UTÁN, a hivatkozás rögzítésekor.
 */
async function attachMedia(
  reportId: string,
  uploadPrefix: string,
  media: Blob,
  contentType: string,
): Promise<void> {
  if (!storage) throw new BugReportMediaError('A feltöltés nincs beállítva.');
  const extension = contentType === 'image/png' ? 'png' : 'bin';
  const path = `${uploadPrefix}${Date.now()}.${extension}`;
  await uploadBytes(ref(storage, path), media, { contentType });
  await api.attachBugReportMedia(reportId, { path, contentType, bytes: media.size });
}

/**
 * Összeállítás és beküldés egy lépésben, opcionális melléklettel.
 *
 * A visszatérés a bejelentés azonosítója. A melléklet feltöltése a
 * dokumentum létrehozása UTÁN történik — az `uploadPrefix` a `reportId`-t is
 * tartalmazza, tehát fordítva nem menne.
 */
export async function submitBugReport(draft: BugReportDraft, media?: Blob): Promise<string> {
  const input = await buildBugReport(draft);
  const created = await api.submitBugReport(input);
  if (media) {
    const contentType = draft.kind === 'screenshot' ? 'image/png' : media.type || 'application/octet-stream';
    await attachMedia(created.reportId, created.uploadPrefix, media, contentType);
  }
  return created.reportId;
}
