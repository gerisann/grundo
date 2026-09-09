import { useCallback, useState, type ReactNode } from 'react';
import { RivalBadge } from '@/components/RivalBadge';
import { api, apiConfigured } from '@/lib/api';
import { formatArea } from '@/lib/format';
import type { TileOwner } from '@/lib/api';
import type { Layer } from '@/types';
import './cellOwnerCard.css';

/**
 * A MEGKOPPINTOTT MEZŐ TULAJDONOSÁNAK KÁRTYÁJA — a Grund ÉS a rögzítés
 * képernyőnek közösen.
 *
 * ⚠️ MIÉRT LETT KÖZÖS. A kártya eredetileg a `TerritoryScreen`-be volt
 * beépítve, a rögzítés képernyő pedig NEM adott át `cellPopup`-ot a
 * `MapView`-nak. A koppintás ott mégis létrehozta a Mapbox popupját — csak
 * üresen: a felhasználó egy kis fekete pöttyöt látott a kártya helyett (Geri,
 * 2026-09-09). Két külön másolat helyett egy hely van, ahol a kártya él.
 *
 * A kártya a térkép popupjába megy, nem a felületi rétegbe: így pontosan ott
 * jelenik meg, ahova koppintottál, pásztázáskor a mezővel együtt mozog, és a
 * Mapbox gondoskodik arról, hogy a képernyő szélén befelé forduljon.
 */

export interface CellOwnerCardApi {
  /** A `MapView` `cellPopup` propjába megy; `null`, ha nincs mit mutatni. */
  cellPopup: ReactNode;
  /** A `MapView` `onCellPress` propjába megy. */
  onCellPress: (press: { cell: string; owner: string }) => void | Promise<void>;
  /** Kézi bezárás — pl. ha a képernyő más okból vált állapotot. */
  close: () => void;
}

export function useCellOwnerCard(layer: Layer): CellOwnerCardApi {
  const [owner, setOwner] = useState<TileOwner | null>(null);
  const [loading, setLoading] = useState(false);

  const close = useCallback(() => {
    setOwner(null);
    setLoading(false);
  }, []);

  /**
   * A kártya adatát KOPPINTÁSKOR kérjük le, nem a csempékkel együtt: a
   * profilkép, a rang és az összesítők minden csempe-lekérésnél átvinni
   * pazarlás lenne, hiszen egyszerre legfeljebb egy kártya látszik.
   */
  const onCellPress = useCallback(
    async ({ owner: uid }: { cell: string; owner: string }) => {
      if (!apiConfigured || !uid) return;
      setLoading(true);
      setOwner(null);
      try {
        const result = await api.tileOwner(uid, layer);
        setOwner(result.owner);
      } catch {
        // A tulajdonos időközben törölhette a fiókját — ilyenkor nincs kártya.
        setOwner(null);
      } finally {
        setLoading(false);
      }
    },
    [layer],
  );

  const cellPopup =
    loading || owner ? (
      <div className="owner-card" role="dialog" aria-label="A mező tulajdonosa">
        {owner ? (
          <>
            <div className="owner-card__avatar">
              {owner.photoURL ? (
                <img src={owner.photoURL} alt="" />
              ) : (
                <span>{owner.username.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            <div className="owner-card__body">
              <strong className="owner-card__name">
                {owner.username} <RivalBadge uid={owner.uid} />
              </strong>
              <span className="owner-card__rank">{owner.rankName}</span>
              <span className="owner-card__stats">
                {formatArea(owner.areaM2)} · {owner.gpTotal.toLocaleString('hu-HU')} GP
              </span>
            </div>
          </>
        ) : (
          <span className="owner-card__loading">Betöltés…</span>
        )}
        <button type="button" className="owner-card__close" aria-label="Bezárás" onClick={close}>
          ×
        </button>
      </div>
    ) : null;

  return { cellPopup, onCellPress, close };
}
