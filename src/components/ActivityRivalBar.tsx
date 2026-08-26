import { useNavigate } from 'react-router-dom';
import { RivalRow } from '@/components/RivalRow';
import { formatNumber } from '@/lib/format';
import type { FeedActivity } from '@/lib/api';

/**
 * Az aktivitás-kártya alján futó rivális-sáv.
 *
 * UGYANAZ A KÁRTYA, MINT A PROFILON — a `RivalRow` tömör változata, ugyanazokkal
 * a HALMOZOTT számokkal (pl. +189 / −295 és 9× összecsapás) a szerző és a kör
 * fő károsultja között. Geri kifejezetten ezt kérte (2026-08-26): ne egy másik
 * mérték kerüljön ide hasonló képpel, mert az ugyanúgy néz ki, de mást mond.
 *
 * ⚠️ EGYETLEN ADAT SZÓL CSAK ERRŐL A KÖRRŐL: a bal felső pirula, a körben
 * elvett mezők száma. Szándékosan pontosan úgy néz ki, mint a jobb felső
 * szorzó — a kettő egymás párja, a sáv két felső sarkában.
 *
 * ⚠️ LOPÁS NÉLKÜL NINCS SÁV. Ha a kör senkitől nem vett el területet, nincs
 * rivális, akinek a mérlegét mutathatnánk — a szerver ilyenkor `null`-t ad.
 * Egy „mindenki más" sáv itt értelmetlen lenne.
 */
export function ActivityRivalBar({ item }: { item: FeedActivity }) {
  const navigate = useNavigate();
  const rival = item.rival;
  if (!rival) return null;

  return (
    <RivalRow
      compact
      rival={rival}
      others={rival.others}
      onOpen={() => navigate(`/felhasznalo/${encodeURIComponent(rival.username)}`)}
      extra={
        <span className="rival-row__taken">
          <span aria-hidden="true">+{formatNumber(rival.cellsThisActivity)}</span>
          <HexIcon />
          <span className="rival-score__sr">
            {`Ebben az aktivitásban ${rival.cellsThisActivity} mezőt vett el tőle.`}
          </span>
        </span>
      }
    />
  );
}

/** Csak szegély, fehéren — a számmal egy magas. */
function HexIcon() {
  return (
    <svg
      className="rival-row__hex"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 2.5 8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5Z" />
    </svg>
  );
}
