/**
 * „A panel beszívódik a Play gombba” — átvezetés a tervezésből az indításba.
 *
 * MIÉRT VAN? Mert a „Gyerünk!” után a következő lépés a dokk Play gombja, és
 * ez nem volt magától értetődő: a panel becsukódott, a kártya megjelent, de a
 * tekintetnek nem volt mit követnie.
 *
 * ⚠️ MAGA A PANEL MEGY BE, NEM EGY KÜLÖN ELEM. Az első változat egy üres
 * téglalapot repített le a gombra — az szétesett: a téglalapnak semmi köze
 * nem volt ahhoz, amit a felhasználó nézett. A macOS dokk „genie” mozdulatában
 * is az ABLAK szívódik be az ikonba; ez a lényeg, nem a görbe alakja.
 *
 * Az igazi genie nem-lineáris deformáció (a felső él széles marad, míg az alja
 * már a célban van), amit CSS-ben nem lehet pontosan megcsinálni. Amit át
 * lehet venni: a panel egyszerre MOZOG, ZSUGORODIK és KEREKEDIK a gomb felé,
 * gyorsulva — így a mozdulat egyetlen, folyamatos gesztusnak látszik, nem két
 * külön lépésnek.
 *
 * ⚠️ SZÁNDÉKOSAN A DOM-ON KERESZTÜL DOLGOZIK. A panel és a Play két távoli
 * komponensben él (a gomb a zsákmány-panelben, a Play a `Dock`-ban, ami az
 * `App` szintjén ül), és nincs közös állapotuk. Egy fél másodperces, tisztán
 * vizuális effektushoz nem építünk közéjük állapot-átvezetést.
 */

/** A beszívódás hossza. Ennél hosszabb már várakozásnak érződik. */
const SUCK_MS = 460;

/** Hányszor lüktessen a Play, miután a panel „beleszaladt”. */
const BECKON_PULSES = 3;
const BECKON_MS = 2400;

/**
 * Beszívja a panelt a dokk Play gombjába, majd felvillantja azt.
 *
 * A `done` az animáció VÉGÉN fut le — a hívó ekkor zárja be a panelt és lépjen
 * tovább. Ha bármelyik elem hiányzik, vagy a felhasználó csökkentett mozgást
 * kért, a `done` azonnal lefut, és csak a figyelemfelhívás marad.
 */
export function suckPanelIntoPlay(panel: HTMLElement | null, done: () => void): void {
  const target = document.querySelector<HTMLElement>('.dock__play');

  /*
    ⚠️ CSÖKKENTETT MOZGÁS: a beszívódás elmarad, de a FIGYELEMFELHÍVÁS nem. Aki
    kikapcsolta az animációkat, annak is tudnia kell, hol a folytatás.
  */
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (!panel || !target || reduced) {
    if (target) beckon(target);
    done();
    return;
  }

  const from = panel.getBoundingClientRect();
  const to = target.getBoundingClientRect();

  /* A panel KÖZEPÉBŐL a gomb KÖZEPÉBE tartunk. */
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  /* A gomb átmérőjére zsugorodunk — a panel szélességéhez mérve. */
  const scale = Math.max(0.04, to.width / Math.max(1, from.width));

  panel.style.setProperty('--suck-dx', `${dx}px`);
  panel.style.setProperty('--suck-dy', `${dy}px`);
  panel.style.setProperty('--suck-scale', String(scale));
  panel.classList.add('rrp__panel--sucking');

  /*
    A GOMB FELVILLANÁSA MÁR A MOZGÁS KÖZBEN INDUL, nem utána: mire a panel
    odaér, a gyűrű már tágul, tehát a tekintet nem áll meg egy üres pillanatra.
  */
  window.setTimeout(() => beckon(target), Math.round(SUCK_MS * 0.65));

  window.setTimeout(() => {
    panel.classList.remove('rrp__panel--sucking');
    done();
  }, SUCK_MS);
}

/**
 * A Play gomb felvillantása — VÉGES számú lüktetés.
 *
 * ⚠️ Nem végtelen: a folyamatosan villogó gomb pár másodperc után zavaró, és
 * a figyelmet éppen elvonja a térképről. Három lüktetés elég ahhoz, hogy a
 * tekintet megállapodjon rajta.
 */
function beckon(target: HTMLElement): void {
  target.classList.add('dock__play--beckon');
  window.setTimeout(
    () => target.classList.remove('dock__play--beckon'),
    BECKON_MS * BECKON_PULSES,
  );
}
