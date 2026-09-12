import { createPortal } from 'react-dom';
import { Icon, type IconName } from '@/components/Icon';
import { formatArea, formatGp } from '@/lib/format';
import type { RouteReward } from '@/lib/api';
import './routeRewardPanel.css';

/**
 * „Zsákmány” — a tervezett útvonalon szerezhető nyereség, indulás előtt.
 *
 * MIÉRT VAN? Nem összefoglaló, hanem KEDVCSINÁLÓ: a tervezés után ez az utolsó
 * kép indulás előtt, és az a dolga, hogy kedvet adjon elindulni. Ezért nagy
 * számok, ikonos rács, és egyetlen gomb — nem táblázat.
 *
 * ⚠️ A SZÁMOK FELSŐ HATÁROK, NEM ÍGÉRETEK, és ezt ki is mondjuk a panel alján.
 * Két okból nem lehet garancia: a tervezett és a ténylegesen megtett út nem
 * ugyanaz (GPS, kitérők, lerövidítés), a birtokviszony pedig a tervezés
 * pillanatában igaz — mire odaérsz, más is mozoghatott ugyanott.
 */
export function RouteRewardPanel({
  reward,
  skippedReason,
  distanceM,
  durationS,
  closesLoop,
  onStart,
}: {
  reward: RouteReward | null;
  skippedReason: string | null;
  distanceM: number;
  durationS: number;
  closesLoop: boolean;
  onStart: () => void;
}) {
  const km = (distanceM / 1000).toFixed(1).replace('.', ',');
  const minutes = Math.round(durationS / 60);

  /* ⚠️ PORTÁLBAN — lásd `RoutePlannerSheet`: a dokk különben fölé kerül. */
  return createPortal(
    <div className="rrp" role="dialog" aria-modal="true" aria-labelledby="rrp-title">
      <div className="rrp__panel">
        <header className="rrp__head">
          <h2 id="rrp-title">Zsákmány</h2>
          <p className="rrp__route">
            {km} km · {minutes} perc
          </p>
        </header>

        {reward?.closesArea ? (
          <>
            {/*
              2×2 RÁCS. Az első sor a mezőkről szól (mennyi és milyen), a
              második az eredményről (terület és pont) — ebben a sorrendben,
              mert a játék nyelvén előbb a cella van, utána lesz belőle pont.
            */}
            <div className="rrp__grid">
              <RewardTile
                icon="cells"
                value={(reward.cells ?? 0).toLocaleString('hu-HU')}
                label="megszerezhető mező"
              />
              <RewardTile
                icon="stolen"
                value={(reward.stolenCells ?? 0).toLocaleString('hu-HU')}
                label="ebből elvett"
                sub={`${(reward.newCells ?? 0).toLocaleString('hu-HU')} szabad`}
              />
              <RewardTile icon="area" value={formatArea(reward.areaM2 ?? 0)} label="terület" />
              <RewardTile icon="gp" value={formatGp(reward.gp ?? 0)} label="GP a területből" />
            </div>

            {reward.topRivals && reward.topRivals.length > 0 ? (
              <section className="rrp__rivals">
                <h3>Tőlük veszel el a legtöbbet</h3>
                <ol>
                  {reward.topRivals.map((rival, index) => (
                    <li key={`${rival.name}-${index}`}>
                      <span className="rrp__rival-rank">{index + 1}</span>
                      <span className="rrp__rival-name">{rival.name}</span>
                      <span className="rrp__rival-stat">
                        {formatArea(rival.areaM2)} · {rival.cells.toLocaleString('hu-HU')} mező
                      </span>
                    </li>
                  ))}
                </ol>
              </section>
            ) : null}

            {/*
              ⚠️ EZ A SOR NEM ELHAGYHATÓ. Nagy, tömör belsejű körnél a belső
              mezők tulajdonosát nem olvassuk be egyenként (több millió olvasás
              lenne), tehát ott az „elvett” szám a fal és a határsáv alapján
              készül. Ne mutassuk pontosnak, ami becslés.
            */}
            <p className="rrp__note">
              {reward.ownershipKnown === false
                ? 'Becslés — ekkora területnél a mezők tulajdonosát csak a szélen néztük meg, és menet közben más is mozoghat itt.'
                : 'Becslés — a tényleges zsákmány attól függ, hogyan haladsz, és közben más is mozoghat itt.'}
            </p>
          </>
        ) : (
          <div className="rrp__empty">
            <span className="rrp__empty-icon">
              <Icon name={closesLoop ? 'cells' : 'area'} size={32} />
            </span>
            <p>
              {skippedReason ??
                (closesLoop
                  ? 'Ez az útvonal nem zár be területet — a távért járó pontot viszont megkapod.'
                  : 'A „Csak oda” útvonal nem zár kört, ezért területet nem ad — a távért járó pontot viszont megkapod.')}
            </p>
          </div>
        )}

        <button type="button" className="rrp__go" onClick={onStart}>
          Gyerünk!
        </button>
      </div>
    </div>,
    document.body,
  );
}

/** Egy cella a 2×2 rácsban: nagy ikon, alatta az érték, alatta a felirat. */
function RewardTile({
  icon,
  value,
  label,
  sub,
}: {
  icon: IconName;
  value: string;
  label: string;
  sub?: string;
}) {
  return (
    <div className="rrp__tile">
      <span className="rrp__tile-icon">
        <Icon name={icon} />
      </span>
      <span className="rrp__tile-value">{value}</span>
      <span className="rrp__tile-label">{label}</span>
      {sub ? <span className="rrp__tile-sub">{sub}</span> : null}
    </div>
  );
}
