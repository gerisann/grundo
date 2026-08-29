# GRUNDO handoff

> Frissítve: **2026-08-29** · a **#21** menet vége, átadás **#22**-re
>
> Repo: `C:\Users\Geri\Documents\GitHub\grundo` (EGYETLEN klón — a második
> `Documents\ChatGPT\GRUNDO` törölve) · GitHub: `gerisann/grundo`
>
> Ág: **`main`**, mindent pusholva. **GraphHopper élesítve és bizonyítottan
> működik.** Van egy NYITOTT, nem kis súlyú hiba: GPS-drift hamis
> aktivitásokat hoz létre — lásd lent, ELSŐ OLVASNIVALÓ.

## ⚠️ ELSŐ OLVASNIVALÓ — #22 fő feladata

**Beltéri/álló helyzeti GPS-zaj hamis aktivitást hoz létre.** Geri jelentése:
telefont a lakásban zárolt képernyővel egy órán át hagyva, meg sem mozdulva,
az app **2,99 km futást és 703 m emelkedést** rögzített (kanyargós,
gombolyag-mintázatú nyomvonal — 2. #21-es üzenet screenshotja).

**A diagnózis KÉSZ, a javítás MÉG NEM KEZDŐDÖTT EL.**

### Ok #1 — hamis táv: `src/tracking/filter.ts`

```ts
if (dist < MIN_MOVE_M && dt < MAX_GAP_MS) → elutasítva
```

`MIN_MOVE_M = 5` méter — de egy beltéri GPS-fix a többutas terjedés miatt
simán ugrik 5–15 métert, véletlenszerű irányba. Minden ilyen ugrás
ÖNMAGÁBAN „elfogadható" (5 m fölött van, nem lehetetlen sebesség), tehát a
szűrő mind átengedi, és ezek ÖSSZEADÓDNAK valódi távolsággá. A szűrő
pontpáronként dönt, nincs időablakos „helyben vagyunk" detektora.

**Ugyanez adja a korábban jelzett hibát is**: induláskor 10–20 km/h
sebesség állva — a `currentSpeedMps` (recorder.ts) az utolsó 10 mp
elfogadott pontjainak távolságösszegéből számol; 5–8 m zaj 3–5 mp-enként
pont ennyi "sebességnek" adódik.

### Ok #2 — hamis emelkedés: `src/game/splits.ts`

```ts
const ELEVATION_NOISE_M = 3; // túl kicsi
```

A GPS-magasság 2-3×-osan pontatlanabb a vízszintesnél, beltérben tovább
romlik. Nincs `altitudeAccuracy` sehol a láncban (`PositionSample` típus
sem tartalmazza) — a magasság szűretlenül megy be a nyeselő gain-számításba.

### Amit a javítás igényel (NEM egysoros küszöbállítás)

A nehézség: ne törje el a valós lassú mozgást (piros lámpa, séta). Kell:
- **időablakos „helyben vagyunk" detektor** — ne pontpáronként, hanem egy
  horgony/középpont körüli klaszterezéssel döntsön, mozdult-e ténylegesen;
- **magasság-küszöb újragondolása**, vagy pontossághoz kötése (esetleg
  `altitudeAccuracy` felvétele a típusba és a natív forrásokba is);
- **indulási bemelegedési időszak**, mert az első pár fix jellemzően
  pontatlanabb.

Nincs `filter.test.ts` — a szűrő logikáját csak közvetve, a
`recorder.test.ts`-en át tesztelik. Egy valódi javításhoz saját teszt kell.

**Modelljavaslat: Opus, emelt mélység** (AGENTS.md 0. pont — mért anomália +
algoritmus-tervezés, nem rutin küszöbváltoztatás). A #21 végén Geri épp
váltani készült, amikor a menet lezárult.

Érintett fájlok, ahol a munka kezdődik:
- `src/tracking/filter.ts` — a szűrő maga
- `src/tracking/recorder.ts` — `applySample`, `currentSpeedMps`
- `src/game/splits.ts` — `ELEVATION_NOISE_M`, `elevationProfile`
- `src/tracking/types.ts`, `browserSource.ts`, `nativeSource.ts` — ha kell
  `altitudeAccuracy`

## MÁSODIK NYITOTT TÉMA — küldetés-ajánló finomítás

Geri visszajelzései (#21, GraphHopper élesítés UTÁN kezdhetők):

1. **Találatszám 1–5, állítható a részletes keresőben.** Geri döntése: a
   beállítás felső korlát; ha az átfedés-szűrés (`MAX_MISSION_OVERLAP = 0.6`
   a `src/game/missions.ts`-ben) miatt kevesebb jönne ki a kértnél, a szűrés
   LAZULJON a szám eléréséért; csak ha úgy sem megy, adjon kevesebbet és
   mondja meg miért. Geri szerint városban „kizárt", hogy ne legyen 5 érdemi
   variáció — a mai mérés (5-6 útvonalból 1 kártya) ezt alátámasztja: a
   szűk keresztmetszet a válogatás, nem az úthálózat.
2. **GPS-ingadozás → más eredmény ugyanarra a kérésre.** Mérve: 10-20 m
   eltolt kiindulópont 1 vs. 3 kártyát ad. Javaslat (még nem kezdve): a
   kiindulópont rácsra kerekítése a küldetés-generáláshoz.
3. **Sík / emelkedős választó.** GraphHopperrel megoldható, de domborzati
   adat (SRTM) és TELJES újraimportálás kell hozzá — külön, hosszabb kör.

## ÉLESBEN FUT — ELLENŐRIZVE

### GraphHopper (ÚJ ebben a menetben, működik)

Külön Cloud Run szolgáltatás (`grundo-graphhopper`), a gráf BUILD KÖZBEN
épül fel (`graphhopper/Dockerfile` → `import`), `--no-allow-unauthenticated`.
A `grundo-api` Google-aláírt ID-tokennel hívja a metaadat-szervertől
(`server/src/lib/directions.ts` → `graphhopperIdToken`, saját kulcs/Secret
Manager nélkül).

**Élőben igazolva**: `POST /route` → `200 OK` a `grundo-graphhopper`
naplójában, pontosan a küldetés-generálás időpontjában. Kanyargós/egyenes
karakter eltérő útvonal-hosszakat ad (7,3/6,9/6,9 vs 7,2/8,2/7,5 km).

⚠️ **Telepítés csak ritkán, külön paranccsal**:
```bash
~/grundo/scripts/deploy.sh graphhopper
```
NEM része az `all` módnak — a gráf csak OSM-frissítésnél vagy a
`graphhopper/` mappa változásakor épül újra (percekig tart).

**Egyszeri beüzemelés (MÁR MEGTÖRTÉNT, dokumentálva ha meg kell ismételni):**
1. `gcloud run services add-iam-policy-binding grundo-graphhopper --region=europe-west1 --member="serviceAccount:65689674957-compute@developer.gserviceaccount.com" --role="roles/run.invoker"`
2. Backend újratelepítése `--substitutions=_GRAPHHOPPER_URL=https://…`

⚠️ **Csapda, amibe belefutottunk és javítva**: a `deploy.sh` mód-ellenőrzése
a `git pull` ELŐTT volt, ezért egy elavult helyi másolat sosem jutott el
odáig, hogy frissítse magát — új módot (mint a `graphhopper`) a régi
szkript nem ismert, és azonnal elhalt, `info` sorok nélkül. JAVÍTVA
(`de98101`): az ellenőrzés a dispatch `case` végén van, a pull UTÁN.
**Ha ismét „Ismeretlen mód" jön minden `▸` sor nélkül**: `cd ~/grundo &&
git pull` kézzel, utána a szkript már önmagától is frissül.

Mért hidegindítás: ~8-15 s hosszú szünet után (nullára skálázva), utána
percekig meleg. Összemérhető a backend saját hidegindításával (~12 s).

### Küldetés-ajánló (a #19-ből, változatlanul él)

Gyors fázis + lassú fázis szétválasztva, ~0,7-0,8 s meleg állapotban. Lásd
a #19/#20-as HANDOFF-tartalmat a git történetben, ha a részletek kellenek
(`git show b149cdf:HANDOFF.md` stb.) — ez a fájl a hellyel spórolva csak a
MOST aktuális állapotot tartja.

### Mapbox token — megoldva, Secret Managerből jön

`MAPBOX_TOKEN` a Secret Managerből (`--set-secrets`), a telepítés nem tudja
kiütni. Csere: `gcloud secrets versions add MAPBOX_TOKEN --data-file=-` +
újratelepítés, kódváltozás nélkül. Élesben a KLIENS token fut szerveroldalon
(közös, nem korlátozott) — külön szerver token még nyitott, kis prioritású
ügy.

## KISEBB, KÉSZ JAVÍTÁS EBBEN A MENETBEN

**Stepper mezők** (`src/screens/MissionsScreen.tsx`, `missions.css`):
kézzel gépelhetők (eddig csak −/+), és az érték a doboz KÖZEPÉN áll, nem a
szélén (`size` attribútum a tartalomhoz igazítva, mérve: 0 px eltérés a
középtől minden értéknél).

## NYITOTT ÜGYEK (korábbi menetekből, változatlan)

1. Nagy bringakör + meglévő birtok = nincs küldetés (`processActivityGeometry`
   compact ága). NEM a #19/#20/#21 okozta, régóta így van. Opus-szintű menet.
2. 300 km-es kérésnél a gyors fázis is ~17 s (16 GraphHopper-hívás egyszerre)
   — GraphHopper élesítése után érdemes újramérni, lehet, hogy javult.
3. Android: Codemagic build + készülékes teszt még nem történt meg.

## ELLENŐRZÉSEK

- `npx tsc --noEmit` mindkét oldalon tiszta (a GraphHopper auth-kód után is).
- Teljes `npx vitest run`: 556 sikeres, 122 kihagyva — nincs regresszió.
- GraphHopper Dockerfile: NEM lett helyben lebuildelve (nincs helyi Docker),
  csak a `gcloud builds submit` igazolta — az sikerrel lefutott élesben.
- Éles kéréssel igazolva: küldetés-generálás, kanyargós/egyenes eltérés,
  Cloud Run napló (`POST /route` → 200).

## FORRÁSOK SORRENDJE

1. `AGENTS.md` — Munkamódszer szakasz, és az ÚJ „natív appok" rész
2. `HANDOFF.md` (ez a fájl)
3. `src/tracking/filter.ts` — a GPS-drift javítás kezdőpontja
4. `src/tracking/recorder.ts` — `applySample`, `currentSpeedMps`
5. `src/game/splits.ts` — `ELEVATION_NOISE_M`
6. `graphhopper/README.md` → Élesítés — ha a GraphHopper-t kell újratelepíteni
7. `server/src/lib/directions.ts` → `graphhopperIdToken`
