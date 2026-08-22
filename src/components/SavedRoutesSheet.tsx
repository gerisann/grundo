import { useEffect, useState } from 'react';
import { Button } from '@/components/ui';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { routeImageUrl } from '@/lib/staticMap';
import { formatDistance, formatNumber } from '@/lib/format';
import { MISSION_KIND_META, missionAreaStat } from '@/lib/missionMeta';
import { listSavedRoutes, removeSavedRoute, type SavedRoute } from '@/lib/savedRoutes';
import type { Mission } from '@/lib/api';
import './savedRoutesSheet.css';

/**
 * Mentett útvonalak — teljes képernyős lap.
 *
 * A rögzítés indítás előtti állapotából nyílik (docs/02 → „Nagy play gomb +
 * Mentett útvonalak gomb"). Ugyanaz a szerkezet, mint a többi teljes
 * képernyős lap (`ConnectionsSheet`, `NotificationPanel`): fejléc balra,
 * bezárás a jobb sarokban, Escape zár, z-index 60.
 *
 * Indításkor NEM navigál — a hívó már a rögzítés képernyőn áll. A sheet csak
 * a kiválasztott útvonalat adja vissza (`onSelect`), a hívó teszi
 * szellemvonallá és zárja be saját magát.
 */
export function SavedRoutesSheet({
  onSelect,
  onClose,
}: {
  onSelect: (mission: Mission) => void;
  onClose: () => void;
}) {
  const [routes, setRoutes] = useState<SavedRoute[]>(() => listSavedRoutes());

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function remove(id: string) {
    removeSavedRoute(id);
    setRoutes((prev) => prev.filter((route) => route.id !== id));
  }

  return (
    <div className="saved" role="dialog" aria-modal="true" aria-label="Mentett útvonalak">
      <header className="saved__head">
        <h2 className="saved__title">Mentett útvonalak</h2>
        <button type="button" className="saved__close" aria-label="Bezárás" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div className="saved__list">
        {routes.length === 0 ? (
          <p className="saved__note">
            Még nincs mentett útvonalad. A Küldetések fülön generálhatsz ajánlatot, ott a kártyán
            a „Mentés" gombbal teheted el.
          </p>
        ) : (
          routes.map((route) => (
            <SavedRouteRow
              key={route.id}
              route={route}
              onStart={() => onSelect(route.mission)}
              onRemove={() => remove(route.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SavedRouteRow({
  route,
  onStart,
  onRemove,
}: {
  route: SavedRoute;
  onStart: () => void;
  onRemove: () => void;
}) {
  const { theme } = useThemeContext();
  const { mission } = route;
  const meta = MISSION_KIND_META[mission.kind];
  const [mapFailed, setMapFailed] = useState(false);
  const mapUrl = mapFailed
    ? null
    : routeImageUrl(mission.polyline, { theme, width: 320, height: 140 });
  const area = missionAreaStat(mission);

  return (
    <div className="saved__row">
      {mapUrl ? (
        <img
          className="saved__map"
          src={mapUrl}
          alt=""
          loading="lazy"
          onError={() => setMapFailed(true)}
        />
      ) : null}

      <div className="saved__body">
        <div className="saved__row-head">
          <span className={`saved__badge saved__badge--${meta.tone}`}>{meta.label}</span>
          <span className="saved__distance">{formatDistance(mission.distanceKm * 1000)}</span>
        </div>

        <p className="saved__stats">
          {area.label}: {area.value} · {formatNumber(mission.estimatedGp)} GP
        </p>

        <div className="saved__actions">
          <Button size="sm" onClick={onStart}>
            Indítás
          </Button>
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Törlés
          </Button>
        </div>
      </div>
    </div>
  );
}

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
