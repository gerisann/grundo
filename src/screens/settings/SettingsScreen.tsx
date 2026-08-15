import { useNavigate } from 'react-router-dom';
import { useThemeContext } from '@/hooks/ThemeProvider';
import { List, ListRow, ScreenHeader } from '@/components/ui';

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
            <ListRow label="Adatvédelem" description="Fiók és aktivitás láthatósága" chevron />
          </List>
        </section>

        <section>
          <div className="label list__group-label">Fiók</div>
          <List>
            <ListRow label="Értesítések" chevron />
            <ListRow label="Csatlakoztatott appok" chevron />
            <ListRow label="Előfizetés" chevron />
          </List>
        </section>
      </div>
    </>
  );
}
