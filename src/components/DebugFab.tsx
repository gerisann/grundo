import { useCallback, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBug } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@/components/ui';
import { BugReportSheet } from '@/components/BugReportSheet';
import { readBreadcrumbs, type Breadcrumb } from '@/lib/breadcrumbs';
import { isNativeApp } from '@/lib/platform';
import { captureScreenshot } from '@/lib/screenshot';
import {
  MAX_VIDEO_DURATION_MS,
  startVideoRecording,
  stopVideoRecording,
  type RecordedVideo,
} from '@/lib/videoRecording';
import './debug.css';

/**
 * A lebegő hibabejelentő gomb — debug módban, a tesztelőnek.
 *
 * ⚠️ MINDEN FÖLÖTT ÜL (z-index 70), mert pont azt kell tudni bejelenteni, ami
 * eltakarja a felületet. Ezért HÚZHATÓ is: ahová a tesztelő teszi, ott marad,
 * és a pozíció túléli az újraindítást.
 *
 * ⚠️ A HÚZÁS ÉS A KOPPINTÁS ELVÁLASZTÁSA a `pointerup`-ban dől el, nem a
 * `click`-ben: a Dock és a Befejezés gomb tanulsága szerint (GRUNDO #43) a
 * mutató-eseményeket kell elkapni, és a `pointercancel`-t kezelni kell — a
 * `pointerleave`-et viszont NEM, mert az a húzást szakítaná meg.
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md → 6.
 */

const POSITION_KEY = 'grundo.debug.fab';
const SIZE = 48;
const EDGE = 12;
/** Ennyi képpontnál nagyobb elmozdulás már húzás, nem koppintás. */
const DRAG_THRESHOLD = 6;

interface Position {
  x: number;
  y: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function defaultPosition(): Position {
  /**
   * Jobb szél, a Dock fölött.
   *
   * ⚠️ A rögzítés vezérlői a képernyő alján, középen vannak — az induló hely
   * nem takarhatja őket, különben az első koppintás pont a Play gombot nyeli
   * el.
   */
  return {
    x: Math.max(EDGE, window.innerWidth - SIZE - EDGE),
    y: Math.max(EDGE, window.innerHeight - SIZE - 140),
  };
}

function readPosition(): Position {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return defaultPosition();
    const parsed = JSON.parse(raw) as Partial<Position>;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return defaultPosition();
    return {
      x: clamp(Number(parsed.x), EDGE, Math.max(EDGE, window.innerWidth - SIZE - EDGE)),
      y: clamp(Number(parsed.y), EDGE, Math.max(EDGE, window.innerHeight - SIZE - EDGE)),
    };
  } catch {
    return defaultPosition();
  }
}

function writePosition(position: Position): void {
  try {
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(position));
  } catch {
    // A pozíció elvesztése kellemetlen, de nem hiba — a gomb működik nélküle.
  }
}

function fmtTime(t: number): string {
  const date = new Date(t);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
}

type Panel = 'none' | 'menu' | 'report' | 'log' | 'screenshot' | 'video';

export function DebugFab({ recorder }: { recorder?: string }) {
  const [position, setPosition] = useState<Position>(readPosition);
  const [dragging, setDragging] = useState(false);
  const [panel, setPanel] = useState<Panel>('none');
  const [log, setLog] = useState<Breadcrumb[]>([]);
  // A kép rögzítése alatt a gomb is eltűnik — a natív pillanatkép a TELJES
  // webnézetet menti, tehát a 🐞 gomb is rajta lenne, ha nyitva marad.
  const [capturing, setCapturing] = useState(false);
  const [screenshot, setScreenshot] = useState<Blob | null>(null);
  const [screenshotError, setScreenshotError] = useState('');
  const [video, setVideo] = useState<RecordedVideo | null>(null);
  const [videoError, setVideoError] = useState('');
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [stoppingVideo, setStoppingVideo] = useState(false);
  const [videoElapsedMs, setVideoElapsedMs] = useState(0);
  const videoStartedAt = useRef(0);
  const videoStopInFlight = useRef(false);

  /** A húzás állapota refben: a mozgás nem renderelhet minden mintánál. */
  const drag = useRef<{
    dx: number;
    dy: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  /** Elforgatásnál a gomb kicsúszhatna a képernyőről. */
  useEffect(() => {
    function onResize() {
      setPosition((current) => ({
        x: clamp(current.x, EDGE, Math.max(EDGE, window.innerWidth - SIZE - EDGE)),
        y: clamp(current.y, EDGE, Math.max(EDGE, window.innerHeight - SIZE - EDGE)),
      }));
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();
    drag.current = {
      dx: event.clientX - rect.left,
      dy: event.clientY - rect.top,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state) return;
    /**
     * A küszöböt a LENYOMÁS helyéhez mérjük, nem az előző mintához: az ujj
     * remegése mintánként két képpont, de tíz minta alatt már elmozdulás — ha
     * mintánként hasonlítanánk, a koppintás sosem válna húzássá.
     */
    if (Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > DRAG_THRESHOLD) {
      state.moved = true;
    }
    setPosition({
      x: clamp(event.clientX - state.dx, EDGE, Math.max(EDGE, window.innerWidth - SIZE - EDGE)),
      y: clamp(event.clientY - state.dy, EDGE, Math.max(EDGE, window.innerHeight - SIZE - EDGE)),
    });
  }, []);

  const endDrag = useCallback((opened: boolean) => {
    const state = drag.current;
    drag.current = null;
    setDragging(false);
    if (!state) return;

    if (state.moved) {
      /**
       * A szélre pattan. Középen hagyva a gomb a tartalom fölött lebegne;
       * az élhez húzva viszont csak egy sávot takar.
       */
      setPosition((current) => {
        const snapped = {
          x: current.x + SIZE / 2 < window.innerWidth / 2
            ? EDGE
            : Math.max(EDGE, window.innerWidth - SIZE - EDGE),
          y: current.y,
        };
        writePosition(snapped);
        return snapped;
      });
      return;
    }

    if (opened) setPanel('menu');
  }, []);

  /**
   * Képernyőkép: a menüt és a gombot is el kell tüntetni MIELŐTT a natív
   * plugin lefényképezi a webnézetet — utána visszaállítjuk, a felhasználó
   * ebből legfeljebb egy villanást lát.
   */
  const openScreenshot = useCallback(() => {
    setPanel('none');
    setScreenshotError('');
    setCapturing(true);
    // Két animációs keret vár, hogy a menü/gomb eltűnése a WebView-ban
    // ténylegesen kirajzolódjon, mielőtt a pillanatkép elkészül.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        captureScreenshot()
          .then((blob) => {
            setScreenshot(blob);
            setPanel('screenshot');
          })
          .catch((cause: unknown) => {
            setScreenshotError(
              cause instanceof Error ? cause.message : 'A képernyőkép nem készült el.',
            );
            setPanel('menu');
          })
          .finally(() => setCapturing(false));
      });
    });
  }, []);

  const finishVideo = useCallback(() => {
    if (videoStopInFlight.current) return;
    videoStopInFlight.current = true;
    setRecordingVideo(false);
    setStoppingVideo(true);
    stopVideoRecording()
      .then((result) => {
        setVideo(result);
        setPanel('video');
      })
      .catch((cause: unknown) => {
        setVideoError(cause instanceof Error ? cause.message : 'A videó nem készült el.');
        setPanel('menu');
      })
      .finally(() => {
        videoStopInFlight.current = false;
        setStoppingVideo(false);
      });
  }, []);

  const openVideo = useCallback(() => {
    setPanel('none');
    setVideoError('');
    setVideoElapsedMs(0);
    startVideoRecording()
      .then(() => {
        videoStartedAt.current = Date.now();
        setRecordingVideo(true);
      })
      .catch((cause: unknown) => {
        setVideoError(cause instanceof Error ? cause.message : 'A videórögzítés nem indult el.');
        setPanel('menu');
      });
  }, []);

  useEffect(() => {
    if (!recordingVideo) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - videoStartedAt.current;
      setVideoElapsedMs(Math.min(MAX_VIDEO_DURATION_MS, elapsed));
      if (elapsed >= MAX_VIDEO_DURATION_MS) {
        window.clearInterval(timer);
        finishVideo();
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [finishVideo, recordingVideo]);

  return (
    <>
      {recordingVideo ? (
        <button
          type="button"
          className="dbg-fab dbg-fab--recording"
          style={{ left: position.x, top: position.y }}
          aria-label="Videórögzítés leállítása"
          title="Videórögzítés leállítása"
          onClick={finishVideo}
        >
          <span aria-hidden="true">■</span>
          <span className="dbg-fab__timer">
            {Math.max(0, Math.ceil((MAX_VIDEO_DURATION_MS - videoElapsedMs) / 1000))}
          </span>
        </button>
      ) : !capturing && !stoppingVideo ? (
        <button
          type="button"
          className={`dbg-fab${dragging ? ' dbg-fab--dragging' : ''}`}
          style={{ left: position.x, top: position.y }}
          aria-label="Hibabejelentő"
          title="Hibabejelentő"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={() => endDrag(true)}
          /* A rendszer által megszakított mutató (pl. bejövő hívás) NEM nyithat
             menüt — de a húzást le kell zárni, különben a gomb beragad. */
          onPointerCancel={() => endDrag(false)}
        >
          <FontAwesomeIcon icon={faBug} aria-hidden="true" />
        </button>
      ) : null}

      {panel === 'menu' ? (
        <div className="dbg-menu" role="dialog" aria-label="Hibabejelentő menü">
          <button
            type="button"
            className="dbg-menu__scrim"
            aria-label="Bezárás"
            onClick={() => setPanel('none')}
          />
          <div className="dbg-menu__panel">
            <span className="dbg-menu__title">Hibabejelentő</span>

            {isNativeApp() ? (
              <button type="button" className="dbg-menu__row" onClick={openScreenshot}>
                <span aria-hidden="true">📷</span> Képernyőkép
              </button>
            ) : (
              <button type="button" className="dbg-menu__row" disabled>
                <span aria-hidden="true">📷</span> Képernyőkép
                <span className="dbg-menu__row-soon">csak natívban</span>
              </button>
            )}
            {isNativeApp() ? (
              <button type="button" className="dbg-menu__row" onClick={openVideo}>
                <span aria-hidden="true">🎬</span> Videó
                <span className="dbg-menu__row-soon">legfeljebb 30 mp</span>
              </button>
            ) : (
              <button type="button" className="dbg-menu__row" disabled>
                <span aria-hidden="true">🎬</span> Videó
                <span className="dbg-menu__row-soon">csak natívban</span>
              </button>
            )}
            <button type="button" className="dbg-menu__row" onClick={() => setPanel('report')}>
              <span aria-hidden="true">📝</span> Report
            </button>
            <button
              type="button"
              className="dbg-menu__row"
              onClick={() => {
                setLog(readBreadcrumbs());
                setPanel('log');
              }}
            >
              <span aria-hidden="true">📜</span> Napló
            </button>

            {screenshotError ? (
              <p className="dbg-status dbg-status--error" role="alert">
                {screenshotError}
              </p>
            ) : null}
            {videoError ? (
              <p className="dbg-status dbg-status--error" role="alert">
                {videoError}
              </p>
            ) : null}

            <p className="dbg-menu__note">
              A bejelentéshez a build, az eszköz, az útvonal, az engedélyek és a napló
              automatikusan hozzákerül.
            </p>
          </div>
        </div>
      ) : null}

      {panel === 'log' ? (
        <div className="dbg-menu" role="dialog" aria-label="Napló">
          <button
            type="button"
            className="dbg-menu__scrim"
            aria-label="Bezárás"
            onClick={() => setPanel('menu')}
          />
          <div className="dbg-menu__panel">
            <span className="dbg-menu__title">Napló ({log.length})</span>
            <div className="dbg-log">
              {log.length === 0 ? (
                <span className="dbg-log__row">Még nincs bejegyzés.</span>
              ) : (
                log.map((entry, index) => (
                  <span
                    key={`${entry.t}-${index}`}
                    className={`dbg-log__row${entry.level === 'error' ? ' dbg-log__row--error' : ''}`}
                  >
                    <span className="dbg-log__time">{fmtTime(entry.t)}</span>
                    <span>
                      [{entry.level}] {entry.msg}
                    </span>
                  </span>
                ))
              )}
            </div>
            <Button variant="ghost" block onClick={() => setPanel('menu')}>
              Vissza
            </Button>
          </div>
        </div>
      ) : null}

      {panel === 'report' ? (
        <BugReportSheet
          kind="report"
          recorder={recorder}
          title="Hiba bejelentése"
          lead="Írd le pár szóban, mi történt. A többit az app hozzáteszi."
          onClose={() => setPanel('none')}
        />
      ) : null}

      {panel === 'screenshot' && screenshot ? (
        <BugReportSheet
          kind="screenshot"
          recorder={recorder}
          media={screenshot}
          title="Képernyőkép beküldése"
          lead="Ez a kép megy fel a report mellé. Írhatsz hozzá pár szót, de nem kötelező."
          onClose={() => {
            setScreenshot(null);
            setPanel('none');
          }}
        />
      ) : null}

      {panel === 'video' && video ? (
        <BugReportSheet
          kind="video"
          recorder={recorder}
          media={video.blob}
          mediaDurationMs={video.durationMs}
          title="Videó beküldése"
          lead="Nézd meg a felvételt. Csak akkor kerül fel, ha a Küldésre koppintasz."
          onClose={() => {
            setVideo(null);
            setPanel('none');
          }}
        />
      ) : null}
    </>
  );
}
