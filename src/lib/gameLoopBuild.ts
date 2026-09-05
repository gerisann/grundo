/**
 * Benne van-e ebben a buildben a Game Loop mérőbelépő?
 *
 * A `vite.config.ts` írja be buildidőben, a `GRUNDO_GAMELOOP=1` környezeti
 * változóból. Konstans, tehát a hamis ág és a mögötte lévő teljes LAB-kód
 * kiesik a kiadási csomagból.
 */
declare const __GRUNDO_GAMELOOP__: boolean;

export const GAME_LOOP_BUILD: boolean = __GRUNDO_GAMELOOP__;
