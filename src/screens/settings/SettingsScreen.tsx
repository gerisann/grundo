import { useNavigate } from 'react-router-dom';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { useAuth } from '@/hooks/AuthProvider';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import { buildInfo } from '@/lib/buildInfo';
import { Button, List, ListRow, ScreenHeader } from '@/components/ui';

/**
 * Beállítások — a csoportok gyűjtője.
 *
 * A képek szerinti teljes szerkezet: docs/02-funkcionalis-spec.md → Beállítások.
 * Egyelőre csak a Megjelenés él; a többi a saját fázisában készül el.
 */

const MODE_LABEL: Record<string, string> = {
  auto: 'Automatikus',
  light: 'Világos',
  dark: 'Sötét',
  system: 'Rendszer',
};

export function SettingsScreen() {
  const navigate = useNavigate();
  const { settings } = useThemeContext();
  const { user, role, signOut, status } = useAuth();
  const { finishGesture } = useRecorderContext();

  return (
    <>
      <ScreenHeader title="Beállítások" backTo="/profil" />

      <div className="screen-body stack">
        <section>
          <div className="label list__group-label">Preferenciák</div>
          <List>
            <ListRow
              label="Megjelenés"
              description="Világos vagy sötét téma, automatikus váltás"
              value={MODE_LABEL[settings.mode] ?? ''}
              onClick={() => navigate('/beallitasok/megjelenes')}
            />
            <ListRow
              label="Mértékegységek"
              value={<span className="row__value--muted">Hamarosan</span>}
              chevron
            />
            <ListRow
              label="Működés"
              description="Hogyan fejezd be az aktivitást a dokkban"
              value={finishGesture === 'swipe' ? 'Húzás' : 'Nyomva tartás'}
              onClick={() => navigate('/beallitasok/mukodes')}
            />
            <ListRow
              label="Aktivitás-adatvédelem"
              description="A megosztott útvonal elejének és végének elrejtése"
              onClick={() => navigate('/beallitasok/adatvedelem')}
            />
            <ListRow
              label="Tiltott felhasználók"
              description="Kiket tiltottál le — innen oldható fel"
              onClick={() => navigate('/beallitasok/tiltottak')}
            />
            <ListRow
              label="Játékszabályok"
              description="A jelenleg érvényes pontszámítás és az aktív akciók"
              onClick={() => navigate('/beallitasok/szabalyok')}
            />
          </List>
        </section>

        <section>
          <div className="label list__group-label">Fiók</div>
          <List>
            <ListRow
              label="Értesítések"
              description="Típusonként kapcsolható, alkalmazáson belül és push-ban is"
              onClick={() => navigate('/beallitasok/ertesitesek')}
            />
            <ListRow label="Csatlakoztatott appok" chevron />
            <ListRow label="Előfizetés" chevron />
          </List>
        </section>

        {/**
          * Az admin belépő CSAK szerepkörrel jelenik meg.
          *
          * Ez kényelem, nem védelem: a claim a kliensen olvasható, tehát
          * elrejteni semmit nem tud. A tiltást a szerver kényszeríti ki
          * minden `/api/admin` végponton — aki ide beírja a címet
          * szerepkör nélkül, egy udvarias „nincs jogosultságod" képernyőt kap.
          */}
        {role ? (
          <section>
            <div className="label list__group-label">Üzemeltetés</div>
            <List>
              <ListRow
                label="Admin felület"
                description="Játékszabályok, akciók, aktivitás-audit"
                value={role}
                onClick={() => navigate('/admin')}
              />
            </List>
          </section>
        ) : null}

        {status === 'signed-in' ? (
          <section className="stack stack--tight">
            <div className="label list__group-label">Fiók</div>
            <List>
              <ListRow label="Bejelentkezve" value={user?.email ?? user?.displayName ?? ''} />
            </List>
            <Button
              variant="danger"
              block
              onClick={() => {
                void signOut().then(() => navigate('/belepes'));
              }}
            >
              Kijelentkezés
            </Button>
          </section>
        ) : null}

        <section>
          <div className="label list__group-label">Alkalmazás</div>
          <List>
            <ListRow label="Verzió" value={buildInfo.label} />
          </List>
        </section>
      </div>
    </>
  );
}
