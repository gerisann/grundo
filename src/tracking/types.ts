import type { ActivityType } from '@/types';

/**
 * GRUNDO rögzítés — közös típusok.
 *
 * A modul szándékosan nem ismer sem böngészőt, sem natív platformot: a
 * pozíció forrása egy interfész mögött van. Ennek nem elvi oka van, hanem
 * gyakorlati — a böngészőben nem lehet háttérben mérni (a `watchPosition`
 * leáll, amint az oldal nem látható), ezért előbb-utóbb natív burok kell,
 * és akkor csak ezt az egy interfészt akarjuk lecserélni.
 */

/**
 * Egy nyers helymeghatározás.
 *
 * Szándékosan a `TracePoint` bővítése (`src/types`): minden mező, amit a
 * játékmotor vár, ugyanazon a néven szerepel benne, tehát egy elfogadott
 * minta átalakítás nélkül átadható a motornak.
 */
export interface PositionSample {
  lat: number;
  lng: number;
  /** epoch ms */
  t: number;
  /** vízszintes pontosság méterben — a szűrés legfontosabb bemenete */
  accuracy: number;
  /** méter a tengerszint felett, ha az eszköz jelenti */
  elevation?: number;
  /** m/s az eszköz szerint. Nem hiszünk el vakon, csak jelzésnek használjuk. */
  speed?: number;
}

export type TrackingErrorCode =
  /** A felhasználó megtagadta a helyhozzáférést. */
  | 'permission_denied'
  /** Nincs helymeghatározás (nincs GPS, ki van kapcsolva, nincs jel). */
  | 'unavailable'
  /** Nem érkezett fix a megadott időn belül. */
  | 'timeout'
  /** A böngésző csak biztonságos eredeten ad helyet (https vagy localhost). */
  | 'insecure_context'
  /** A futtatókörnyezet egyáltalán nem ismeri a helymeghatározást. */
  | 'unsupported';

export class TrackingError extends Error {
  constructor(
    public readonly code: TrackingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'TrackingError';
  }
}

export interface PositionHandlers {
  onSample(sample: PositionSample): void;
  onError(error: TrackingError): void;
}

/** A natív zárolt képernyős méréshez szükséges, kis méretű állapotpillanatkép. */
export interface PositionActivityState {
  startedAt: number;
  distanceM: number;
  pausedMs: number;
  pausedAt: number | null;
  status: 'recording' | 'paused';
}

export interface PositionSource {
  readonly name: string;

  /**
   * Mér-e akkor is, ha a felhasználó lezárja a telefont vagy másik appra vált.
   *
   * Böngészőben ez MINDIG hamis, és nem beállítás kérdése: sem az iOS, sem az
   * Android nem ad webes API-t háttér-helymeghatározásra. A felület ez alapján
   * figyelmezteti a felhasználót, hogy tartsa ébren a képernyőt.
   */
  readonly supportsBackground: boolean;

  /**
   * Megbízható-e az időbélyegek sorrendje.
   *
   * A natív háttérszolgáltatások ébredés után KÖTEGELVE szállítanak, és a
   * köteg tartalmazhat olyan mintát, amelynek időbélyege korábbi a már
   * feldolgozottnál. A rögzítő ezt amúgy is kezeli, de a diagnosztikához
   * hasznos tudni, melyik forrástól várható.
   */
  readonly ordered: boolean;

  /** A mozgásforma a natív szolgáltatás energia- és aktivitási profiljához kell. */
  start(
    handlers: PositionHandlers,
    activityType?: ActivityType,
    activityState?: PositionActivityState,
  ): Promise<void>;
  /** Előtérben a pontos, szűrt recorder-állapotot átadja a Live Activitynek. */
  syncActivity?(state: PositionActivityState): void | Promise<void>;
  stop(): void | Promise<void>;
}
