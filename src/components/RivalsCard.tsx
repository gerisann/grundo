import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RivalRow } from '@/components/RivalRow';
import { useProfile } from '@/hooks/ProfileProvider';
import { api, type Rival } from '@/lib/api';
import './connectionsSheet.css';
import './rivalsCard.css';

/**
 * A profil „Riválisok" szekciója: a TOP 3 kiemelve, a többi gomb mögött.
 *
 * MIÉRT CSAK HÁROM? Mert a profil egy ÁTTEKINTŐ oldal, és a rivalitásból az
 * érdekes rész a legelső néhány név — akikkel tényleg zajlik valami. A hosszú
 * farok (egyetlen mezőt cserélt ismeretlenek) csak hígítaná; az a teljes
 * listában van, kereshetően.
 *
 * ⚠️ A SZEKCIÓ ELTŰNIK, HA NINCS RIVÁLIS. Egy üres „Riválisok" doboz azt
 * sugallná, hogy a felhasználó elmulasztott valamit — pedig csak még nem
 * csapott össze senkivel. A rivalitás nem gyűjtendő cél, hanem következmény.
 *
 * ⚠️ UGYANAZ A SOR, MINT A `/profil/rivalisok` FÜLÖN (Geri, 2026-08-26). A
 * korábbi kompakt sor (sorszám + avatár + név + számok) helyére a `RivalRow`
 * lépett, tehát a sávok, a villám és a belépő animáció itt is fut. Ne
 * gyártsunk hozzá külön változatot: a két helyen ugyanaz az adat ugyanazt
 * jelenti, és két külön megjelenítés azt sugallná, hogy nem ugyanaz.
 */
export function RivalsCard({ onOpenAll }: { onOpenAll: () => void }) {
  const navigate = useNavigate();
  /*
    A BAL SÁV A SAJÁT SZÍNEM. A rivális-lista mindig a BEJELENTKEZETT
    felhasználóé (`api.rivals()`), tehát a mérleg bal oldala mindig az övé —
    a színt ezért innen, a saját profilból vesszük, és nem propként kérjük.
    Így nem lehet elfelejteni egy új hívási helyen; pontosan ez történt a
    #23-ban, amikor a színezés csak az aktivitás-kártyán jelent meg, a
    profilon nem.
  */
  const { profile } = useProfile();
  const [rivals, setRivals] = useState<Rival[] | null>(null);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [top, setTop] = useState(3);

  useEffect(() => {
    let alive = true;
    api
      .rivals()
      .then((result) => {
        if (!alive) return;
        setRivals(result.items.slice(0, result.top));
        setTotal(result.items.length);
        setHasMore(result.hasMore);
        setTop(result.top);
      })
      .catch(() => {
        // A profil többi része ettől még használható — néma kihagyás.
        if (alive) setRivals([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!rivals || rivals.length === 0) return null;

  return (
    <div>
      <div className="label rivals-card__label">Riválisok</div>

      <div className="rivals-card">
        {rivals.map((rival) => (
          <RivalRow
            key={rival.uid}
            rival={rival}
            selfCellColor={profile?.cellColor ?? null}
            onOpen={() => navigate(`/felhasznalo/${encodeURIComponent(rival.username)}`)}
          />
        ))}

        {/*
          A gomb AKKOR IS OTT VAN, ha csak három rivális van összesen — a
          teljes lista a keresőt is hozza. Csak a felirat igazodik ahhoz, van-e
          mit még megmutatni.

          ⚠️ A `hasMore` esetén `200+` áll, nem `200`: a szerver felső határig
          küld, tehát a pontos szám ilyenkor NEM ismert. Kiírni mégis
          hazugság lenne.
        */}
        <button type="button" className="rivals-card__all" onClick={onOpenAll}>
          {total > top ? `Összes rivális (${total}${hasMore ? '+' : ''})` : 'Összes rivális'}
        </button>
      </div>
    </div>
  );
}
