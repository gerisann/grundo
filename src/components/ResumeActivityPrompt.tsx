import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import { Button } from '@/components/ui';
import { formatDistance } from '@/lib/format';
import './resumeActivityPrompt.css';

/**
 * Globális megerősítő popup — app-szinten, NEM a Rögzítés képernyőbe zárva.
 *
 * MIÉRT KELL EZ? Mert a felhasználó nem feltétlenül a Rögzítés képernyőn
 * nyitja meg újra az appot — lehet, hogy a Kezdőlapon landol. Ha a
 * félbehagyott aktivitás csak a Rögzítés képernyőn belüli, könnyen elrejtett
 * bannerben jelenne meg, a felhasználó sosem venné észre, hogy van mit
 * folytatnia (GRUNDO #42: pontosan ez volt a probléma — a rögzítés a
 * háttérben csendben tovább futott/veszett el anélkül, hogy bárki tudott
 * volna róla).
 *
 * A döntés (folytatás vs. új aktivitás) ezért AZONNAL, az app betöltése
 * után megjelenik, bármelyik képernyőn álljon is a felhasználó — lásd
 * `App.tsx` `Router()`, ahol a `Dock` mellett, minden bejelentkezett
 * nézetben renderelődik.
 */
export function ResumeActivityPrompt() {
  const { resumable, resumableNotice, restore, dismissResumable } = useRecorderContext();
  const navigate = useNavigate();

  if (resumable === null) return null;

  return createPortal(
    <div className="resume-prompt__backdrop" role="alertdialog" aria-modal="true">
      <div className="resume-prompt__sheet">
        <strong className="resume-prompt__title">Bezártad az appot?</strong>
        <p className="resume-prompt__lead">
          Félbemaradt egy aktivitásod — {resumable.points.length} pont,{' '}
          {formatDistance(resumable.distanceM)}. Folytatod, vagy újat kezdünk?
        </p>
        {resumableNotice !== null ? <p className="resume-prompt__notice">{resumableNotice}</p> : null}
        <div className="resume-prompt__actions">
          <Button
            block
            onClick={() => {
              void restore();
              navigate('/rogzites');
            }}
          >
            Folytatom
          </Button>
          <Button block variant="ghost" onClick={() => void dismissResumable()}>
            Újat kezdek
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
