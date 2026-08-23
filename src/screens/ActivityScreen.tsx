import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { RivalBadge } from '@/components/RivalBadge';
import { Button } from '@/components/ui';
import { Avatar, ACTIVITY_LABEL } from '@/components/ActivityCard';
import { SaveActivityForm } from '@/components/SaveActivityForm';
import { CommentButton, LikeButton } from '@/components/SocialActions';
import { CommentSheet } from '@/components/CommentSheet';
import { useActivityDetail } from '@/hooks/useActivityDetail';
import { useAuth } from '@/hooks/AuthProvider';
import { useProfile } from '@/hooks/ProfileProvider';
import { computeSplits, elevationProfile } from '@/game/splits';
import { mapboxConfigured } from '@/lib/mapbox';
import { api, type ActivityPhoto } from '@/lib/api';
import {
  activityTitle,
  formatArea,
  formatDateTime,
  formatDistance,
  formatDuration,
  formatEffort,
  formatGp,
  formatMultiplier,
  formatPace,
} from '@/lib/format';
import './activity.css';

const MapView = lazy(() => import('@/components/MapView').then((m) => ({ default: m.MapView })));

/**
 * Aktivitás részletei.
 *
 * Amíg ez nem volt meg, egy elmentett aktivitást SOHA nem lehetett újra
 * megnyitni: a feedben látszott egy sor, de nem volt hova kattintani. Ez a
 * képernyő zárja azt a kört.
 *
 * A térkép a NYOMVONALAT mutatja, nem a hexagonokat: a birtokviszony a Grund
 * képernyőé, itt az a kérdés, hogy merre mentél.
 *
 * docs/02-funkcionalis-spec.md → Aktivitás részletek
 */
export function ActivityScreen() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { reload: reloadProfile } = useProfile();
  const { activity, points, loading, error, reload } = useActivityDetail(id);
  const [fullscreen, setFullscreen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photoIndex, setPhotoIndex] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  /**
   * A hozzászólás-lap ÁLLAPOTA a cÍMBEN van, nem a komponensben.
   *
   * A feed-kártya hozzászólás-gombja ide navigál `?komment=1`-gyel, tehát a
   * lap egy új oldalbetöltésnél is nyitva kell legyen. Mellékhaszon, hogy a
   * telefon vissza gombja a SZÁLAT zárja, nem a képernyőt hagyja el.
   */
  const [search, setSearch] = useSearchParams();
  const commentsOpen = search.get('komment') === '1';
  const [commentCount, setCommentCount] = useState<number | null>(null);

  // Teljes képernyős térképnél a lap alatta ne görgethessen tovább.
  useEffect(() => {
    if (!fullscreen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [fullscreen]);

  /**
   * Részidő CSAK valódi időbélyegekkel.
   *
   * A levágott, kódolt nyomvonalban nincs idő (a dekódolás `t: 0`-t ad), és
   * abból a `computeSplits` nullás tempókat számolna — vagyis a képernyő
   * magabiztosan hamis részidőket mutatna. Inkább nincs táblázat.
   */
  const hasTimestamps = points.length >= 2 && points[points.length - 1]!.t > 0;
  const splits = useMemo(
    () => (hasTimestamps ? computeSplits(points) : []),
    [points, hasTimestamps],
  );
  const elevation = useMemo(() => elevationProfile(points), [points]);

  if (loading) {
    return (
      <div className="screen-body" style={{ paddingTop: 'var(--sp-6)' }}>
        <div className="card">Betöltés…</div>
      </div>
    );
  }

  if (error || !activity) {
    return (
      <>
        <header className="screen-header">
          <button
            type="button"
            className="screen-header__back"
            aria-label="Vissza"
            onClick={() => navigate(-1)}
          >
            <BackIcon />
          </button>
          <h1 className="screen-header__title">Aktivitás</h1>
        </header>
        <div className="screen-body">
          <div className="card" role="alert">
            {error || 'Ez az aktivitás nem érhető el.'}
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Button size="sm" onClick={reload}>
                Újrapróbálom
              </Button>
            </div>
          </div>
        </div>
      </>
    );
  }

  const effort = formatEffort(activity.type, activity.distanceM, activity.movingS);
  const hasRoute = points.length >= 2;
  const fastest = fastestSplit(splits);

  return (
    <div className={fullscreen ? 'act act--full' : 'act'}>
      {/* ── Térkép ────────────────────────────────────────────────── */}
      <div className="act__map">
        {mapboxConfigured && hasRoute ? (
          <Suspense fallback={null}>
            <MapView track={points} follow={false} fitTrack fill />
          </Suspense>
        ) : (
          <div className="act__map-empty">
            {activity.routeHidden
              ? 'Az útvonal rejtve'
              : activity.route.length === 0
                ? 'Nincs elmentett útvonal'
                : 'A térkép nem elérhető'}
          </div>
        )}

        <button
          type="button"
          className="act__map-btn act__map-btn--back"
          aria-label="Vissza"
          onClick={() => (fullscreen ? setFullscreen(false) : navigate(-1))}
        >
          <BackIcon />
        </button>

        {hasRoute && mapboxConfigured ? (
          <button
            type="button"
            className="act__map-btn act__map-btn--expand"
            aria-label={fullscreen ? 'Kilépés a teljes képernyőből' : 'Térkép teljes képernyőn'}
            aria-pressed={fullscreen}
            onClick={() => setFullscreen((open) => !open)}
          >
            <ExpandIcon open={fullscreen} />
          </button>
        ) : null}
      </div>

      {fullscreen ? null : (
        <div className="act__body stack">
          {/* ── Fejléc ──────────────────────────────────────────── */}
          <div>
            <button
              type="button"
              className="act__who act__who--link"
              onClick={() => navigate(`/felhasznalo/${encodeURIComponent(activity.author.username)}`)}
              aria-label={`${activity.author.username} profiljának megnyitása`}
            >
              <Avatar url={activity.author.photoURL} name={activity.author.username} />
              <span className="act__who-text">
                <span className="act__identity">
                  <span className="act__author">{activity.author.username}</span>
                  <RivalBadge uid={activity.author.uid} />
                </span>
                <span className="act__date">
                  {ACTIVITY_LABEL[activity.type]} · {formatDateTime(activity.startedAt)}
                </span>
              </span>
            </button>
            <div className="act__title-row">
              <h1 className="act__title">
                {activity.title ?? activityTitle(activity.type, activity.startedAt)}
              </h1>
              {activity.mine && user ? (
                <span className="act__owner-actions">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing((value) => !value)}
                  >
                    {editing ? 'Mégse' : 'Szerkesztés'}
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setDeleteOpen(true)}>
                    Törlés
                  </Button>
                </span>
              ) : null}
            </div>
            {!editing && activity.description ? (
              <p className="act__description">{activity.description}</p>
            ) : null}
          </div>

          {editing && user ? (
            <div className="act__editor card">
              <SaveActivityForm
                activityId={activity.id}
                uid={user.uid}
                initialTitle={activity.title ?? ''}
                initialDescription={activity.description ?? ''}
                initialPhotos={activity.photos}
                onSaved={() => {
                  setEditing(false);
                  reload();
                }}
              />
            </div>
          ) : null}

          {deleteOpen ? (
            <section className="act__delete card" role="alertdialog" aria-label="Aktivitás törlése">
              <strong>Biztosan törlöd ezt az aktivitást?</strong>
              <p>
                Az aktivitás azonnal eltűnik, az adatait 30 napig visszaállíthatóan
                megőrizzük. A már kiosztott GP és a területek történeti állapota nem változik.
              </p>
              {deleteError ? <p className="field__error">{deleteError}</p> : null}
              <div className="act__delete-actions">
                <Button variant="secondary" disabled={deleting} onClick={() => setDeleteOpen(false)}>
                  Mégse
                </Button>
                <Button
                  variant="danger"
                  loading={deleting}
                  onClick={() => {
                    setDeleting(true);
                    setDeleteError('');
                    void api.deleteActivity(activity.id)
                      .then(() => reloadProfile())
                      .then(() => navigate('/profil', { replace: true }))
                      .catch((err: unknown) => {
                        setDeleteError(err instanceof Error ? err.message : 'Nem sikerült törölni az aktivitást.');
                        setDeleting(false);
                      });
                  }}
                >
                  Aktivitás törlése
                </Button>
              </div>
            </section>
          ) : null}

          {!editing && activity.photos.length > 0 ? (
            <div className="act__gallery">
              {activity.photos.map((photo, index) => (
                <button
                  type="button"
                  key={photo.path}
                  className="act__photo"
                  aria-label={`${index + 1}. kép megnyitása`}
                  onClick={() => setPhotoIndex(index)}
                >
                  <img src={photo.url} alt="" loading="lazy" decoding="async" />
                </button>
              ))}
            </div>
          ) : null}

          <div className="act__social">
            <CommentButton
              count={commentCount ?? activity.commentCount}
              onOpen={() => setSearch({ komment: '1' }, { replace: false })}
            />
            <LikeButton
              activityId={activity.id}
              count={activity.likeCount}
              liked={activity.likedByMe}
            />
          </div>

          {/* ── Hitelesség — csak a sajátodnál, és csak ha van mit mondani ── */}
          {activity.mine && activity.trustVerdict && activity.trustVerdict !== 'trusted' ? (
            <div className="act__notice" role="status">
              <strong>
                {activity.trustVerdict === 'rejected'
                  ? 'Ez az aktivitás nem számított bele a játékba.'
                  : 'Ez az aktivitás ellenőrzésre vár.'}
              </strong>
              <span>A részletes ellenőrzési adatok biztonsági okból nem nyilvánosak.</span>
            </div>
          ) : null}

          {/* ── Metrikák ────────────────────────────────────────── */}
          <section aria-label="Statisztikák">
            <div className="label" style={{ marginBottom: 'var(--sp-3)' }}>
              Statisztikák
            </div>
            <dl className="act__stats">
              <Stat label="táv" value={formatDistance(activity.distanceM)} />
              <Stat label={effort.label} value={effort.value} />
              <Stat label="mozgásidő" value={formatDuration(activity.movingS)} />
              <Stat label="teljes idő" value={formatDuration(activity.durationS)} />
              <Stat
                label="emelkedés"
                value={elevation.hasData ? `${elevation.gainM} m` : '--'}
              />
              <Stat label="útvonalmező" value={String(activity.cellCount)} />
            </dl>
          </section>

          {/* ── GRUND ───────────────────────────────────────────── */}
          <section className="act__grund" aria-label="Játékbeli eredmény">
            <div className="act__grund-head">
              <span className="label">A grund</span>
              <span className="act__grund-gp">{formatGp(activity.gp.total)}</span>
            </div>

            <dl className="act__stats act__stats--grund">
              <Stat label="szerzett terület" value={formatArea(activity.areaGainedM2)} />
              <Stat label="bezárt kör" value={String(activity.loops)} />
              <Stat label="foglalt mező" value={String(activity.claimedCells)} />
            </dl>

            {/*
              A pontok BONTÁSA, nem csak az összeg. Enélkül a szám átláthatatlan:
              nem derül ki, hogy a megtett útért vagy a bezárt körért járt.
            */}
            <ul className="act__gp-rows">
              <GpRow label="alappont a távért" value={activity.gp.base} />
              <GpRow label="bezárt terület" value={activity.gp.claim} />
              <GpRow label="idegentől elvéve" value={activity.gp.steal} />
              <GpRow label="védett zóna áttörése" value={activity.gp.breakthrough} />
              {activity.gp.streakMult && activity.gp.streakMult > 1 ? (
                <li className="act__gp-row">
                  <span>sorozat-szorzó</span>
                  <span>{formatMultiplier(activity.gp.streakMult)}</span>
                </li>
              ) : null}
            </ul>
          </section>

          {/* ── Részidők ────────────────────────────────────────── */}
          {splits.length > 0 ? (
            <section aria-label="Részidők">
              <div className="label" style={{ marginBottom: 'var(--sp-3)' }}>
                Részidők
              </div>
              <div className="act__splits">
                {splits.map((split) => (
                  <div
                    key={split.index}
                    className={`act__split${split.index === fastest ? ' act__split--fastest' : ''}`}
                  >
                    <span className="act__split-index">
                      {split.partial
                        ? formatDistance(split.distanceM)
                        : `${split.index}. km`}
                    </span>
                    {/*
                      A sáv hossza a LEGGYORSABB részidőhöz mérve: a rövidebb
                      sáv a gyorsabb kör. Abszolút skálán minden sáv szinte
                      egyforma lenne, és nem mondana semmit.
                    */}
                    <span className="act__split-track">
                      <span
                        className="act__split-bar"
                        style={{ width: `${barWidth(split.paceSPerKm, splits)}%` }}
                      />
                    </span>
                    <span className="act__split-pace">{formatPace(split.paceSPerKm)}</span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/*
            A saját nézeted a TELJES nyomvonalat mutatja — másoknak a két vége
            le van vágva. Ezt ki kell mondani, különben a felhasználó azt hiszi,
            a lakcíme is látszik mindenkinek.
          */}
          {activity.mine && hasRoute ? (
            <p className="act__privacy">
              Te a teljes útvonalat látod. Másoknak az eleje és a vége rejtve marad — a
              védőkör méretét a Beállításokban módosíthatod.
            </p>
          ) : null}
        </div>
      )}

      {commentsOpen ? (
        <CommentSheet
          activityId={activity.id}
          /*
            Egy értesítésről érkezve a KIEMELENDŐ hozzászólás azonosítója is
            jön (`?kiemelt=`) — a lap erre görget és kiemeli.
          */
          highlightCommentId={search.get('kiemelt')}
          onClose={() => setSearch({}, { replace: true })}
          onCountChange={setCommentCount}
        />
      ) : null}

      {photoIndex !== null ? (
        <PhotoLightbox
          photos={activity.photos}
          index={photoIndex}
          onIndexChange={setPhotoIndex}
          onClose={() => setPhotoIndex(null)}
        />
      ) : null}
    </div>
  );
}

function PhotoLightbox({
  photos,
  index,
  onIndexChange,
  onClose,
}: {
  photos: readonly ActivityPhoto[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const lightboxRef = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const pan = useRef<{
    pointerId: number;
    x: number;
    y: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const pinch = useRef<{ distance: number; scale: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dismissY, setDismissY] = useState(0);
  const [interacting, setInteracting] = useState(false);
  const photo = photos[index];

  function resetView() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDismissY(0);
  }

  function changeZoom(delta: number) {
    setScale((current) => {
      const next = clampZoom(current + delta);
      if (next === 1) setOffset({ x: 0, y: 0 });
      return next;
    });
    setDismissY(0);
  }

  useEffect(() => {
    resetView();
  }, [index]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onIndexChange((index - 1 + photos.length) % photos.length);
      if (event.key === 'ArrowRight') onIndexChange((index + 1) % photos.length);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [index, onClose, onIndexChange, photos.length]);

  /**
   * A React `onWheel` figyelője passzív lehet, ezért azon belül a
   * `preventDefault()` böngészőhibát írt minden görgetésnél. A nagyításnak
   * meg kell állítania az oldal görgetését, ezért itt explicit nem passzív
   * natív figyelőt használunk.
   */
  useEffect(() => {
    const element = lightboxRef.current;
    if (!element) return;

    const wheelZoom = (event: WheelEvent) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0015);
      setScale((current) => {
        const next = clampZoom(current * factor);
        if (next === 1) setOffset({ x: 0, y: 0 });
        return next;
      });
      setDismissY(0);
    };

    element.addEventListener('wheel', wheelZoom, { passive: false });
    return () => element.removeEventListener('wheel', wheelZoom);
  }, []);

  if (!photo) return null;

  function pointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('button')) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteracting(true);

    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      if (a && b) pinch.current = { distance: pointDistance(a, b), scale };
      swipe.current = null;
      pan.current = null;
      setDismissY(0);
    } else if (scale > 1) {
      pan.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        offsetX: offset.x,
        offsetY: offset.y,
      };
    } else {
      swipe.current = { x: event.clientX, y: event.clientY };
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size >= 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const ratio = pointDistance(a, b) / Math.max(1, pinch.current.distance);
      setScale(clampZoom(pinch.current.scale * ratio));
      return;
    }

    if (scale > 1 && pan.current?.pointerId === event.pointerId) {
      setOffset({
        x: pan.current.offsetX + event.clientX - pan.current.x,
        y: pan.current.offsetY + event.clientY - pan.current.y,
      });
      return;
    }

    if (swipe.current) setDismissY(Math.max(0, event.clientY - swipe.current.y));
  }

  function pointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    const wasPinching = pinch.current !== null || pointers.current.size > 1;
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) setInteracting(false);
    pan.current = null;

    if (wasPinching || scale > 1) {
      swipe.current = null;
      setDismissY(0);
      return;
    }

    swipe.current = null;
    setDismissY(0);
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
    } else if (photos.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      onIndexChange(
        dx < 0 ? (index + 1) % photos.length : (index - 1 + photos.length) % photos.length,
      );
    }
  }

  function pointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) setInteracting(false);
    swipe.current = null;
    pan.current = null;
    pinch.current = null;
    setDismissY(0);
  }

  return (
    <div
      ref={lightboxRef}
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label="Aktivitás képei"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={pointerCancel}
    >
      <div className="lightbox__topbar">
        <div className="lightbox__meta" aria-live="polite">
          <span className="lightbox__meta-label">Képek</span>
          <span className="lightbox__counter">{index + 1} / {photos.length}</span>
        </div>
        <button
          type="button"
          className="lightbox__control lightbox__close"
          aria-label="Képnézegető bezárása"
          onClick={onClose}
        >
          <CloseIcon />
        </button>
      </div>

      <div
        className={[
          'lightbox__frame',
          scale > 1 ? 'lightbox__frame--zoomed' : '',
          interacting ? 'lightbox__frame--interacting' : '',
        ].filter(Boolean).join(' ')}
        style={{
          transform: `translate3d(${offset.x}px, ${offset.y + dismissY}px, 0) scale(${scale})`,
          opacity: scale > 1 ? 1 : Math.max(0.35, 1 - dismissY / 360),
        }}
        onDoubleClick={() => (scale > 1 ? resetView() : changeZoom(1))}
      >
        <img
          src={photo.url}
          alt={`Aktivitás képe, ${index + 1}/${photos.length}`}
          draggable={false}
        />
      </div>

      {photos.length > 1 ? (
        <>
          <button
            type="button"
            className="lightbox__control lightbox__nav lightbox__nav--prev"
            aria-label="Előző kép"
            onClick={() => onIndexChange((index - 1 + photos.length) % photos.length)}
          >
            <ChevronIcon direction="left" />
          </button>
          <button
            type="button"
            className="lightbox__control lightbox__nav lightbox__nav--next"
            aria-label="Következő kép"
            onClick={() => onIndexChange((index + 1) % photos.length)}
          >
            <ChevronIcon direction="right" />
          </button>
        </>
      ) : null}

      <div className="lightbox__bottom">
        <span className="lightbox__hint">
          {scale > 1 ? 'Húzd a kép mozgatásához' : 'Csippents vagy görgess a nagyításhoz'}
        </span>
        <div className="lightbox__zoom" aria-label="Nagyítás vezérlése">
          <button
            type="button"
            className="lightbox__zoom-btn"
            aria-label="Kicsinyítés"
            disabled={scale <= 1}
            onClick={() => changeZoom(-0.5)}
          >
            <MinusIcon />
          </button>
          <button
            type="button"
            className="lightbox__zoom-value"
            aria-label="Nagyítás visszaállítása"
            onClick={resetView}
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            type="button"
            className="lightbox__zoom-btn"
            aria-label="Nagyítás"
            disabled={scale >= 4}
            onClick={() => changeZoom(0.5)}
          >
            <PlusIcon />
          </button>
        </div>
      </div>
    </div>
  );
}

function clampZoom(value: number): number {
  return Math.min(4, Math.max(1, value));
}

function pointDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A leggyorsabb TELJES kilométer sorszáma. A töredék szakasz nem rekord. */
function fastestSplit(splits: readonly { index: number; paceSPerKm: number; partial: boolean }[]) {
  let best = 0;
  let bestPace = Infinity;
  for (const split of splits) {
    if (split.partial) continue;
    if (split.paceSPerKm < bestPace) {
      bestPace = split.paceSPerKm;
      best = split.index;
    }
  }
  return best;
}

function barWidth(pace: number, splits: readonly { paceSPerKm: number }[]): number {
  const slowest = Math.max(...splits.map((s) => s.paceSPerKm));
  if (!Number.isFinite(slowest) || slowest <= 0) return 0;
  // 40–100 %: a leggyorsabb kör se legyen nullaszélességű csík.
  return 40 + (pace / slowest) * 60;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="act__stat">
      <dt className="act__stat-label">{label}</dt>
      <dd className="act__stat-value">{value}</dd>
    </div>
  );
}

function GpRow({ label, value }: { label: string; value: number | undefined }) {
  if (!value || Math.round(value) === 0) return null;
  return (
    <li className="act__gp-row">
      <span>{label}</span>
      <span>{formatGp(value)}</span>
    </li>
  );
}

function BackIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m15 6-6 6 6 6" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

function ChevronIcon({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === 'left' ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7'} />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ExpandIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <path d="M9 3v6H3M15 21v-6h6M3 15h6v6M21 9h-6V3" />
      ) : (
        <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
      )}
    </svg>
  );
}
