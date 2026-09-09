import { useEffect, useState } from 'react';
import { api, type ChangelogEntry } from '@/lib/api';

/**
 * Verziótörténet — a `CHANGELOG.md` szinkronizált tükrét mutatja
 * (`scripts/sync-changelog.mjs` írja Firestore-ba). A repó marad az
 * eredeti, git-történettel követhető forrás; ez a felület csak olvas.
 */
export function ChangelogScreen() {
  const [entries, setEntries] = useState<ChangelogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminChangelog()
      .then((res) => setEntries(res.entries))
      .catch((err) => setError(err instanceof Error ? err.message : 'A verziótörténet nem tölthető be.'));
  }, []);

  return (
    <div className="admin-page">
      <header className="admin-page__head">
        <div>
          <h1>Verziótörténet</h1>
          <p className="admin-muted">
            A `CHANGELOG.md` tartalma, verziónkénti bontásban. Új bejegyzés a repóban, majd a
            `scripts/sync-changelog.mjs` futtatásával kerül ide.
          </p>
        </div>
      </header>

      {error ? <p className="admin-error">{error}</p> : null}

      {entries === null && !error ? <p className="admin-muted">Betöltés…</p> : null}

      {entries && entries.length === 0 ? (
        <p className="admin-muted">Még nincs szinkronizált verzióbejegyzés.</p>
      ) : null}

      {entries && entries.length > 0 ? (
        <div className="admin-list">
          {entries.map((entry) => (
            <section key={entry.version} className="admin-card">
              <h2>
                v{entry.version}
                {entry.buildNumber ? ` · build ${entry.buildNumber}` : ''}
                <span className={`admin-badge admin-badge--${entry.type}`}>{typeLabel(entry.type)}</span>
              </h2>
              <p className="admin-muted">
                {entry.releasedAt ? new Date(entry.releasedAt).toLocaleDateString('hu-HU') : 'dátum nélkül'}
              </p>
              <ul>
                {entry.changes.map((change, i) => (
                  <li key={i}>{change}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function typeLabel(type: ChangelogEntry['type']): string {
  if (type === 'major') return 'nagy verzió';
  if (type === 'minor') return 'új funkció';
  return 'javítás';
}
