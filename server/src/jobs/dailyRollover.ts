/**
 * Napi forduló — HELYI IDŐ szerint.
 *
 * A job ÓRÁNKÉNT fut, és mindig azokat a felhasználókat dolgozza fel, akiknél
 * az elmúlt órában fordult a helyi éjfél. Így a terhelés egyenletesen oszlik
 * el a nap 24 órájára — ez üzemeltetési szempontból kényelmesebb is, mint
 * egyetlen UTC-csúcs.
 *
 * SORREND (nem cserélhető fel):
 *   1. hold-bónusz kiosztása a birtokolt terület után
 *   2. a védelem visszaállítása 1×-esre
 *   3. streak-értékelés (fagyasztás, megszakadás, heti mérföldkövek)
 *
 * Ha a védelmet a hold-bónusz ELŐTT állítanánk vissza, az nem befolyásolná a
 * bónuszt (az a területtől függ, nem a védelemtől) — de a sorrend rögzítése
 * így is fontos, mert a lépések naplózása és az esetleges újrafuttatás
 * kiszámítható kell legyen.
 *
 * Visszaélés-védelem: az időzóna-váltás naplózva van, és 30 naponta legfeljebb
 * egyszer vehető figyelembe a forduló szempontjából — különben oda-vissza
 * utazgatással kétszer lehetne beszedni a napi bónuszt.
 *
 * docs/03-jatekszabalyok.md → Napi forduló
 * docs/04-pontrendszer.md   → Napi tartás (hold) bónusz
 */

export interface RolloverSummary {
  usersProcessed: number;
  holdGpAwarded: number;
  cellsReset: number;
  streaksBroken: number;
  milestonesAwarded: number;
}

/** @param now a futás időpontja — sose olvasd közvetlenül a rendszerórát, hogy tesztelhető maradjon */
export async function runDailyRollover(_now: Date): Promise<RolloverSummary> {
  // TODO(F2): implementáció
  throw new Error('Még nincs implementálva — lásd docs/03-jatekszabalyok.md');
}
