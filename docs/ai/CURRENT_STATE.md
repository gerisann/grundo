# Jelenlegi állapot

> Frissítve: **2026-09-04** · GRUNDO **#30**
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` · ág: **`main`**
> Állapot: a munkafa tiszta, a `main` egyezik az `origin/main` ággal.

## Jelenlegi cél

A Banda funkciócsomag forrása elkészült és fel van pusholva. Claude következő
feladata az éles adatlépés, a backend/frontend telepítés, majd a bejelentkezett
felületi és feltöltési ellenőrzés. Telepítést csak Geri kifejezett kérésére
futtass a `.claude/skills/grundo-deploy/SKILL.md` szerint.

## Elkészült

- `09be7cb` — új Banda-részlet: `BANDÁK` fejléc, egységes profil-fogaskerék,
  Facebook-jellegű borító és elmosott, témakövető háttér.
- Taglétszám és láthatóság azonos címkestílusban; kiemelt meghívókód,
  `Meghívás` és `Banda megosztása` akciók.
- Ranglista: időszak-dropdown és egysoros, csak ikonos Futás/Séta/Bringa
  választó Font Awesome ikonokkal. A Grund rétegváltója is Font Awesome
  futás/bringa ikonokat használ.
- Tagokból legfeljebb 10 látszik; az `Összes tag` külön görgethető modalt nyit.
- A hírfolyam WYSIWYG szerkesztőt, külön képblokkot, növekvő beviteli mezőt,
  posztkártyákat, tízes betöltést, szerkesztést, törlést, kedvelést és
  kommenteket kapott. A meglévő `postPermission` alapítói beállítás érvényes.
- A `Chat fal` neve `Üzenőfal`; saját üzenet jobbra, másoké balra jelenik meg,
  az üzenetekre válaszolni és szívvel reagálni lehet.
- A szerver új feed edit/delete/like/comment és wall reply/like végpontokat,
  számlálókat, szerzői profilképet és tízes feed-korlátot kezel.
- A korábbi banda profil- és borítókép Storage-szabály 2026-09-04-én sikeresen
  élesítve lett; ez javítja a `bandas/{id}/branding/{uid}/...` unauthorized hibát.

## Módosított fájlok

A legutóbbi funkcionális commit (`09be7cb`) igazolt `git show --numstat` adatai:

| Fájl | Állapot | +/− | Tartalom |
|---|---|---:|---|
| `src/screens/BandaScreen.tsx` | MÓDOSÍTOTT | +99/−48 | Új profilkártya, vezérlők, megosztás és tagmodal. |
| `src/screens/bandaScreen.css` | MÓDOSÍTOTT | +31/−5 | Borítóháttér, hero, választók és modal stílusa. |
| `src/components/BandaFeedWall.tsx` | MÓDOSÍTOTT | +157/−247 | WYSIWYG feed és interaktív üzenőfal. |
| `src/components/bandaFeedWall.css` | MÓDOSÍTOTT | +66/−213 | Posztkártya-, komment- és chatbuborék-stílusok. |
| `server/src/routes/bandas.ts` | MÓDOSÍTOTT | +194/−14 | Feed/fal API és jogosultságok. |
| `server/src/routes/bandas.emulator.test.ts` | MÓDOSÍTOTT | +39/−3 | Új interakciók emulátoros lefedése. |
| `src/lib/api.ts` | MÓDOSÍTOTT | +43/−5 | Új adattípusok és API-hívások. |
| `src/components/ui/LayerSwitch.tsx` | MÓDOSÍTOTT | +4/−32 | Grund Font Awesome ikonok. |
| `src/components/ProfileHeader.tsx` | MÓDOSÍTOTT | +1/−1 | Megosztható `GearIcon`. |
| `package.json`, `package-lock.json` | MÓDOSÍTOTT | +52/−0 | Font Awesome függőségek. |
| `docs/02-funkcionalis-spec.md` | MÓDOSÍTOTT | +17/−8 | Új Banda UX és interakciók. |
| `docs/05-adatmodell.md` | MÓDOSÍTOTT | +12/−3 | Like-, komment- és válaszséma. |
| `docs/ai/CURRENT_STATE.md` | MÓDOSÍTOTT | +19/−9 | Menetközi állapotfrissítés. |

## Élesben fut / telepítetlen

- **Élesben fut:** a friss Storage-szabály; a Firebase deploy sikeres volt.
- **Felpusholva, de nincs élesítve:** `09be7cb` frontend- és backend-kódja.
- **Nem futott le:** a banda-statisztika produkciós backfillje.
- **Nincs új telepítendő index** ebben a commitban. Firestore-szabály sem
  változott; a mostani szabálytelepítés csak a Storage egységet érintette.
- Natív iOS/Android build ebből a commitból nem készült.

## Ellenőrzések

- Kliens typecheck ✅, szerver typecheck ✅.
- Kliens egységtesztek: **734/734** ✅.
- Szerver egységtesztek: **225/225** ✅.
- Célzott Banda Firestore+Storage emulátoros teszt: **23/23** ✅.
- Frontend production build ✅, backend build ✅.
- A production build Firebase- és API-konfigurációja ténylegesen beépült ✅.
- `git diff --check` ✅; munkafa tiszta, push megtörtént ✅.
- Nem történt bejelentkezett Banda-oldali vizuális E2E: a helyi böngészőben
  backend nélkül csak az alkalmazás indulását lehetett ellenőrizni.
- Az éles szabálykiadás után valódi felhasználói kép feltöltése nem történt;
  Geri következő próbája igazolja az eredeti unauthorized hiba megszűnését.

## Nyitott ügyek

1. Próbáld újra élesben a Banda profil- és borítókép feltöltését.
2. Futtasd a `backfill:banda-stats -- --apply --allow-production` adatlépést;
   előtte ellenőrizd a dry-run eredményét.
3. Telepítési sorrend: **backend**, majd **frontend**. **Szabalyok** közül a
   Storage már éles; **indexek** telepítése ehhez a körhöz nem szükséges.
4. Bejelentkezve ellenőrizd mindkét témában a Banda hero/ranglista/feed/fal
   felületet, a like–komment–válasz műveleteket és a 10-es betöltést.
5. Későbbi infrastruktúra-tétel: a `bandaRollover` Cloud Scheduler bekötése.

## Modelljavaslat

**Claude Sonnet, alap mélység.** A folytatás főleg kontrollált adatlépés,
telepítés és célzott éles ellenőrzés; eltérés vagy migrációs anomália esetén
érdemes magasabb gondolkodási mélységre váltani.
