# Codex modell- és erősségválasztás

Projektajánlás a 2026-09-05-én ebben a Codex-környezetben elérhető modellekhez.
Ez feladat szerinti megfeleltetés, nem a Claude-modellek képességeinek azonossága.

| Modell | Azonosító | GRUNDO-feladat | Ajánlott erősség |
|---|---|---|---|
| Astra | `gpt-6-astra` | Nehéz algoritmus, spec-ellentmondás, adatmodell, ismeretlen mért anomália | Erős (`high`); különösen nehéznél `xhigh` |
| Sol | `gpt-5.6-sol` | Összetett, több rétegen átívelő implementáció, hibajavítás, kiadás | Közepes (`medium`) vagy Erős (`high`) |
| Terra | `gpt-5.6-terra` | Szokásos UI, meglévő minta kiterjesztése, célzott teszt, rutin refaktor | Közepes (`medium`) |
| Luna | `gpt-5.6-luna` | Jól körülhatárolt egyszerű javítás, szöveg, dokumentáció | Alacsony (`low`) vagy Közepes (`medium`) |

Claude-workflow átváltása: Opus → Astra; Sonnet → Terra a rutinhoz,
Sol az összetettebb munkához; egyszerű részfeladat → Luna.
Low → Alacsony (`low`), Medium → Közepes (`medium`), High → Erős (`high`),
Extra → `xhigh` projektbeli megfelelő. Az utóbbi nem garantált UI-felirat.

A jelenlegi környezetben mind a négy modell támogatja a `low`, `medium`,
`high`, `xhigh`, `max` értékeket; Astra, Sol és Terra az `ultra` értéket is.
A ténylegesen felkínált modell és erősség az alkalmazás aktuális kínálatától függ.
Ne találj ki elérhetőséget, árat vagy UI-feliratot.

A modelljavaslat nem modellváltás. Geri kérése nélkül ne módosíts modellbeállítást.
Az átadóban a ténylegesen ismert modellt/erősséget írd; ha az erősség nem ismert,
jelöld ismeretlenként. Az ajánlást külön kezeld a tényleges beállítástól.