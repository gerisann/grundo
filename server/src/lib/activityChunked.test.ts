import { describe, expect, it } from 'vitest';
import { isTransactionTooBig, withSplitOnOverflow } from './activityChunked';

/**
 * A TÚLCSORDULÓ CSOPORT FELEZÉSE.
 *
 * ⚠️ EZ EGY ÉLES ADATVESZTÉST RÖGZÍT (2026-09-02, `ebb3c240…`). Egy 143 km-es
 * bringakör darabolt mentése a Firestore `Transaction too big` hibájával
 * hasalt el az ELSŐ csoportnál, és az aktivitás örökre 0 GP-vel, 0 területtel
 * maradt. A nyers payload MÉRVE 1,48 MB volt — a 10 MiB-os korlát töredéke —,
 * a tranzakciót az indexbejegyzések fújták fel.
 *
 * A tanulság, ami túlmutat ezen az eseten: a csoport költségét nem lehet a
 * blokkok SZÁMÁBÓL megjósolni, mert a tartalmuk dönt (homogén `uniform` blokk
 * pár száz bájt, kevert tulajdonú 343 cellára bomlik). Ezért nem elég egy
 * kisebb küszöb — kell egy visszalépő ág is, ami a valódi hibára reagál.
 *
 * A Firestore ezt Node alatt nem tesztelhető módon dobja (az emulátor nem
 * érvényesíti a méretkorlátot), ezért a felezés logikáját itt, tisztán
 * ellenőrizzük.
 */

/** A Firestore gRPC hibájának alakja, ahogy az éles naplóban megjelent. */
function tooBigError(): Error & { code: number; details: string } {
  return Object.assign(
    new Error('3 INVALID_ARGUMENT: Transaction too big. Decrease transaction size.'),
    { code: 3, details: 'Transaction too big. Decrease transaction size.' },
  );
}

describe('isTransactionTooBig', () => {
  it('felismeri az éles naplóban látott hibát', () => {
    expect(isTransactionTooBig(tooBigError())).toBe(true);
  });

  it('más INVALID_ARGUMENT hibát nem vesz méretproblémának', () => {
    const other = Object.assign(new Error('3 INVALID_ARGUMENT: Document too large'), {
      code: 3,
      details: 'Document too large',
    });
    expect(isTransactionTooBig(other)).toBe(false);
  });

  it('a hálózati és az ismeretlen hibát átengedi', () => {
    expect(isTransactionTooBig(Object.assign(new Error('14 UNAVAILABLE'), { code: 14 }))).toBe(false);
    expect(isTransactionTooBig(new Error('bármi más'))).toBe(false);
    expect(isTransactionTooBig(null)).toBe(false);
  });
});

describe('withSplitOnOverflow', () => {
  const blocks = (count: number) => Array.from({ length: count }, (_, i) => `b${i}`);

  it('a gyakori úton PONTOSAN egy tranzakciót futtat', async () => {
    const calls: Array<{ size: number; partId: string }> = [];
    await withSplitOnOverflow(blocks(200), 'group-0', async (list, partId) => {
      calls.push({ size: list.length, partId });
    });

    expect(calls).toEqual([{ size: 200, partId: 'group-0' }]);
  });

  it('túl nagy tranzakciónál felez, és minden blokkot pontosan egyszer dolgoz fel', async () => {
    const processed: string[] = [];
    // A 100-nál nagyobb csoport „nem fér be" — ez kényszerít egy felezést.
    await withSplitOnOverflow(blocks(200), 'group-0', async (list, partId) => {
      if (list.length > 100) throw tooBigError();
      processed.push(...list.map((block) => `${partId}:${block}`));
    });

    expect(processed).toHaveLength(200);
    // Minden blokk megvan, duplikátum nélkül.
    expect(new Set(processed.map((entry) => entry.split(':')[1]))).toEqual(new Set(blocks(200)));
    // Az azonosító az útvonalból áll össze, tehát az újrafuttatás ugyanoda
    // könyvel — ez a `claimParts` idempotenciájának a feltétele.
    expect(processed[0]).toBe('group-0a:b0');
    expect(processed[199]).toBe('group-0b:b199');
  });

  it('többszörös túlcsordulásnál tovább felez', async () => {
    const parts: string[] = [];
    await withSplitOnOverflow(blocks(400), 'group-2', async (list, partId) => {
      if (list.length > 60) throw tooBigError();
      parts.push(partId);
    });

    // 400 → 200 → 100 → 50: három felezési kör, nyolc rész.
    expect(parts).toHaveLength(8);
    expect(parts[0]).toBe('group-2aaa');
    expect(new Set(parts).size).toBe(8);
  });

  it('az EGYETLEN blokkon elhasaló tranzakciót nem nyeli el', async () => {
    // Tovább vágni nincs mit: itt a hiba valódi, és a hívóra tartozik.
    // Elrejtve némán hiányos foglalás keletkezne — pont az a hiba, amit
    // ez az egész ág megelőzni hivatott.
    await expect(
      withSplitOnOverflow(blocks(1), 'group-0', async () => {
        throw tooBigError();
      }),
    ).rejects.toThrow('Transaction too big');
  });

  it('a NEM méretbeli hibát azonnal továbbdobja, felezés nélkül', async () => {
    let attempts = 0;
    await expect(
      withSplitOnOverflow(blocks(200), 'group-0', async () => {
        attempts += 1;
        throw new Error('profile_missing');
      }),
    ).rejects.toThrow('profile_missing');

    expect(attempts).toBe(1);
  });
});
