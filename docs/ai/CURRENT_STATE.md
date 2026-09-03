# Jelenlegi állapot

> Frissítve: **2026-09-03** · GRUNDO **#31**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**

## Jelenlegi cél

A Beállítások UI finomhangolása: a területszín-carousel valóban folyamatosan
végtelen legyen, a PRO-színek previewként kattinthatók legyenek, a háttér-effekt
jobban látszódjon, valamint a settings kártyák Switch-sorainak közös spacingje
mobilon se lógjon rá a keretre.

## Elkészült

1. **Valóban folyamatos szín-carousel:** öt ismételt ciklussal működik, és a
   scroll pozíció a középső tartományban láthatatlan, azonnali rebasinggel marad.
   A felhasználó nem ér el valódi végpontot és nincs visszapörgető animáció.
2. **Nyilak áttetszőbbek:** a két oldali navigációs gomb háttere kb. 50%-os
   fedettségű lett.
3. **Erősebb háttér-effekt:** a territory burst hexagonjainak láthatósága kb.
   15–20%-kal nőtt az előző értékhez képest, miközben továbbra is legfeljebb
   5 másodperc alatt eltűnnek.
4. **PRO preview:** zárolt PRO-színre is lehet koppintani. Középre igazodik és
   lefuttatja a saját színével a háttér-effektet, de a tényleges `onChoose()` és
   Firestore-mentés nem fut le, tehát nem válik aktív színné.
5. **Grund foglalás:** a Megjelenés → Rögzítés közben kapcsoló felirata erre
   változott.
6. **Globális Switch spacing:** a `.list > .switch-row` ugyanazt a belső
   vízszintes paddinget kapja, mint a normál settings sorok. Ez javítja a
   Megjelenés és Hangok listás kapcsolóit, miközben a `.card > .switch-row`
   elrendezéseket nem duplázza meg.
7. **Grafikai szövegek:** `FOV - LÁTÓMEZŐ`, `LÁTÓTÁVOLSÁG (3D NÉZET)`, és a
   3D látótávolság magyarázata a kért magyar szövegre frissült.
8. **Hangok oldal:** a legalul lévő, rögzítés képernyőre és E2E LAB-ra utaló
   magyarázó bekezdés eltávolítva.

## Érintett fájlok

`src/components/CellColorCarousel.tsx` ·
`src/screens/settings/cellColor.css` ·
`src/screens/settings/AppearanceScreen.tsx` ·
`src/screens/settings/GraphicsScreen.tsx` ·
`src/screens/settings/SoundsScreen.tsx` ·
`src/styles/global.css` ·
`docs/ai/CURRENT_STATE.md`

## Ellenőrzés

A módosításokat GitHubon visszaolvastuk és a kért szövegek / CSS-szabályok a
`main` ágon vannak. Ebben a munkamenetben lokális `npm test`, TypeScript
`typecheck` és production build nem futott; deploy előtt ezek futtatása szükséges.

## Telepítés

Telepítés nem történt ebben a munkamenetben.
