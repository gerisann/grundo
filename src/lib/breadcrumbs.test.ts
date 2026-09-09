/**
 * A morzsanapló — a hibabejelentés legértékesebb része.
 *
 * Két dolgot bizonyít ez a teszt, és mindkettő egy-egy elrontható feltevés:
 *
 * 1. **Bekapcsolás nélkül SEMMI nem gyűlik.** A napló a tesztelői eszköz része;
 *    ha a normál felhasználónál is futna, az az ő akkumulátorát fogyasztaná, és
 *    a konzolja is át lenne kötve. A `docs/ai/terv-2026-09-09-bugreport-rendszer.md`
 *    10. pontja szerint ez tiltott.
 * 2. **A leszerelés visszaadja az EREDETI konzolt.** Ha a becsomagolás
 *    rétegződne (kétszeri bekapcsolás, React StrictMode dupla effektje), minden
 *    `console.error` két morzsát írna, és a napló hazudna arról, hányszor
 *    történt a hiba.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  BREADCRUMB_CAPACITY,
  addBreadcrumb,
  armBreadcrumbs,
  breadcrumbsArmed,
  clearBreadcrumbs,
  disarmBreadcrumbs,
  readBreadcrumbs,
} from './breadcrumbs';

afterEach(() => {
  disarmBreadcrumbs();
  clearBreadcrumbs();
});

describe('morzsanapló', () => {
  it('bekapcsolás nélkül nem gyűjt', () => {
    addBreadcrumb('info', 'ez sehova nem kerül');
    expect(readBreadcrumbs()).toHaveLength(0);
    expect(breadcrumbsArmed()).toBe(false);
  });

  it('bekapcsolva sorrendben gyűjt', () => {
    armBreadcrumbs();
    addBreadcrumb('route', '/rogzites');
    addBreadcrumb('info', 'elindult');

    expect(readBreadcrumbs().map((entry) => entry.msg)).toEqual(['/rogzites', 'elindult']);
  });

  it('a legrégebbi esik ki, ha betelt', () => {
    armBreadcrumbs();
    for (let index = 0; index < BREADCRUMB_CAPACITY + 5; index += 1) {
      addBreadcrumb('info', `sor-${index}`);
    }

    const entries = readBreadcrumbs();
    expect(entries).toHaveLength(BREADCRUMB_CAPACITY);
    // A legrégebbi öt kiesett, az utolsó megmaradt.
    expect(entries[0]?.msg).toBe('sor-5');
    expect(entries[entries.length - 1]?.msg).toBe(`sor-${BREADCRUMB_CAPACITY + 4}`);
  });

  it('a console.error morzsát ír, és az eredeti is lefut', () => {
    const original = console.error;
    const seen: unknown[] = [];
    console.error = (...args: unknown[]) => seen.push(args[0]);

    armBreadcrumbs();
    console.error('elszállt valami');
    disarmBreadcrumbs();

    expect(readBreadcrumbs().map((entry) => entry.msg)).toEqual(['elszállt valami']);
    expect(seen).toEqual(['elszállt valami']);
    console.error = original;
  });

  it('a kétszeri bekapcsolás nem duplázza a morzsát', () => {
    const original = console.error;
    console.error = () => {};

    armBreadcrumbs();
    armBreadcrumbs();
    console.error('egyszer történt');
    disarmBreadcrumbs();

    expect(readBreadcrumbs()).toHaveLength(1);
    console.error = original;
  });

  it('a leszerelés után a konzol az eredeti', () => {
    const original = console.warn;
    armBreadcrumbs();
    expect(console.warn).not.toBe(original);
    disarmBreadcrumbs();
    expect(console.warn).toBe(original);
  });

  it('az Error objektumból olvasható üzenet lesz', () => {
    armBreadcrumbs();
    addBreadcrumb('error', new Error('nincs hálózat'));
    expect(readBreadcrumbs()[0]?.msg).toBe('Error: nincs hálózat');
  });
});
