import { Router, type Response } from 'express';
import { badRequest, HttpError } from '../lib/errors';
import type { AuthedRequest } from '../../server';

/**
 * Időjárás — a Home képernyő widgetjének adatforrása.
 *
 * MIÉRT OPEN-METEO, ÉS NEM OPENWEATHER (2026-08-20)?
 *
 * A widget kibontva NÉGY adatot mutat: hőmérséklet, csapadék esélye,
 * páratartalom, szél. Az OpenWeather „current weather" végpontja hármat ad —
 * a CSAPADÉK ESÉLYE ott csak az előrejelzés-végponton van (`pop`), tehát két
 * külön hívás kellene ugyanahhoz a csempéhez. Geri döntése: legyen EGY
 * forrás, ahonnan minden adat egyszerre jön. Az Open-Meteo egyetlen kérésre
 * mind a négyet visszaadja, a szelet ráadásul rögtön km/h-ban, és nem kér
 * API-kulcsot — az `OPENWEATHER_API_KEY` titok ezzel feleslegessé vált.
 *
 * ÁRA, hogy tudni kell róla: a szolgáltató nem ad szöveges leírást, csak WMO
 * kódot, tehát a magyar megnevezés innentől a MIÉNK (lásd `describe`).
 *
 * MIÉRT MEGY A SAJÁT BACKENDÜNKÖN ÁT, ha már kulcs sem kell? Két okból:
 *
 *   1. **A gyorsítótár itt osztott.** Egy városban mozgó felhasználók
 *      többsége ugyanazt az időjárást kapja; kliensenként külön hívva
 *      ugyanazért az adatért terhelnénk a szolgáltatót sokszor.
 *   2. **A felhasználó koordinátája nem megy ki közvetlenül.** Kliensből
 *      hívva a szolgáltató a helyzetet és a felhasználó IP-címét együtt
 *      látná; így csak a mi szerverünk kérdez, két tizedesre kerekítve.
 */
export const weatherRouter = Router();

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

/**
 * Ennyi ideig él egy gyorsítótárazott válasz.
 *
 * Az időjárás nem percenként változik, a szolgáltató maga is ~10-15 percenként
 * frissít. Ennél rövidebb TTL csak fölösleges forgalmat csinálna.
 */
const TTL_MS = 10 * 60 * 1000;

/**
 * Két tizedesre kerekítünk: ez ~1,1 km-es rács.
 *
 * Ennél finomabb bontásnál minden lépés új gyorsítótár-kulcs lenne, és a
 * cache lényegében sosem találna. Ennél durvábbnál a szomszéd város
 * időjárását kapnánk.
 */
const GRID = 100;

/** A gyorsítótár felső mérete — enélkül egy szórt forgalom lassan elszivárogna. */
const MAX_ENTRIES = 500;

interface Cached {
  at: number;
  body: WeatherResult;
}

const cache = new Map<string, Cached>();

/**
 * A felület által ismert időjárás-állapotok.
 *
 * SZÁNDÉKOSAN KEVÉS: az ikonkészletnek mindegyikhez nappali ÉS éjszakai
 * változata van, tehát minden új állapot két rajzot jelent. A szolgáltató
 * harmincnál több kódot ad — azokat ide képezzük le.
 */
export type WeatherCondition =
  | 'clear'
  | 'partly_cloudy'
  | 'cloudy'
  | 'rain'
  | 'snow'
  | 'storm'
  | 'fog';

export interface WeatherResult {
  tempC: number;
  condition: WeatherCondition;
  /** Éjszaka van-e a MÉRT helyen — a szolgáltató `is_day` jelzéséből. */
  night: boolean;
  /** A mi magyar megnevezésünk, pl. „tiszta égbolt". */
  description: string;
  /** Csapadék esélye a FOLYÓ órában, százalék. `null`, ha nem jött adat. */
  precipitationChance: number | null;
  /** Relatív páratartalom, százalék. */
  humidity: number | null;
  /** Szélsebesség, km/h. */
  windKph: number | null;
}

/**
 * WMO kódból a mi állapotunk.
 *
 * A csoportok: 0 derült · 1–3 felhőzet növekvő mértékben · 45,48 köd ·
 * 51–57 szitálás · 61–67 eső · 71–77 hó · 80–82 zápor · 85,86 hózápor ·
 * 95–99 zivatar. A szitálást és a záport ESŐNEK vesszük: a felhasználót az
 * érdekli, esik-e.
 */
export function toCondition(code: number): WeatherCondition {
  if (code === 0) return 'clear';
  if (code === 1 || code === 2) return 'partly_cloudy';
  if (code === 3) return 'cloudy';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 67) return 'rain';
  if (code >= 71 && code <= 77) return 'snow';
  if (code >= 80 && code <= 82) return 'rain';
  if (code === 85 || code === 86) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  // Ismeretlen kód ne törje el a Home képernyőt.
  return 'cloudy';
}

/**
 * A magyar megnevezés.
 *
 * Az Open-Meteo — az OpenWeatherrel ellentétben — nem ad szöveget, csak
 * kódot. A widget viszont képernyőolvasónak is felolvassa, és egérrel fölé
 * érve is ez látszik, tehát kell hozzá mondat.
 */
export function describe(code: number): string {
  switch (code) {
    case 0:
      return 'tiszta égbolt';
    case 1:
      return 'többnyire tiszta';
    case 2:
      return 'részben felhős';
    case 3:
      return 'borult';
    case 45:
      return 'ködös';
    case 48:
      return 'zúzmarás köd';
    case 51:
    case 53:
    case 55:
      return 'szitálás';
    case 56:
    case 57:
      return 'ónos szitálás';
    case 61:
      return 'gyenge eső';
    case 63:
      return 'eső';
    case 65:
      return 'erős eső';
    case 66:
    case 67:
      return 'ónos eső';
    case 71:
      return 'gyenge havazás';
    case 73:
      return 'havazás';
    case 75:
      return 'erős havazás';
    case 77:
      return 'hódara';
    case 80:
      return 'futó zápor';
    case 81:
      return 'zápor';
    case 82:
      return 'heves zápor';
    case 85:
      return 'hózápor';
    case 86:
      return 'erős hózápor';
    case 95:
      return 'zivatar';
    case 96:
    case 99:
      return 'jégesős zivatar';
    default:
      return 'változó idő';
  }
}

/**
 * A FOLYÓ ÓRÁHOZ tartozó csapadék-esély kiválasztása.
 *
 * ⚠️ Miért nem egyszerűen a nulladik elem? Mert a szolgáltató óránkénti
 * tömbje nem garantáltan a mostani órával kezdődik: paraméterezéstől és
 * időzónától függően kezdődhet a nap elején is. Ezért a `current.time`
 * ÓRÁJÁRA illesztünk (az első 13 karakter: „2026-08-20T17"), és csak ha
 * nincs találat, esünk vissza az első elemre.
 *
 * Külön, tiszta függvény, mert ez az egyetlen tényleges logika a válasz
 * feldolgozásában — és tesztelhető anélkül, hogy hálózatot kellene hívni.
 */
export function pickPrecipitationChance(
  currentTime: string | undefined,
  times: unknown,
  values: unknown,
): number | null {
  if (!Array.isArray(times) || !Array.isArray(values) || values.length === 0) return null;

  let index = 0;
  if (typeof currentTime === 'string' && currentTime.length >= 13) {
    const hour = currentTime.slice(0, 13);
    const found = times.findIndex((time) => typeof time === 'string' && time.startsWith(hour));
    if (found >= 0) index = found;
  }

  const value = Number(values[index]);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Szám vagy `null` — a hiányzó adatot nem pótoljuk nullával. */
function optionalNumber(raw: unknown): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(value) : null;
}

function coordinate(raw: unknown, name: string, max: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || Math.abs(value) > max) {
    throw badRequest('invalid_position', `Hibás ${name} érték.`);
  }
  return value;
}

weatherRouter.get('/', async (req: AuthedRequest, res: Response, next) => {
  try {
    const lat = coordinate(req.query.lat, 'szélességi', 90);
    const lon = coordinate(req.query.lon, 'hosszúsági', 180);
    const cacheKey = `${Math.round(lat * GRID)},${Math.round(lon * GRID)}`;

    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return res.json(hit.body);
    }

    const url = new URL(ENDPOINT);
    url.searchParams.set('latitude', String(lat));
    url.searchParams.set('longitude', String(lon));
    url.searchParams.set(
      'current',
      'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    );
    url.searchParams.set('hourly', 'precipitation_probability');
    /*
      Két óra, nem egy: az illesztés (`pickPrecipitationChance`) így akkor is
      talál a mostani órára, ha a szolgáltató a következővel kezdi a tömböt.
    */
    url.searchParams.set('forecast_hours', '2');
    url.searchParams.set('wind_speed_unit', 'kmh');
    url.searchParams.set('timezone', 'UTC');

    /**
     * IDŐKORLÁT: a Home képernyő nem várhat egy külső szolgáltatóra. Ha nem
     * jön válasz 5 másodpercen belül, inkább nincs widget, mint akadó app.
     */
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (response === null || !response.ok) {
      throw new HttpError(
        502,
        'weather_upstream',
        'Az időjárás most nem elérhető. Próbáld később.',
      );
    }

    const data = (await response.json()) as {
      current?: {
        time?: string;
        temperature_2m?: number;
        relative_humidity_2m?: number;
        weather_code?: number;
        wind_speed_10m?: number;
        is_day?: number;
      };
      hourly?: { time?: unknown; precipitation_probability?: unknown };
    };

    const code = Number(data.current?.weather_code ?? 0);

    const body: WeatherResult = {
      tempC: Math.round(Number(data.current?.temperature_2m ?? 0)),
      condition: toCondition(code),
      /*
        Az ÉJSZAKÁT a szolgáltató mondja meg a MÉRT helyre (`is_day`), nem a
        szerver órája dönti el. A szerver Cloud Runon UTC-ben jár, a
        felhasználó meg bárhol lehet — a kettő különbsége simán fordítva
        mutatná.
      */
      night: Number(data.current?.is_day ?? 1) === 0,
      description: describe(code),
      precipitationChance: pickPrecipitationChance(
        data.current?.time,
        data.hourly?.time,
        data.hourly?.precipitation_probability,
      ),
      humidity: optionalNumber(data.current?.relative_humidity_2m),
      windKph: optionalNumber(data.current?.wind_speed_10m),
    };

    // A legrégebbi bejegyzés esik ki elsőnek: a Map beszúrási sorrendet tart.
    if (cache.size >= MAX_ENTRIES) {
      const oldest = cache.keys().next();
      if (!oldest.done) cache.delete(oldest.value);
    }
    cache.set(cacheKey, { at: Date.now(), body });

    res.json(body);
  } catch (error) {
    next(error);
  }
});

/** Csak tesztből: a gyorsítótár ürítése két eset között. */
export function resetWeatherCache(): void {
  cache.clear();
}
