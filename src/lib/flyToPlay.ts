/**
 * „A gomb leszáll a Play-re” — átvezető animáció a tervezésből az indításba.
 *
 * MIÉRT VAN? Mert a „Gyerünk!” után a következő lépés a dokk Play gombja, és
 * ez nem volt magától értetődő: a panel becsukódott, a kártya megjelent, de a
 * tekintetnek nem volt mit követnie. Ez a mozgás VISZI a szemet oda, ahol a
 * folytatás van — ugyanaz az elv, mint amikor egy fájl „berepül” a mappába.
 *
 * ⚠️ SZÁNDÉKOSAN A DOM-ON KERESZTÜL DOLGOZIK. A két elem két távoli
 * komponensben él (a gomb a zsákmány-panelben, a Play a `Dock`-ban, ami az
 * `App` szintjén ül), és nincs közös állapotuk. Egy tisztán vizuális,
 * fél másodperces effektushoz nem építünk közéjük állapot-átvezetést — az
 * több kárt okozna a kód olvashatóságában, mint amennyit ér.
 */

/** A repülés hossza. Ennél hosszabb már várakozásnak érződik. */
const FLIGHT_MS = 420;

/** Hányszor lüktessen a Play, miután a gomb „leszállt” rá. */
const BECKON_PULSES = 3;
const BECKON_MS = 2400;

/**
 * Elrepíti a megadott gomb mását a dokk Play gombjára, majd felvillantja azt.
 *
 * Csendben nem csinál semmit, ha bármelyik elem hiányzik (például más
 * képernyőn vagyunk), vagy ha a felhasználó csökkentett mozgást kért.
 */
export function flyToPlayButton(source: HTMLElement | null): void {
  if (!source) return;

  const target = document.querySelector<HTMLElement>('.dock__play');
  if (!target) return;

  /*
    ⚠️ CSÖKKENTETT MOZGÁS: a repülés elmarad, de a FIGYELEMFELHÍVÁS nem. Aki
    kikapcsolta az animációkat, annak is tudnia kell, hol a folytatás — a
    kiemelés statikus marad, csak nem mozog semmi.
  */
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  if (reduced) {
    beckon(target);
    return;
  }

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();

  const ghost = document.createElement('div');
  ghost.className = 'fly-to-play';
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.height = `${from.height}px`;
  document.body.appendChild(ghost);

  /* A cél KÖZEPÉBE tartunk, és közben a gomb méretére zsugorodunk. */
  const scaleX = to.width / Math.max(1, from.width);
  const scaleY = to.height / Math.max(1, from.height);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);

  /* Egy képkocka, hogy a kiinduló állapot érvényre jusson az átmenet előtt. */
  requestAnimationFrame(() => {
    ghost.style.transition = `transform ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${FLIGHT_MS}ms ease-in`;
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
    ghost.style.opacity = '0.15';
    ghost.style.borderRadius = '50%';
  });

  window.setTimeout(() => {
    ghost.remove();
    beckon(target);
  }, FLIGHT_MS);
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
