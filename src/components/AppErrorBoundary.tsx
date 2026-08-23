import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * A natív WKWebViewben a konzol nehezen hozzáférhető. Egy induláskori React
 * kivétel ezért korábban csak üres/splash képernyőnek látszott. Ez a határ
 * a TestFlight-felhasználónak is megmutatja a hiba lényegét és újraindítást ad.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[GRUNDO] Kezeletlen React hiba az alkalmazás indulásakor.', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          background: '#09080d',
          color: '#fff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <section style={{ maxWidth: 420, display: 'grid', gap: 16, textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 24 }}>Nem sikerült elindítani a GRUNDO-t</h1>
          <p style={{ margin: 0, color: '#c9c2d2', lineHeight: 1.5 }}>
            Indítási hiba történt. Kérjük, küldj visszajelzést a TestFlightból ezzel a szöveggel:
          </p>
          <code
            style={{
              display: 'block',
              overflowWrap: 'anywhere',
              padding: 12,
              borderRadius: 10,
              background: '#18131f',
              color: '#ffb5c0',
              textAlign: 'left',
            }}
          >
            {this.state.error.message}
          </code>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0,
              borderRadius: 12,
              padding: '13px 18px',
              background: '#8b5cf6',
              color: '#fff',
              font: 'inherit',
              fontWeight: 700,
            }}
          >
            Újrapróbálom
          </button>
        </section>
      </main>
    );
  }
}
