import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Button, SegmentedControl } from '@/components/ui';
import { HexMap } from '@/components/HexMap';
import { mapboxConfigured } from '@/lib/mapbox';
import { api, apiConfigured, type TerritoryResult } from '@/lib/api';
import { formatArea } from '@/lib/format';
import type { Layer } from '@/types';
import './territory.css';

const MapView = lazy(() => import('@/components/MapView').then((m) => ({ default: m.MapView })));

type Status = 'loading' | 'ready' | 'error' | 'unavailable';

/**
 * Terület — amit eddig megszereztél.
 *
 * A védelmi szint látszik, mert ez a legfontosabb információ a képernyőn: az
 * 5-ös védelmű folt öt bezárásba kerül a támadónak, az 1-es egybe. És mivel a
 * védelem naponta egy szintet veszít, a felhasználónak látnia kell, mi az,
 * ami még tart, és mi az, ami már bárkinek szabad préda.
 */
export function TerritoryScreen() {
  const [layer, setLayer] = useState<Layer>('foot');
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<TerritoryResult | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!apiConfigured) {
      setStatus('unavailable');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      setData(await api.territory(layer));
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nem sikerült betölteni a területed.');
      setStatus('error');
    }
  }, [layer]);

  useEffect(() => {
    void load();
  }, [load]);

  const cells = data?.cells ?? [];

  /**
   * A védelmi szint szerint bontjuk rétegekre, mert a `HexMap` és a `MapView`
   * is szerep szerint színez. A „mai" (védett) és a „tegnapi" (1-es) terület
   * vizuálisan is elkülönül.
   */
  const defended = cells.filter((c) => c.defense > 1).map((c) => c.cell);
  const exposed = cells.filter((c) => c.defense <= 1).map((c) => c.cell);

  return (
    <>
      <header className="screen-header">
        <h1 className="screen-header__title">Terület</h1>
      </header>

      <div className="screen-body stack">
        <SegmentedControl
          label="Réteg"
          block
          value={layer}
          onChange={setLayer}
          options={[
            { value: 'foot', label: 'Gyalogos' },
            { value: 'bike', label: 'Bringás' },
          ]}
        />

        {status === 'unavailable' ? (
          <div className="card">A háttérszolgáltatás nincs beállítva.</div>
        ) : null}

        {status === 'error' ? (
          <div className="card" role="alert">
            {error}
            <div style={{ marginTop: 'var(--sp-3)' }}>
              <Button size="sm" onClick={() => void load()}>
                Újrapróbálom
              </Button>
            </div>
          </div>
        ) : null}

        {status === 'loading' ? <div className="card">Betöltés…</div> : null}

        {status === 'ready' && cells.length === 0 ? (
          <div className="card terr__empty">
            <h2 className="terr__empty-title">Még nincs területed</h2>
            <p>
              Zárj be egy kört — kerülj meg egy háztömböt, vagy keresztezd a saját nyomvonalad —,
              és a közrezárt terület a tiéd lesz.
            </p>
          </div>
        ) : null}

        {status === 'ready' && cells.length > 0 ? (
          <>
            <div className="terr__stats">
              <div className="terr__stat">
                <span className="terr__stat-value">{formatArea(data!.areaM2)}</span>
                <span className="terr__stat-label">terület</span>
              </div>
              <div className="terr__stat">
                <span className="terr__stat-value">{data!.cellCount}</span>
                <span className="terr__stat-label">mező</span>
              </div>
              <div className="terr__stat">
                <span className="terr__stat-value">{defended.length}</span>
                <span className="terr__stat-label">védett</span>
              </div>
            </div>

            {mapboxConfigured ? (
              <Suspense fallback={<div className="card">Térkép betöltése…</div>}>
                <MapView
                  layers={[
                    { role: 'rival', cells: exposed },
                    { role: 'interior', cells: defended },
                  ]}
                  position={null}
                  follow={false}
                  height={380}
                />
              </Suspense>
            ) : (
              <HexMap
                layers={[
                  { role: 'rival', cells: exposed },
                  { role: 'interior', cells: defended },
                ]}
                height={340}
              />
            )}

            <p className="terr__legend">
              A <strong>sötét</strong> foltok védettek — a támadónak annyi bezárás kell, amennyi a
              védelmi szintjük. A <strong>halvány</strong> foltok 1-es szinten állnak: egyetlen
              bezárással elvehetők. A védelem <strong>naponta egy szintet veszít</strong>, de
              sosem esik 1 alá — a terület a tiéd marad, csak egyre könnyebb elvenni. Amit
              erősen meg akarsz tartani, azt rendszeresen újra kell futnod.
            </p>

            {data!.truncated ? (
              <p className="terr__legend">
                Sok területed van — a térkép csak egy részét mutatja.
              </p>
            ) : null}
          </>
        ) : null}
      </div>
    </>
  );
}
