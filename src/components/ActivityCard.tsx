import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RivalBadge } from '@/components/RivalBadge';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { CommentButton, LikeButton } from '@/components/SocialActions';
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
import { HexMap } from '@/components/HexMap';

/**
 * Egy aktivitás a feedben.
 *
 * A kártya FELSŐ RÉSZE kattintható, az alsó sáv NEM: ott saját gombok vannak.
 * Ha az egész kártya egyetlen gomb lenne, a szívre koppintás a részletek
 * képernyőre vinne — a gomb a gombban ráadásul nem is érvényes HTML.
 *
 * Az alsó sáv két fele két külön dolgot mond:
 *   bal  — mit hozott a JÁTÉKBAN: terület és pont
 *   jobb — mit hozott a KÖZÖSSÉGBEN: hozzászólás és kedvelés
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
  const [hexesVisible, setHexesVisible] = useState(false);
  const mapUrl = mapFailed ? null : routeImageUrl(item.route, { theme });
  const effort = formatEffort(item.type, item.distanceM, item.movingS);
  const title = item.title ?? activityTitle(item.type, item.startedAt);

  /*
    A FEJLÉC A NYITÓ GOMBON KÍVÜL VAN, és ennek oka van: idegen szerzőnél a
    névre koppintva a PROFILJA nyílik meg, nem az aktivitás. Két gomb egymásba
    ágyazva sem HTML-ben, sem képernyőolvasóval nem működik, tehát a fejléc
    saját sorként áll, és maga dönti el, hova visz.
  */
  const head = (
    <header className="acard__head">
      <Avatar url={item.author.photoURL} name={item.author.username} />
      <span className="acard__who">
        <span className="acard__identity">
          <span className="acard__name">{showAuthor ? item.author.username : title}</span>
          {showAuthor ? <RivalBadge uid={item.author.uid} /> : null}
        </span>
        <span className="acard__when">
          <span aria-hidden="true">{ACTIVITY_ICON[item.type]}</span>{' '}
          {showAuthor ? `${ACTIVITY_LABEL[item.type]} · ` : ''}
          {formatRelativeDay(item.startedAt)}
        </span>
      </span>
    </header>
  );

  return (
    <article className="acard">
      {showAuthor ? (
        <button
          type="button"
          className="acard__open acard__author"
          onClick={() => navigate(`/felhasznalo/${encodeURIComponent(item.author.username)}`)}
          aria-label={`${item.author.username} profiljának megnyitása`}
        >
          {head}
        </button>
      ) : null}

      <button
        type="button"
        className={`acard__open${showAuthor ? ' acard__open--headless' : ''}`}
        onClick={() => navigate(`/aktivitas/${item.id}`)}
        aria-label={`${title} megnyitása`}
      >
        {showAuthor ? null : head}

        {showAuthor ? <h3 className="acard__title">{title}</h3> : null}

        <div className="acard__media">
          {mapUrl ? (
            <>
            <img
              className="acard__map"
              src={mapUrl}
              alt="Az aktivitás útvonala a térképen"
              /* A képernyőn kívüli kártyák képe le se töltődik. */
              loading="lazy"
              decoding="async"
              onError={() => setMapFailed(true)}
            />
            {hexesVisible && (item.activityCells?.length ?? 0) > 0 ? <HexMap layers={[{ role: 'interior', cells: item.activityCells ?? [] }]} track={[]} height={180} /> : null}
            <span role="button" tabIndex={0} className="acard__hex-toggle" aria-label={hexesVisible ? 'Hexagonok elrejtése' : 'Hexagonok megjelenítése'} aria-pressed={hexesVisible} onClick={(event) => { event.stopPropagation(); setHexesVisible((visible) => !visible); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setHexesVisible((visible) => !visible); } }}>
              <HexagonIcon />
            </span>
            </>
          ) : (
            <div className="acard__map acard__map--empty">
              {item.routeHidden
                ? 'Az útvonal rejtve'
                : item.route.length === 0
                  ? 'Nincs elmentett útvonal'
                  : 'A térkép nem elérhető'}
            </div>
          )}

          {item.photos.length > 0 ? (
            <span
              className="acard__photo-count"
              aria-label={`${item.photos.length} saját fotó tartozik az aktivitáshoz`}
            >
              <CameraIcon /> +{Math.min(5, item.photos.length)}
            </span>
          ) : null}
        </div>

        <dl className="acard__stats">
          <Metric label="táv" value={formatDistance(item.distanceM)} />
          <Metric label={effort.label} value={effort.value} />
          <Metric label="idő" value={formatDuration(item.movingS)} />
        </dl>
      </button>

      <footer className="acard__bar">
        <div className="acard__grund">
          <span className="acard__gain">
            {item.areaGainedM2 > 0 ? `+${formatArea(item.areaGainedM2)}` : 'nincs új terület'}
          </span>
          <span className="acard__gp">{formatGp(item.gp)}</span>
        </div>

        <div className="acard__social">
          {/*
            A hozzászólás a RÉSZLETEK képernyőn nyílik meg, nem a kártyán: a
            beszélgetéshez látni kell, mihez szólnak hozzá. A `?komment=1`
            azért van, hogy a megnyitott szál megosztható és visszakereshető
            legyen, és hogy a vissza gomb a szálat zárja, ne a képernyőt hagyja el.
          */}
          <CommentButton
            count={item.commentCount}
            onOpen={() => navigate(`/aktivitas/${item.id}?komment=1`)}
          />
          <LikeButton activityId={item.id} count={item.likeCount} liked={item.likedByMe} />
        </div>
      </footer>
    </article>
  );
}

function CameraIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 7.5h3l1.4-2h7.2l1.4 2h3v11H4z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="13" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function HexagonIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" /></svg>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="acard__metric">
      <dt className="acard__metric-label">{label}</dt>
      <dd className="acard__metric-value">{value}</dd>
    </div>
  );
}

export function Avatar({
  url,
  name,
  size = 36,
}: {
  url: string | null;
  name: string;
  size?: number;
}) {
  if (url) {
    return (
      <img
        className="avatar"
        src={url}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
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
