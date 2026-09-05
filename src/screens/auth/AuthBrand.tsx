/**
 * A belépés előtti képernyők fejléce — a VALÓDI logóval, nem szöveggel.
 *
 * Két kép, nem egy: a világos és a sötét téma logója külön fájl, és a CSS
 * választ közülük (`auth__logo--light` / `--dark`). Ugyanaz a minta, mint a
 * Home fejlécében — futásidejű témafigyelés nélkül, tehát a helyes logó már
 * az első képkockán ott van, nem villan át.
 */
export function AuthBrand() {
  return (
    <h1 className="auth__brand">
      <img
        className="auth__logo auth__logo--light"
        src="/grundo-logo-light.png"
        alt="GRUNDO"
        width={180}
        height={51}
      />
      <img
        className="auth__logo auth__logo--dark"
        src="/grundo-logo-dark.png"
        alt=""
        aria-hidden="true"
        width={180}
        height={51}
      />
    </h1>
  );
}
