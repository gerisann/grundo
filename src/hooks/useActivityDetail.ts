import { useCallback, useEffect, useState } from 'react';
import { api, apiConfigured, type ActivityDetail } from '@/lib/api';
import { decodePolyline } from '@/game/polyline';
import type { TracePoint } from '@/types';

/**
 * Egy aktivitás adatlapja és a hozzá tartozó nyomvonal.
 *
 * KÉT FORRÁS, és a különbség lényegi:
 *
 *   saját aktivitás → a TELJES nyomvonal (`/:id/track`). A privát zóna a te
 *     saját nézetedre nem vonatkozik: te mindig a teljes útvonalat látod. Ez
 *     egyben a részidők forrása is — a levágott nyomból hamis tempó jönne ki.
 *
 *   idegen aktivitás → a levágott, kódolt `route`. Ebből nem számolunk
 *     részidőt: nincs benne időbélyeg, és hiányzik a két vége.
 *
 * A teljes nyomvonal lekérése HIBÁJA nem végzetes: az adatlap megmarad, csak
 * a térkép esik vissza a levágott változatra.
 */
export interface ActivityDetailState {
  activity: ActivityDetail | null;
  points: TracePoint[];
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useActivityDetail(id: string): ActivityDetailState {
  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [points, setPoints] = useState<TracePoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    if (!apiConfigured) {
      setLoading(false);
      setError('A háttérszolgáltatás még nincs beállítva.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const { activity: detail } = await api.activity(id);
      setActivity(detail);

      if (detail.mine) {
        try {
          const track = await api.activityTrack(id);
          if (track.points.length >= 2) {
            setPoints(track.points as TracePoint[]);
            return;
          }
        } catch {
          /* Nincs eltárolt nyomvonal, vagy nem érhető el — a levágott jó lesz. */
        }
      }

      // A kódolt nyomvonalból nincs idő, csak geometria: térképhez elég,
      // részidőhöz nem. A `t: 0` ezt teszi egyértelművé.
      setPoints(decodePolyline(detail.route).map((p) => ({ ...p, t: 0 })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nem sikerült betölteni az aktivitást.');
      setActivity(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  return { activity, points, loading, error, reload: () => void load() };
}
