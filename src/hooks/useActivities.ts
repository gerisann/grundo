import { useCallback, useEffect, useState } from 'react';
import { api, apiConfigured, type FeedQuery, type FeedResult } from '@/lib/api';

/**
 * Aktivitás-lista betöltése.
 *
 * Külön hook, mert KÉT helyen kell ugyanaz: a feedben (Home) és a profilon.
 * Ha a profil is a `Feed` komponenst használná, nem férne hozzá a betöltött
 * adathoz — pedig a heti oszlopdiagram és az összegzők ugyanabból a listából
 * készülnek. Így a profil EGY kérésből építi mind a hármat.
 */
export interface ActivitiesState {
  result: FeedResult | null;
  loading: boolean;
  error: string;
  reload: () => void;
}

export function useActivities(query: FeedQuery | null): ActivitiesState {
  const [result, setResult] = useState<FeedResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  /**
   * A lekérdezés MEZŐNKÉNT a függőségi listában, nem objektumként.
   *
   * A hívó minden rendereléskor új objektumot ad át — ha az kerülne a
   * függőségek közé, a hatás végtelen körbe futna: betöltés → renderelés →
   * új objektum → újabb betöltés.
   */
  const { scope, limit, lat, lng, radiusKm, dateFrom, dateTo, userId } =
    query ?? ({} as Partial<FeedQuery>);

  const load = useCallback(async () => {
    if (scope === undefined) return;
    if (!apiConfigured) {
      setResult({ activities: [] });
      return;
    }

    setLoading(true);
    setError('');
    try {
      setResult(
        await api.activities({
          scope,
          ...(limit === undefined ? {} : { limit }),
          ...(dateFrom === undefined ? {} : { dateFrom }),
          ...(dateTo === undefined ? {} : { dateTo }),
          ...(scope === 'local' ? { lat, lng, radiusKm } : {}),
          ...(scope === 'user' ? { userId } : {}),
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nem sikerült betölteni az aktivitásokat.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [scope, limit, lat, lng, radiusKm, dateFrom, dateTo, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { result, loading, error, reload: () => void load() };
}
