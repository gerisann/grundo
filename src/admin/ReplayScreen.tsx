import { useEffect, useMemo, useRef, useState } from 'react';
import { HexMap } from '@/components/HexMap';
import { Button, ScreenHeader, SegmentedControl } from '@/components/ui';
import { FIXTURES, type FixtureName } from '@/game/fixtures';
import { processActivity } from '@/game';
import { formatArea, formatGp } from '@/lib/format';
import './replay.css';

/**
 * Fejlesztői eszköz: nyomvonal-visszajátszó.
 *
 * Ez az egyetlen mód, hogy a játékmotort determinisztikusan próbáljuk —
 * a `src/game/` logikáját nem lehet úgy validálni, hogy minden módosítás
 * után kimegyünk futni egy kört.
 *
 * docs/06-architektura-es-admin.md → Fejlesztői eszköz: GPX-visszajátszó
 */

const FIXTURE_NAMES = Object.keys(FIXTURES) as FixtureName[];

const LABELS: Record<FixtureName, string> = {
  'simple-loop': 'Egyszerű kör',
  'figure-eight': 'Nyolcas',
  'multi-lap': '4 kör',
  'open-route': 'Nyitott út',
  'gps-gap': 'GPS-kihagyás',
  'self-touch': 'Ál-hurok',
  'huge-bbox': 'Túl nagy',
};

const DESCRIPTIONS: Record<FixtureName, string> = {
  'simple-loop': '200 m oldalú négyzet — egy bezárás, ≈40 000 m².',
  'figure-eight': 'Két hurok egy aktivitásból, közös metszésponttal.',
  'multi-lap': 'Ugyanaz a kör négyszer — a védelem 1×-ről 4×-re nő.',
  'open-route': 'Nincs bezárás: alappont jár, terület nem.',
  'gps-gap': '60 m-es jelkihagyás — a hézagkitöltésnek zárnia kell a falat.',
  'self-touch': 'Pár méteres GPS-remegés — NEM adhat területet.',
  'huge-bbox': '30 km-es „kör" — a védőkorlátnak el kell utasítania.',
};

export function ReplayScreen() {
  const [fixture, setFixture] = useState<FixtureName>('simple-loop');
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number | null>(null);

  const points = useMemo(() => FIXTURES[fixture](), [fixture]);
  const visible = useMemo(
    () => points.slice(0, Math.max(2, Math.round(points.length * progress))),
    [points, progress],
  );

  const result = useMemo(() => {
    const started = performance.now();
    const value = processActivity({
      points: visible,
      type: 'run',
      distanceKm: estimateDistanceKm(visible),
      actorId: 'dev',
      ownership: new Map(),
      streakDays: 1,
      gpEarnedToday: 0,
    });
    return { value, ms: performance.now() - started };
  }, [visible]);

  // Lejátszás
  useEffect(() => {
    if (!playing) return;
    timer.current = window.setInterval(() => {
      setProgress((p) => {
        if (p >= 1) {
          setPlaying(false);
          return 1;
        }
        return Math.min(1, p + 0.02);
      });
    }, 60);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [playing]);

  function restart() {
    setProgress(0);
    setPlaying(true);
  }

  const claim = result.value.claim;
  const interior = new Set<string>();
  for (const loop of result.value.loops) for (const c of loop.interior) interior.add(c);
  const trail = result.value.cellPath.filter((c) => !interior.has(c));

  return (
    <>
      <ScreenHeader title="Visszajátszó" backTo="/admin" />

      <div className="screen-body stack">
        <SegmentedControl
          label="Teszt-nyomvonal"
          options={FIXTURE_NAMES.map((n) => ({ value: n, label: LABELS[n] }))}
          value={fixture}
          onChange={(next) => {
            setFixture(next);
            setProgress(1);
            setPlaying(false);
          }}
          size="sm"
          block
          columns={3}
        />
        <p className="field__hint">{DESCRIPTIONS[fixture]}</p>

        <div className="replay__map">
          <HexMap
            layers={[
              { role: 'trail', cells: trail },
              { role: 'interior', cells: interior },
            ]}
            track={visible}
            height={280}
          />
        </div>

        <div className="replay__controls">
          <Button size="sm" variant="secondary" onClick={restart}>
            Újrajátszás
          </Button>
          <Button size="sm" variant={playing ? 'secondary' : 'primary'} onClick={() => setPlaying((p) => !p)}>
            {playing ? 'Szünet' : 'Lejátszás'}
          </Button>
          <input
            className="replay__scrub"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={progress}
            onChange={(e) => {
              setPlaying(false);
              setProgress(Number(e.target.value));
            }}
            aria-label="Nyomvonal pozíciója"
          />
        </div>

        <div className="replay__stats">
          <Stat label="Bezárások" value={String(result.value.loops.length)} />
          <Stat label="Cellák" value={String(result.value.cellPath.length)} />
          <Stat label="Terület" value={formatArea(result.value.areaGainedM2)} />
          <Stat label="Pont" value={formatGp(result.value.gp.total)} />
          <Stat label="Szabad" value={String(claim?.counts.free ?? 0)} />
          <Stat label="Újrafoglalt" value={String(claim?.counts.reclaimed ?? 0)} />
          <Stat label="Számítás" value={`${result.ms.toFixed(0)} ms`} />
          <Stat label="Eldobott pont" value={String(result.value.diagnostics.droppedPoints)} />
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="replay__stat">
      <div className="label">{label}</div>
      <div className="numeric replay__stat-value">{value}</div>
    </div>
  );
}

/** Durva távolságbecslés a visszajátszáshoz — a valós mérés a trackingben lesz. */
function estimateDistanceKm(points: readonly { lat: number; lng: number }[]): number {
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dLat = (b.lat - a.lat) * 111_320;
    const dLng = (b.lng - a.lng) * 111_320 * Math.cos((a.lat * Math.PI) / 180);
    meters += Math.hypot(dLat, dLng);
  }
  return meters / 1000;
}
