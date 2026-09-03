/**
 * AZ APP IKON ELŐÁLLÍTÁSA egyetlen forrásképből, minden platformra.
 *
 * MIÉRT SZKRIPT? Mert az ikon nyolc helyen, tizenhét fájlban él (web manifest,
 * favicon, iOS AppIcon, Android mipmap öt sűrűségben, splash), és kézzel
 * cserélve garantáltan marad valahol a régi. Egy forrás, egy parancs.
 *
 * FUTTATÁS (a repo gyökeréből):
 *
 *   npm run icons:generate
 *   npm run icons:generate -- "másik/forras.png"
 *
 * A forrás alapból a repóban van (`assets/app-icon-source.png`) — SZÁNDÉKOSAN,
 * hogy az ikon bárhol, bármikor újraelőállítható legyen, ne csak azon a gépen,
 * ahol az eredeti fájl véletlenül ott hever. Új arculatnál ezt a fájlt kell
 * lecserélni, és újrafuttatni a parancsot.
 *
 * A forrás LEGYEN NÉGYZETES és legalább 1024 pixel — kisebből felnagyítva a
 * nagy méretek elmosódnának.
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const DEFAULT_SOURCE = 'assets/app-icon-source.png';
const source = process.argv[2] ?? DEFAULT_SOURCE;

/**
 * Az ikon háttérszíne — a forráskép sarkából mintavéve.
 *
 * KÉT HELYEN KELL PONTOSAN EGYEZNIE: az iOS ikon nem lehet átlátszó (a
 * rendszer elutasítja), az Android adaptív ikonnál pedig a háttérszín a
 * rátett előtér mögül látszik ki. Ha a kettő eltérne, sötét négyzet ülne a
 * világos háttéren — pontosan ezt kerüljük el azzal, hogy ugyanaz a szín.
 */
const BACKGROUND = '#131314';

/**
 * Az Android adaptív ikon ELŐTERÉNEK aránya a 108dp-s vásznon belül.
 *
 * A rendszer maszkja a szélekből vág (kör, squircle, lekerekített négyzet
 * — gyártónként más), a biztonságos zóna a középső ~72/108 = 67%. A 72% ezt
 * annyival lépi túl, amennyi a forráskép saját belső margója — így a
 * hatszög a maszk után is teljes egészében látszik.
 */
const ADAPTIVE_FOREGROUND_SCALE = 0.72;

/**
 * A `maskable` webes ikon biztonságos zónája.
 *
 * A W3C ajánlás szerint a tartalomnak a középső 80%-os körben kell elférnie,
 * mert a telepített PWA ikonját a rendszer ugyanúgy maszkolja, mint egy natív
 * appét. Enélkül a hatszög széle lecsípődne a telefon főképernyőjén.
 */
const MASKABLE_SCALE = 0.8;

/**
 * AZ iOS INDÍTÓKÉPERNYŐ (LaunchScreen) mérete és háttere.
 *
 * A `LaunchScreen.storyboard` egyetlen, 2732x2732-es négyzetes képet feszít ki
 * `scaleAspectFill` módban. A háttér SZÁNDÉKOSAN a `splashBackground`
 * (`android/app/src/main/res/values/colors.xml`), nem az ikon háttere: ez a két
 * platform indítóképernyőjének KÖZÖS színe.
 *
 * ⚠️ Ez a rész 2026-09-03-ig HIÁNYZOTT a szkriptből, pedig a fejléce már akkor
 * is splasht ígért — az iOS indítóképernyőn ezért egy RÉGI, leváltott logó
 * (hatszög play-háromszöggel) maradt, jóval az arculatváltás után is.
 */
const SPLASH_SIZE = 2732;
const SPLASH_BACKGROUND = '#09080D';

/**
 * A logó mérete az indítóképernyőn, a vászon szélességének arányában.
 *
 * ⚠️ AZ ARÁNY NEM ÍZLÉS KÉRDÉSE. A `scaleAspectFill` egy négyzetes képet egy
 * MAGAS telefonképernyőre feszítve OLDALT LEVÁG: egy 1170x2532-es kijelzőn a
 * kép középső ~46%-a látszik vízszintesen. A 30% ezen bőven belül van, tehát a
 * hatszög a legkeskenyebb készüléken is teljes egészében látszik.
 */
const SPLASH_LOGO_SCALE = 0.3;

async function write(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
  console.log(`  ${path}`);
}

/** A teljes forráskép adott méretre — átlátszóság megtartva. */
function plain(size) {
  return sharp(source).resize(size, size, { fit: 'cover' }).png().toBuffer();
}

/** Átlátszatlan változat (iOS): a háttérszínre lapítva. */
function opaque(size) {
  return sharp(source).resize(size, size, { fit: 'cover' }).flatten({ background: BACKGROUND }).png().toBuffer();
}

/**
 * Kisebbre méretezett kép a vászon közepén, körben háttérszínnel/átlátszóval.
 *
 * Ez adja a maszkolható változatokat: a tartalom bekerül a biztonságos zónába,
 * a maradékot a keret tölti ki.
 */
async function padded(size, scale, background) {
  const inner = Math.round(size * scale);
  const image = await sharp(source).resize(inner, inner, { fit: 'cover' }).png().toBuffer();
  const offset = Math.round((size - inner) / 2);
  return sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: image, top: offset, left: offset }])
    .png()
    .toBuffer();
}

/**
 * Az indítóképernyő: a logó a vászon közepén, egyszínű, ÁTLÁTSZATLAN háttéren.
 *
 * A `padded()`-től abban tér el, hogy itt a háttér mindig tömör (az
 * indítóképernyő mögött nincs mire átlátszani), és a méretarány sokkal kisebb.
 */
async function splash() {
  const inner = Math.round(SPLASH_SIZE * SPLASH_LOGO_SCALE);
  const image = await sharp(source).resize(inner, inner, { fit: 'cover' }).png().toBuffer();
  const offset = Math.round((SPLASH_SIZE - inner) / 2);
  return sharp({
    create: {
      width: SPLASH_SIZE,
      height: SPLASH_SIZE,
      channels: 4,
      background: SPLASH_BACKGROUND,
    },
  })
    .composite([{ input: image, top: offset, left: offset }])
    .flatten({ background: SPLASH_BACKGROUND })
    // A `flatten` átlátszatlanná teszi a képet, de a csatornát meghagyná —
    // indítóképernyőn az alfa fölösleges súly.
    .removeAlpha()
    .png()
    .toBuffer();
}

const ANDROID_DENSITIES = [
  { dir: 'mdpi', launcher: 48, foreground: 108 },
  { dir: 'hdpi', launcher: 72, foreground: 162 },
  { dir: 'xhdpi', launcher: 96, foreground: 216 },
  { dir: 'xxhdpi', launcher: 144, foreground: 324 },
  { dir: 'xxxhdpi', launcher: 192, foreground: 432 },
];

async function main() {
  const meta = await sharp(source).metadata();
  if (!meta.width || !meta.height) throw new Error(`Nem olvasható kép: ${source}`);
  if (meta.width !== meta.height) {
    throw new Error(`A forrásképnek négyzetesnek kell lennie (${meta.width}x${meta.height}).`);
  }
  if (meta.width < 1024) {
    throw new Error(`A forrás legalább 1024 pixel legyen (most ${meta.width}).`);
  }

  console.log(`Forrás: ${source} (${meta.width}x${meta.height})\n`);
  const root = resolve(process.cwd());
  const at = (...parts) => resolve(root, ...parts);

  console.log('Web (manifest + favicon):');
  await write(at('public/icons/icon-192.png'), await plain(192));
  await write(at('public/icons/icon-512.png'), await plain(512));
  await write(
    at('public/icons/icon-maskable-512.png'),
    await padded(512, MASKABLE_SCALE, BACKGROUND),
  );
  await write(at('public/icons/favicon-32.png'), await plain(32));
  await write(at('public/icons/apple-touch-icon.png'), await opaque(180));

  console.log('\niOS:');
  // Az App Store elutasítja az átlátszóságot tartalmazó ikont.
  await write(at('ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png'), await opaque(1024));
  // A Capacitor a `public/` mappát bemásolja az iOS csomagba — a másolatot is
  // frissítjük, hogy egy `cap sync` nélkül se maradjon régi ikon a buildben.
  await write(at('ios/App/App/public/icons/icon-192.png'), await plain(192));
  await write(at('ios/App/App/public/icons/icon-512.png'), await plain(512));
  await write(
    at('ios/App/App/public/icons/icon-maskable-512.png'),
    await padded(512, MASKABLE_SCALE, BACKGROUND),
  );

  /**
   * Az iOS indítóképernyő HÁROM fájlja azonos tartalommal.
   *
   * A `Splash.imageset` 1x/2x/3x változatot vár (a Capacitor így hozza létre),
   * de mivel a kép már így is 2732 pixeles, nincs értelme három különböző
   * felbontásnak — a storyboard úgyis a képernyőre feszíti. Android oldalon
   * nincs teendő: ott az indítóképernyő a `grundo_app_icon`-t használja
   * (`styles.xml`, `windowSplashScreenAnimatedIcon`), amit fent már megírtunk.
   */
  console.log('\niOS indítóképernyő:');
  const splashImage = await splash();
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await write(at('ios/App/App/Assets.xcassets/Splash.imageset', name), splashImage);
  }

  console.log('\nAndroid:');
  for (const { dir, launcher, foreground } of ANDROID_DENSITIES) {
    const base = at('android/app/src/main/res', `mipmap-${dir}`);
    await write(resolve(base, 'ic_launcher.png'), await opaque(launcher));
    await write(resolve(base, 'ic_launcher_round.png'), await opaque(launcher));
    // Az előtér ÁTLÁTSZÓ kerettel: a maradékot az `ic_launcher_background`
    // színe tölti ki, ami ugyanaz, mint a kép saját háttere.
    await write(
      resolve(base, 'ic_launcher_foreground.png'),
      await padded(foreground, ADAPTIVE_FOREGROUND_SCALE, { r: 0, g: 0, b: 0, alpha: 0 }),
    );
  }
  await write(at('android/app/src/main/res/drawable-nodpi/grundo_app_icon.png'), await opaque(512));

  console.log('\nKész.');
}

await main();
