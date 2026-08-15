import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui';
import './auth.css';

/**
 * Értékajánlat három lapon.
 * docs/02-funkcionalis-spec.md → Onboarding, 1. lépés
 */

const SLIDES = [
  {
    icon: '⬡',
    title: 'Zárd a kört',
    text: 'Fuss, sétálj vagy bringázz. Ha az útvonalad keresztezi önmagát, a közrezárt terület a tiéd.',
  },
  {
    icon: '⚑',
    title: 'Urald a területet',
    text: 'A várost hatszögekre osztottuk. Foglald el, védd meg — és vedd el másokét.',
  },
  {
    icon: '★',
    title: 'Minden méter pontot ér',
    text: 'Akkor is, ha nem zárul a kör. A GRUNDO nem csak a legjobbakat jutalmazza.',
  },
] as const;

export function WelcomeScreen() {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const slide = SLIDES[index]!;
  const last = index === SLIDES.length - 1;

  return (
    <main className="auth">
      <div>
        <h1 className="auth__brand">GRUNDO</h1>
        <p className="auth__tagline">Egy város. Két birodalom.</p>
      </div>

      <div className="welcome">
        <div className="welcome__slide">
          <span className="welcome__step" style={{ color: 'var(--accent)' }} aria-hidden="true">
            {slide.icon}
          </span>
          <h2 className="welcome__title">{slide.title}</h2>
          <p className="welcome__text">{slide.text}</p>
        </div>

        <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
          <div className="welcome__dots">
            {SLIDES.map((s, i) => (
              <button
                key={s.title}
                type="button"
                className={`welcome__dot ${i === index ? 'welcome__dot--active' : ''}`}
                aria-label={`${i + 1}. lap`}
                aria-current={i === index}
                onClick={() => setIndex(i)}
              />
            ))}
          </div>

          <Button block onClick={() => (last ? navigate('/regisztracio') : setIndex(index + 1))}>
            {last ? 'Kezdjük' : 'Tovább'}
          </Button>

          <p className="auth__switch">
            Van már fiókod?{' '}
            <button type="button" className="auth__link" onClick={() => navigate('/belepes')}>
              Lépj be
            </button>
          </p>
        </div>
      </div>
    </main>
  );
}
