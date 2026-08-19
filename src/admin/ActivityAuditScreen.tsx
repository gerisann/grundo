import { useEffect, useMemo, useRef, useState } from 'react';
import { HexMap } from '@/components/HexMap';
import { Button, ScreenHeader } from '@/components/ui';
import { processActivity } from '@/game';
import {
  ApiError,
  api,
  type DevActivityAudit,
  type DevActivityDetail,
  type DevActivityListItem,
  type DevClaimAudit,
} from '@/lib/api';
import { formatArea, formatDateTime, formatDistance, formatDuration, formatGp } from '@/lib/format';
import './activity-audit.css';

const ACTIVITY_LABEL = { run: 'Futás', walk: 'Séta', ride: 'Bringa' } as const;

interface LoadedActivity {
  activity: DevActivityDetail;
  points: Array<{ lat: number; lng: number; t: number; accuracy?: number; elevation?: number }>;
  audit: DevActivityAudit | null;
}

export function ActivityAuditScreen() {
  const [activities, setActivities] = useState<DevActivityListItem[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<LoadedActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [moreLoading, setMoreLoading] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.devActivities()
      .then((response) => {
        if (!active) return;
        setActivities(response.activities);
        setNextCursor(response.nextCursor);
        setSelectedId(response.activities[0]?.id ?? '');
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  async function loadMore() {
    if (!nextCursor || moreLoading) return;
    setMoreLoading(true);
    try {
      const response = await api.devActivities(nextCursor);
      setActivities((current) => [...current, ...response.activities]);
      setNextCursor(response.nextCursor);
    } catch (reason) {
      setError(messageOf(reason));
    } finally {
      setMoreLoading(false);
    }
  }

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetailLoading(true);
    setError('');
    setProgress(1);
    setPlaying(false);
    api.devActivity(selectedId)
      .then((response) => {
        if (active) setDetail(response);
      })
      .catch((reason: unknown) => {
        if (active) setError(messageOf(reason));
      })
      .finally(() => {
        if (active) setDetailLoading(false);
      });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setProgress((current) => {
        if (current >= 1) {
          setPlaying(false);
          return 1;
        }
        return Math.min(1, current + 0.01);
      });
    }, 60);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [playing]);

  const visible = useMemo(() => {
    const points = detail?.points ?? [];
    return points.slice(0, Math.max(Math.min(2, points.length), Math.round(points.length * progress)));
  }, [detail?.points, progress]);

  const replay = useMemo(() => {
    if (!detail || visible.length < 2) return null;
    return processActivity({
      points: visible,
      type: detail.activity.type,
      distanceKm: detail.activity.distanceM / 1000,
      actorId: detail.activity.userId,
      ownership: new Map(),
      streakDays: 0,
      gpEarnedToday: 0,
    });
  }, [detail, visible]);

  const interior = useMemo(() => {
    const cells = new Set<string>();
    for (const loop of replay?.loops ?? []) for (const cell of loop.interior) cells.add(cell);
    return cells;
  }, [replay]);
  const trail = replay?.cellPath.filter((cell) => !interior.has(cell)) ?? [];
  const shownClaim = useMemo(
    () => claimAtProgress(detail?.audit ?? null, visible.length, progress),
    [detail?.audit, visible.length, progress],
  );

  return (
    <>
      <ScreenHeader title="Aktivitás-audit" backTo="/admin" />
      <div className="screen-body audit-page">
        <section className="audit-list" aria-label="Valós aktivitások">
          <div className="audit-list__heading">
            <div>
              <div className="label">VALÓS ADATOK</div>
              <h2>Aktivitások</h2>
            </div>
            <span className="audit-list__count">{activities.length}</span>
          </div>
          {loading ? <p className="field__hint">Aktivitások betöltése…</p> : null}
          {!loading && activities.length === 0 && !error
            ? <p className="field__hint">Még nincs rögzített aktivitás.</p>
            : null}
          <div className="audit-list__items">
            {activities.map((activity) => (
              <button
                type="button"
                className={`audit-list__item${selectedId === activity.id ? ' is-active' : ''}`}
                key={activity.id}
                onClick={() => setSelectedId(activity.id)}
              >
                <span className="audit-list__item-top">
                  <strong>{activity.title || ACTIVITY_LABEL[activity.type]}</strong>
                  <span>{activity.hasAudit ? 'auditált' : 'régi adat'}</span>
                </span>
                <span>{activity.username} · {formatDateTime(activity.startedAt)}</span>
                <span>{formatDistance(activity.distanceM)} · {activity.loops} hurok · {formatGp(activity.gp)}</span>
              </button>
            ))}
            {nextCursor ? (
              <Button size="sm" variant="secondary" block disabled={moreLoading} onClick={() => void loadMore()}>
                {moreLoading ? 'Betöltés…' : 'További aktivitások'}
              </Button>
            ) : null}
          </div>
        </section>

        <main className="audit-detail">
          {error ? <div className="audit-notice audit-notice--error">{error}</div> : null}
          {detailLoading ? <div className="audit-notice">Aktivitás elemzése…</div> : null}
          {detail && !detailLoading ? (
            <>
              <header className="audit-detail__header">
                <div>
                  <div className="label">{ACTIVITY_LABEL[detail.activity.type]} · {detail.activity.username}</div>
                  <h1>{detail.activity.title || ACTIVITY_LABEL[detail.activity.type]}</h1>
                  <p>{formatDateTime(detail.activity.startedAt)} · {detail.activity.id}</p>
                </div>
                <div className="audit-badges">
                  <span>{detail.activity.trustVerdict}</span>
                  {detail.activity.deleted ? <span className="audit-badge--danger">törölt</span> : null}
                </div>
              </header>

              {!detail.audit ? (
                <div className="audit-notice">
                  Ez az aktivitás az auditnapló bevezetése előtt készült. A nyomvonal és a hurkok
                  visszajátszhatók, de a korabeli birtokállapot és a gazdaváltások már nem
                  rekonstruálhatók hitelesen.
                </div>
              ) : null}
              {detail.audit && !detail.audit.appliedToGameplay ? (
                <div className="audit-notice audit-notice--warning">
                  Az aktivitás eredménye elkészült, de a trust döntés miatt nem került a játéktérre.
                </div>
              ) : null}

              <div className="replay__map audit-map">
                <HexMap
                  layers={[
                    { role: 'trail', cells: trail },
                    { role: 'interior', cells: interior },
                  ]}
                  track={visible}
                  height={360}
                />
              </div>
              <div className="replay__controls">
                <Button size="sm" variant="secondary" onClick={() => { setProgress(0); setPlaying(true); }}>
                  Újrajátszás
                </Button>
                <Button size="sm" variant={playing ? 'secondary' : 'primary'} onClick={() => setPlaying((value) => !value)}>
                  {playing ? 'Szünet' : 'Lejátszás'}
                </Button>
                <input
                  className="replay__scrub"
                  type="range"
                  min={0}
                  max={1}
                  step={0.005}
                  value={progress}
                  onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)); }}
                  aria-label="Nyomvonal pozíciója"
                />
                <span className="audit-progress">{visible.length} / {detail.points.length} pont</span>
              </div>

              <section>
                <h2 className="audit-section-title">Eredmény ezen a ponton</h2>
                <div className="replay__stats audit-stats">
                  <Stat label="Sikeres hurkok" value={String(replay?.loops.length ?? 0)} />
                  <Stat label="Sikertelen hurkok" value={String(replay?.diagnostics.loops.rejected.length ?? 0)} />
                  <Stat
                    label="Egyedi érintett mező"
                    value={String(progress >= 0.999 ? shownClaim?.affectedCells ?? 0 : replay?.claimedCells.size ?? 0)}
                  />
                  <Stat label="Új, szabad mező" value={shownClaim ? String(shownClaim.capturedFree) : '—'} />
                  <Stat label="Gazdát cserélt" value={shownClaim ? String(shownClaim.ownershipChanges) : '—'} />
                  <Stat label="Erősítési esemény" value={shownClaim ? String(shownClaim.reinforced) : '—'} />
                  <Stat label="Gyengítési esemény" value={shownClaim ? String(shownClaim.weakened) : '—'} />
                  <Stat label="Területnyereség" value={shownClaim ? formatArea(shownClaim.areaGainedM2) : '—'} />
                </div>
              </section>

              <section className="audit-grid">
                <AuditPanel title="Védelmi szint változások">
                  <p className="audit-help">
                    Ezek események: ugyanaz a mező több egymást követő hurokban is szerepelhet.
                  </p>
                  {shownClaim?.transitions.length ? shownClaim.transitions.map((transition) => (
                    <DataRow
                      key={`${transition.kind}-${transition.fromLevel}-${transition.toLevel}`}
                      label={`${transitionLabel(transition.kind)} · ${transition.fromLevel} → ${transition.toLevel}`}
                      value={`${transition.count} esemény`}
                    />
                  )) : <EmptyRow text={detail.audit ? 'Eddig nem történt szintváltozás.' : 'Nincs korabeli birtokadat.'} />}
                </AuditPanel>

                <AuditPanel title="Érintett felhasználók">
                  {shownClaim?.victims.length ? shownClaim.victims.map((victim) => (
                    <DataRow
                      key={victim.userId}
                      label={victim.username}
                      value={`${victim.stolenCells} elvett · ${victim.weakenedCells} gyengített`}
                    />
                  )) : <EmptyRow text={detail.audit ? 'Más játékos területe nem változott.' : 'Nincs korabeli birtokadat.'} />}
                </AuditPanel>
              </section>

              <section className="audit-grid">
                <AuditPanel title="Sikeres hurkok">
                  {(detail.audit?.loops.successful ?? []).map((loop) => (
                    <DataRow
                      key={loop.index}
                      label={`#${loop.index} · ${loop.wallCells} fal + ${loop.interiorCells} belső`}
                      value={`${loop.totalCells} mező · ${formatArea(loop.areaM2)}`}
                      muted={loop.toIndex >= visible.length}
                    />
                  ))}
                  {detail.audit?.loops.successful.length === 0 ? <EmptyRow text="Nem volt sikeres hurok." /> : null}
                  {!detail.audit && (replay?.loops.length ?? 0) > 0
                    ? <EmptyRow text={`${replay?.loops.length ?? 0} hurok rekonstruálva a nyomvonalból.`} />
                    : null}
                </AuditPanel>

                <AuditPanel title="Sikertelen és levágott részek">
                  {(detail.audit?.loops.rejected ?? replay?.diagnostics.loops.rejected ?? []).map((loop, index) => (
                    <DataRow
                      key={`${loop.fromIndex}-${loop.toIndex}-${index}`}
                      label={loop.reason === 'too_large' ? 'Túl nagy hurokjelölt' : 'Túl kicsi belső terület'}
                      value={`${loop.interiorCells} belső · ${loop.prunedCells} levágott mező`}
                      muted={loop.toIndex >= visible.length}
                    />
                  ))}
                  <DataRow label="Zsákutca/folyosó miatt levágva" value={`${detail.audit?.loops.prunedCells ?? replay?.diagnostics.loops.rejected.reduce((sum, loop) => sum + loop.prunedCells, 0) ?? 0} mező`} />
                  <DataRow label="Felszívott egycellás maradvány" value={`${detail.audit?.loops.orphanAbsorbedCells ?? replay?.diagnostics.orphanAbsorbedCells ?? 0} mező`} />
                  <DataRow label="Túl rövid visszaérkezés" value={String(detail.audit?.loops.shortRevisits ?? replay?.diagnostics.loops.shortRevisits ?? 0)} />
                </AuditPanel>
              </section>

              <section>
                <h2 className="audit-section-title">Aktivitás összesítő</h2>
                <div className="replay__stats audit-stats">
                  <Stat label="Táv" value={formatDistance(detail.activity.distanceM)} />
                  <Stat label="Mozgásidő" value={formatDuration(detail.activity.movingS)} />
                  <Stat label="Teljes idő" value={formatDuration(detail.activity.durationS)} />
                  <Stat label="GP" value={formatGp(detail.activity.gp)} />
                  <Stat label="GPS pont" value={String(detail.points.length)} />
                  <Stat label="Eldobott GPS pont" value={String(detail.audit?.gps.droppedPoints ?? replay?.diagnostics.droppedPoints ?? 0)} />
                  <Stat label="GPS-hézag" value={String(detail.audit?.gps.largeGaps ?? replay?.diagnostics.largeGaps ?? 0)} />
                  <Stat label="Teljes terület" value={formatArea(detail.activity.areaGainedM2)} />
                </div>
              </section>
            </>
          ) : null}
        </main>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="replay__stat"><div className="label">{label}</div><div className="numeric replay__stat-value">{value}</div></div>;
}

function AuditPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="audit-panel"><h2>{title}</h2><div>{children}</div></section>;
}

function DataRow({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return <div className={`audit-data-row${muted ? ' is-muted' : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyRow({ text }: { text: string }) {
  return <p className="audit-empty">{text}</p>;
}

function transitionLabel(kind: DevClaimAudit['transitions'][number]['kind']): string {
  return {
    captured_free: 'Szabad foglalás', reinforced: 'Megerősítés', stolen: 'Gazdaváltás',
    weakened: 'Gyengítés', unchanged_max: '5-ös mezőérintés, változás nélkül',
  }[kind];
}

function claimAtProgress(audit: DevActivityAudit | null, visiblePoints: number, progress: number): DevClaimAudit | null {
  if (!audit) return null;
  const completed = audit.loops.successful.filter((loop) => loop.toIndex < visiblePoints);
  const events = mergeClaims(completed.map((loop) => loop.claim));
  if (progress < 0.999) return events;

  // Az egyedi mező- és területösszeg a végső claimből jön, a szintátmenetek
  // viszont események: ugyanaz a mező egy többkörös futásban 1→2→3 is lehet.
  const finalTransitions = audit.claim.transitions.filter(
    (transition) => transition.kind === 'captured_free' || transition.kind === 'stolen',
  );
  const eventTransitions = events.transitions.filter(
    (transition) =>
      transition.kind === 'reinforced' ||
      transition.kind === 'weakened' ||
      transition.kind === 'unchanged_max',
  );
  return {
    ...audit.claim,
    reinforced: events.reinforced,
    weakened: events.weakened,
    unchangedAtMax: events.unchangedAtMax,
    transitions: [...finalTransitions, ...eventTransitions],
    victims: audit.claim.victims.map((finalVictim) => ({
      ...finalVictim,
      weakenedCells:
        events.victims.find((victim) => victim.userId === finalVictim.userId)?.weakenedCells ??
        finalVictim.weakenedCells,
    })),
  };
}

function mergeClaims(claims: DevClaimAudit[]): DevClaimAudit {
  const result: DevClaimAudit = {
    affectedCells: 0, capturedFree: 0, stolen: 0, reinforced: 0, weakened: 0,
    unchangedAtMax: 0, ownershipChanges: 0, areaGainedM2: 0, transitions: [], victims: [],
  };
  const transitions = new Map<string, DevClaimAudit['transitions'][number]>();
  const victims = new Map<string, DevClaimAudit['victims'][number]>();
  for (const claim of claims) {
    result.affectedCells += claim.affectedCells;
    result.capturedFree += claim.capturedFree;
    result.stolen += claim.stolen;
    result.reinforced += claim.reinforced;
    result.weakened += claim.weakened;
    result.unchangedAtMax += claim.unchangedAtMax;
    result.ownershipChanges += claim.ownershipChanges;
    result.areaGainedM2 += claim.areaGainedM2;
    for (const transition of claim.transitions) {
      const key = `${transition.kind}:${transition.fromLevel}:${transition.toLevel}`;
      const previous = transitions.get(key);
      transitions.set(key, { ...transition, count: transition.count + (previous?.count ?? 0) });
    }
    for (const victim of claim.victims) {
      const previous = victims.get(victim.userId);
      victims.set(victim.userId, {
        ...victim,
        stolenCells: victim.stolenCells + (previous?.stolenCells ?? 0),
        weakenedCells: victim.weakenedCells + (previous?.weakenedCells ?? 0),
      });
    }
  }
  result.transitions = [...transitions.values()];
  result.victims = [...victims.values()];
  return result;
}

function messageOf(reason: unknown): string {
  return reason instanceof ApiError ? reason.message : 'Nem sikerült betölteni a fejlesztői adatokat.';
}
