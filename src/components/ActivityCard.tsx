import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ActivityRivalBar } from '@/components/ActivityRivalBar';
import { RivalBadge } from '@/components/RivalBadge';
import { PhotoLightbox } from '@/components/PhotoLightbox';
import { ActivityPhotoImage } from '@/components/ActivityPhotoImage';
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
import { decodePolyline } from '@/game/polyline';
import { processActivity } from '@/game';
import { expandActivityCells } from '@/lib/activityCells';
import { mapboxConfigured } from '@/lib/mapbox';

const MapView = lazy(() => import('@/components/MapView').then((m) => ({ default: m.MapView })));

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
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const mapUrl = mapFailed ? null : routeImageUrl(item.route, { theme });
  const effort = formatEffort(item.type, item.distanceM, item.movingS);
  const title = item.title ?? activityTitle(item.type, item.startedAt, item.durationS, item.endedAt ?? item.startedAt);
  /**
   * A hexagon-előnézet cellái — CSAK KINYITOTT ÁLLAPOTBAN számolva.
   *
   * ⚠️ A `hexesVisible` őr nem mikrooptimalizálás, hanem a feed betöltési
   * idejének nagyságrendje. A visszaesési ág a TELJES játékmotort futtatja
   * (hurokdetektálás + flood fill) — ugyanazt a számítást, amit a szerver
   * végez mentéskor. A `useMemo` viszont a rendereléskor fut le, nem akkor,
   * amikor az eredményre szükség van; a hexagonok pedig alapból REJTVE
   * vannak, tehát a kártyák túlnyomó többségénél az eredmény a szemétbe ment.
   *
   * MÉRVE (2026-08-25, éles feed, 20 kártya): a Home-ra visszalépéstől a
   * kártyák megjelenéséig 21,9 MÁSODPERC telt el — miközben az
   * `/api/activities` válasz 334 ms alatt megérkezett. A különbség teljes
   * egészében ez a húsz motorfuttatás volt a főszálon.
   *
   * A visszaesési ág maga is csak átmenet: az `activityCells` mezőt a mentés
   * 2026-08-23 óta írja, de a korábbi aktivitásokon nincs meg (mérve: 0/20),
   * ezért futott mindegyiknél a drága ág.
   */
  const previewCells = useMemo(() => {
    if (!hexesVisible) return [];
    // A nagy hurkok belseje tömören érkezik — kibontás nélkül a hurok közepe
    // üresen maradna (lásd `expandActivityCells`).
    if (item.activityCells?.length) {
      return expandActivityCells(item.activityCells, item.activityCellParents);
    }
    try {
      // Régi (2026-08-29 előtti) aktivitás: a mező hiányzik, magunk számoljuk.
      // A compact hurok belseje itt is csak a parentekből jön ki.
      const points = decodePolyline(item.route).map((point) => ({ ...point, t: 0 }));
      const result = processActivity({
        points,
        type: item.type,
        distanceKm: item.distanceM / 1000,
        actorId: item.author.uid,
        ownership: new Map(),
        streakDays: 0,
        gpEarnedToday: 0,
      });
      return expandActivityCells(
        [...result.claimedCells],
        result.compactClaim ? [...result.compactClaim.parents.keys()] : [],
      );
    } catch {
      return [];
    }
  }, [hexesVisible, item.activityCells, item.activityCellParents, item.author.uid, item.distanceM, item.route, item.type]);
  const previewTrack = useMemo(
    () => (hexesVisible ? decodePolyline(item.route).map((point) => ({ ...point, t: 0 })) : []),
    [hexesVisible, item.route],
  );

  const visiblePhotos = item.photos.slice(0, 2);
  const morePhotoCount = item.photos.length - visiblePhotos.length;

  /*
    A TÉRKÉP-PANEL saját változóban, mert két helyen kell: önmagában, ha
    nincs fotó, vagy a galéria bal 60%-os oszlopában, ha van (lásd lent a
    `.acard__split`-et). A hexagon-váltó a panel BAL alsó sarkában ül —
    korábban jobbra, de az ütközött a további képek jelvényével.
  */
  const mapPane = mapUrl ? (
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
      {hexesVisible && previewCells.length > 0 && mapboxConfigured ? (
        <div className="acard__hex-map" onClick={(event) => event.stopPropagation()}>
          <Suspense fallback={null}>
            <MapView
              track={previewTrack}
              follow={false}
              fitTrack
              fill
              hexesVisible
              onToggleHexes={() => setHexesVisible(false)}
              layers={[{ role: 'interior', cells: previewCells }]}
            />
          </Suspense>
        </div>
      ) : null}
      <span
        role="button"
        tabIndex={0}
        className={`acard__hex-toggle${hexesVisible ? ' acard__hex-toggle--on' : ''}`}
        aria-label={hexesVisible ? 'Hexagonok elrejtése' : 'Hexagonok megjelenítése'}
        aria-pressed={hexesVisible}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setHexesVisible((visible) => !visible);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setHexesVisible((visible) => !visible);
          }
        }}
      >
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
  );

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
          {formatRelativeDay(item.endedAt ?? item.startedAt)}
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
          {item.photos.length > 0 ? (
            <div className="acard__split">
              <div className="acard__map-pane">{mapPane}</div>
              <div
                className={`acard__split-photos acard__split-photos--${visiblePhotos.length === 1 ? 'one' : 'two'}`}
              >
                {visiblePhotos.map((photo, index) => (
                  <button
                    key={photo.path}
                    type="button"
                    className="acard__split-photo"
                    aria-label={`${index + 1}. fotó megnyitása`}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setPhotoIndex(index);
                    }}
                  >
                    <ActivityPhotoImage
                      activityId={item.id}
                      path={photo.path}
                      alt=""
                      loading="lazy"
                      decoding="async"
                    />
                    {index === 1 && morePhotoCount > 0 ? (
                      <span className="acard__split-photo-more">+{morePhotoCount}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            mapPane
          )}
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

      {/*
        A RIVÁLIS-SÁV A KÁRTYA LEGALJÁN, teljes szélességben — Geri kérése
        (2026-08-26). A NYITÓ GOMBON KÍVÜL van, mint a fejléc, és ugyanazért:
        a károsult képére koppintva később az ő profilja nyílhat meg, ami
        gomb a gombban lenne. Most még nem kattintható, de a szerkezet már
        nem áll ennek az útjában.

        A SAJÁT kártyán is ott van: az „szereztem 24 mezőt, ebből 7-et
        Katától" ugyanúgy az aktivitásról szól, akárki nézi.
      */}
      <ActivityRivalBar item={item} />

      {photoIndex !== null ? (
        <PhotoLightbox
          activityId={item.id}
          photos={item.photos}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          onClose={() => setPhotoIndex(null)}
        />
      ) : null}
    </article>
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
