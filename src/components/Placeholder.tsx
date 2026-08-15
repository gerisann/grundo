/**
 * Ideiglenes helyőrző a még meg nem írt képernyőkhöz.
 * Ha ez a komponens éles buildben megjelenik, az hiba — töröld, amint a
 * képernyő elkészült.
 */
export function Placeholder({
  title,
  spec,
  children,
}: {
  title: string;
  /** melyik spec-fejezet írja le ezt a képernyőt */
  spec: string;
  children?: React.ReactNode;
}) {
  return (
    <main style={{ padding: 'calc(var(--safe-top) + var(--sp-5)) var(--sp-4) var(--sp-5)' }}>
      <h1 className="screen-title">{title}</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: 'var(--sp-2)' }}>{children}</p>
      <div className="card" style={{ marginTop: 'var(--sp-4)' }}>
        <div className="label">Specifikáció</div>
        <div style={{ marginTop: 'var(--sp-2)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-small)' }}>
          {spec}
        </div>
      </div>
    </main>
  );
}
