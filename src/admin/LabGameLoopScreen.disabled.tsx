/**
 * A GAME LOOP BELÉPŐ HELYETTESÍTŐJE A KIADÁSI BUILDBEN.
 *
 * ⚠️ MIÉRT KELL EGY ÜRES MODUL: MÉRVE (2026-09-05) a `GRUNDO_GAMELOOP`
 * kapcsoló önmagában NEM ejtette ki a futtatót a kiadási csomagból. Sem a
 * `define`-nal literál `false`-ra cserélt feltétel a használat helyén, sem az
 * a változat, ahol maga a `lazy(() => import(...))` került a hamis ágba: a
 * rolldown a dinamikus importhoz mindkét esetben legyártotta a chunkot, benne
 * a 29 kB-os mérőpályával és a teljes LAB-lánccal.
 *
 * Ezért a `vite.config.ts` a kiadási buildben erre a fájlra IRÁNYÍTJA ÁT a
 * `LabGameLoopScreen` importját. Így a chunk megszületik ugyan, de mindössze
 * ennyi van benne — pálya, LAB sandbox és szimulált GPS-forrás nélkül.
 *
 * A komponens sosem renderelődik: a hívási hely a `GAME_LOOP_BUILD` mögött
 * van, ami ugyanabban a buildben hamis. Ez a modul a második zár, nem az
 * első.
 */
export function LabGameLoopScreen() {
  return null;
}
