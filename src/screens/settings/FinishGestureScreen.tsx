import { useState, type ReactNode } from 'react';
import { ScreenHeader } from '@/components/ui';
import { HoldFinishButton, SwipeFinishButton } from '@/components/FinishGestureButtons';
import { useRecorderContext } from '@/hooks/RecorderProvider';
import type { FinishGesture } from '@/hooks/useRecorder';
import './finishGesture.css';

/**
 * Befejezés-gesztus választó — Geri kérése (2026-08-27).
 *
 * A `finishGesture` a rögzítőben él (`useRecorder.ts`), mert a `Dock`
 * — teljesen más komponens — is olvassa: ez az egyetlen közös szülőjük.
 * Itt mindkét gomb VALÓDI, működő példánya megjelenik, hogy a felhasználó
 * ki tudja próbálni választás előtt — az `onFinish` itt nem fejez be
 * semmilyen aktivitást, csak egy rövid visszajelzést mutat.
 */
export function FinishGestureScreen() {
  const { finishGesture, setFinishGesture } = useRecorderContext();
  const [tried, setTried] = useState<Record<FinishGesture, boolean>>({
    hold: false,
    swipe: false,
  });

  function tryOut(gesture: FinishGesture) {
    setTried((current) => ({ ...current, [gesture]: true }));
  }

  return (
    <>
      <ScreenHeader title="Működés" backTo="/beallitasok" />

      <div className="screen-body stack">
        <section className="stack stack--tight">
          <div className="label">Aktivitás befejezése</div>
          <p className="field__hint">
            Melyik gesztussal szeretnéd befejezni a rögzítést a dokkban? Mindkettőt
            kipróbálhatod itt, mielőtt választasz.
          </p>
        </section>

        <FinishGestureOption
          title="Nyomva tartás"
          description="Tartsd nyomva a gombot kb. egy másodpercig — közben a gomb és egy nagy, középre kitett visszajelzés is pirosra töltődik."
          active={finishGesture === 'hold'}
          tried={tried.hold}
          onSelect={() => setFinishGesture('hold')}
        >
          <HoldFinishButton onFinish={() => tryOut('hold')} />
        </FinishGestureOption>

        <FinishGestureOption
          title="Húzás"
          description="Húzd a kerek fogantyút a sáv végéig, jobbra — mint a régi iPhone „csúsztasd a feloldáshoz” gesztusa."
          active={finishGesture === 'swipe'}
          tried={tried.swipe}
          onSelect={() => setFinishGesture('swipe')}
        >
          <SwipeFinishButton onFinish={() => tryOut('swipe')} />
        </FinishGestureOption>
      </div>
    </>
  );
}

function FinishGestureOption({
  title,
  description,
  active,
  tried,
  onSelect,
  children,
}: {
  title: string;
  description: string;
  active: boolean;
  tried: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`card finish-gesture${active ? ' finish-gesture--active' : ''}`}>
      <button
        type="button"
        className="finish-gesture__select"
        role="radio"
        aria-checked={active}
        onClick={onSelect}
      >
        <span className="finish-gesture__radio" aria-hidden="true" />
        <span className="finish-gesture__text">
          <strong className="finish-gesture__title">{title}</strong>
          <span className="finish-gesture__desc">{description}</span>
        </span>
      </button>

      {/*
        A VALÓDI GOMB — Geri kérése (2026-08-27): ugyanaz a komponens fut
        itt, mint a dokkban, tehát a kipróbálás pontosan azt mutatja, ami
        rögzítés közben történne (a nyomva tartós verziónál a középre
        kitett visszajelzést is beleértve).
      */}
      <div className="finish-gesture__preview">
        {children}
        {tried ? (
          <span className="finish-gesture__tried" role="status">
            ✓ Kipróbálva — pontosan ezt érzed majd rögzítés közben is.
          </span>
        ) : null}
      </div>
    </section>
  );
}
