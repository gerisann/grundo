import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { routeImageUrl } from '@/lib/staticMap';
import {
  activityTitle,
  formatArea,
  formatDistance,
  formatDuration,
  formatEffort,
  formatGp,
  formatRelativeDay,
} from '@/lib/format';
import type { FeedActivity } from '@/lib/api';
import './activityCard.css';

/**
 * Egy aktivitás a feedben.
 *
 * A kártya EGÉSZE kattintható, nem csak egy „részletek" hivatkozás: a
 * felületen ez a legnagyobb elem, és mobilon hüvelykujjal a nagy célfelület a
 * használhatóság alapfeltétele.
 *
 * A GRUNDO-sáv az, ami megkülönbözteti egy futóapp kártyájától: a táv és az
 * idő mellett ott van, hogy ebből az aktivitásból mennyi TERÜLET és mennyi
 * PONT lett. Ez a játék visszajelzése — enélkül a kártya csak napló.
 */
export function ActivityCard({
  item,
  showAuthor,
}: {
  item: FeedActivity;
  showAuthor: boolean;
}) {
  const navigate = useNavigate();
  const { theme } = useThemeContext();
  /**
   * A térképkép külső szolgáltatástól jön, tehát el is bukhat: lejárt token,
   * kvótatúllépés, hálózati hiba. Enélkül ilyenkor a böngésző törött-kép
   * ikonja jelenne meg a kártyán — ami rosszabb, mint egy tisztes felirat.
   */
  const [mapFailed, setMapFailed] = useState(false);
  const mapUrl = mapFailed ? null : routeImageUrl(item.route, { theme });
  const effort = formatEffort(item.type, item.distanceM, item.movingS);

  return (
    <article className="acard">
      <button
        type="button"
        className="acard__open"
        onClick={() => navigate(`/aktivitas/${item.id}`)}
        aria-label={`${activityTitle(item.type, item.startedAt)} megnyitása`}
      >
        <header className="acard__head">
          <Avatar url={item.author.photoURL} name={item.author.username} />
          <span className="acard__who">
            <span className="acard__name">
              {showAuthor ? item.author.username : activityTitle(item.type, item.startedAt)}
            </span>
            <span className="acard__when">
              <span aria-hidden="true">{ACTIVITY_ICON[item.type]}</span>{' '}
              {showAuthor ? `${ACTIVITY_LABEL[item.type]} · ` : ''}
              {formatRelativeDay(item.startedAt)}
            </span>
          </span>
        </header>

        {showAuthor ? (
          <h3 className="acard__title">{activityTitle(item.type, item.startedAt)}</h3>
        ) : null}

        {mapUrl ? (
          <img
            className="acard__map"
            src={mapUrl}
            alt="Az aktivitás útvonala a térképen"
            /* A képernyőn kívüli kártyák képe le se töltődik. */
            loading="lazy"
            decoding="async"
            onError={() => setMapFailed(true)}
          />
        ) : (
          <div className="acard__map acard__map--empty">
            {item.routeHidden
              ? 'Az útvonal rejtve'
              : item.route.length === 0
                ? 'Nincs elmentett útvonal'
                : 'A térkép nem elérhető'}
          </div>
        )}

        <dl className="acard__stats">
          <Metric label="táv" value={formatDistance(item.distanceM)} />
          <Metric label={effort.label} value={effort.value} />
          <Metric label="idő" value={formatDuration(item.movingS)} />
        </dl>
      </button>

      {/*
        A GRUNDO-sáv a kártya alján, elválasztva: ez nem sportmetrika, hanem
        a játék eredménye. Nulla területnél is kiírjuk a pontot, mert a
        rendszer legfontosabb üzenete, hogy a be nem zárt kör is ér valamit.
      */}
      <footer className="acard__grund">
        <span className="acard__gain">
          {item.areaGainedM2 > 0 ? `+${formatArea(item.areaGainedM2)}` : 'nincs új terület'}
        </span>
        <span className="acard__gp">{formatGp(item.gp)}</span>
      </footer>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="acard__metric">
      <dt className="acard__metric-label">{label}</dt>
      <dd className="acard__metric-value">{value}</dd>
    </div>
  );
}

export function Avatar({ url, name, size = 36 }: { url: string | null; name: string; size?: number }) {
  if (url) {
    return (
      <img className="avatar" src={url} alt="" width={size} height={size} style={{ width: size, height: size }} />
    );
  }
  return (
    <span className="avatar avatar--empty" style={{ width: size, height: size }} aria-hidden="true">
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export const ACTIVITY_LABEL: Record<FeedActivity['type'], string> = {
  run: 'Futás',
  walk: 'Séta',
  ride: 'Bringa',
};

export const ACTIVITY_ICON: Record<FeedActivity['type'], string> = {
  run: '🏃',
  walk: '🚶',
  ride: '🚲',
};
