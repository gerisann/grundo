/**
 * A napi forduló KÉZI futtatása.
 *
 * Ugyanaz a kód fut, mint amit a Cloud Scheduler óránként meghív — csak a HTTP
 * réteg marad ki. Ez a diagnosztika helye: ha élesben nem járt a tartás-bónusz,
 * itt derül ki, hány felhasználó volt egyáltalán esedékes.
 *
 * FUTTATÁS (a `server/` mappából, PowerShellben):
 *
 *   npm.cmd run rollover:run
 *   npm.cmd run rollover:run -- --limit 50
 *
 * Az `--at` opcióval a futás időpontja is megadható (ISO alak), hogy egy
 * elmaradt óra visszamenőleg is feldolgozható legyen.
 */

import { runDailyRollover } from '../jobs/dailyRollover';

function valueAfter(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const limitRaw = valueAfter('--limit');
  const atRaw = valueAfter('--at');

  const options: { limit?: number } = {};
  if (limitRaw !== undefined) {
    const limit = Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1) throw new Error('A --limit pozitív egész szám.');
    options.limit = limit;
  }

  const now = atRaw ? new Date(atRaw) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error('Az --at értéke érvénytelen dátum.');

  console.log(`Napi forduló futtatása — ${now.toISOString()}`);
  const startedAt = Date.now();
  const summary = await runDailyRollover(now, options);

  console.log('');
  for (const [key, value] of Object.entries(summary)) {
    console.log(`  ${key.padEnd(20)} ${value}`);
  }
  console.log(`  ${'durationMs'.padEnd(20)} ${Date.now() - startedAt}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
