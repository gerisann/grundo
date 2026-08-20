import { Router, type Response } from 'express';
import { badRequest, HttpError } from '../lib/errors';
import type { AuthedRequest } from '../../server';

/**
 * Időjárás — a Home képernyő kompakt widgetjének adatforrása.
 *
 * MIÉRT MEGY A SAJÁT BACKENDÜNKÖN ÁT, ha a szolgáltató böngészőből is
 * hívható? Két okból, és mindkettő gyakorlati:
 *
 *   1. **A kulcs nem kerülhet kliensre.** A kiszolgált JS-bundle-t bárki
 *      elolvassa; egy onnan kimásolt kulccsal a mi kvótánkat használnák el.
 *      (A `FIREBASE_WEB_API_KEY` szándékosan más eset — az a Firebase
 *      tervezése szerint publikus.)
 *   2. **A gyorsítótár itt osztott.** Egy városban mozgó felhasználók
 *      többsége ugyanazt az időjárást kapja; kliensenként külön hívva
 *      ugyanazért az adatért fizetnénk sokszor.
 *
 * A kulcs `OPENWEATHER_API_KEY` néven, Secret Managerből jön (lásd
 * `cloudbuild.yaml`). Ha hiányzik, a végpont ŐSZINTÉN megmondja — nem ad
 * kitalált hőmérsékletet.
 */
export const weatherRouter = Router();

const ENDPOINT = 'https://api.openweathermap.org/data/2.5/weather';

/**
 * Ennyi ideig él egy gyorsítótárazott válasz.
 *
 * Az időjárás nem percenként változik, a szolgáltató maga is ~10 percenként
 * frissít. Ennél rövidebb TTL csak a kvótát fogyasztaná.
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
 * több mint ötven kódot ad — azokat ide képezzük le.
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
  /** Éjszaka van-e a MÉRT helyen — a szolgáltató napkelte/napnyugta adatából. */
  night: boolean;
  /** A szolgáltató magyar leírása, pl. „tiszta égbolt". */
  description: string;
}

/**
 * A szolgáltató numerikus kódjából a mi állapotunk.
 *
 * A kódcsoportok jelentése: 2xx zivatar · 3xx szitálás · 5xx eső · 6xx hó ·
 * 7xx légköri (köd, pára, homok) · 800 tiszta · 80x felhőzet növekvő
 * mértékben. A szitálást ESŐNEK vesszük: a felhasználót az érdekli, esik-e.
 */
export function toCondition(code: number): WeatherCondition {
  if (code >= 200 && code < 300) return 'storm';
  if (code >= 300 && code < 600) return 'rain';
  if (code >= 600 && code < 700) return 'snow';
  if (code >= 700 && code < 800) return 'fog';
  if (code === 800) return 'clear';
  // 801 „néhány felhő" és 802 „szórt felhőzet" még részben felhős; a 803-tól
  // az ég túlnyomó része fedett.
  if (code === 801 || code === 802) return 'partly_cloudy';
  return 'cloudy';
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
    const key = process.env.OPENWEATHER_API_KEY ?? '';
    if (!key) {
      throw new HttpError(
        503,
        'weather_unconfigured',
        'Az időjárás-szolgáltatás nincs beállítva.',
      );
    }

    const lat = coordinate(req.query.lat, 'szélességi', 90);
    const lon = coordinate(req.query.lon, 'hosszúsági', 180);
    const cacheKey = `${Math.round(lat * GRID)},${Math.round(lon * GRID)}`;

    const hit = cache.get(cacheKey);
    if (hit && Date.now() - hit.at < TTL_MS) {
      return res.json(hit.body);
    }

    const url = new URL(ENDPOINT);
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lon', String(lon));
    url.searchParams.set('units', 'metric');
    url.searchParams.set('lang', 'hu');
    url.searchParams.set('appid', key);

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
      main?: { temp?: number };
      weather?: { id?: number; description?: string }[];
      dt?: number;
      sys?: { sunrise?: number; sunset?: number };
    };

    const code = Number(data.weather?.[0]?.id ?? 800);
    /**
     * Az ÉJSZAKÁT a mért hely napkeltéjéből és napnyugtájából döntjük el, nem
     * a szerver órájából. A szerver Cloud Runon UTC-ben jár, a felhasználó
     * meg bárhol lehet — a kettő különbsége simán fordítva mutatná.
     */
    const now = Number(data.dt ?? Math.floor(Date.now() / 1000));
    const sunrise = Number(data.sys?.sunrise ?? 0);
    const sunset = Number(data.sys?.sunset ?? 0);
    const night = sunrise > 0 && sunset > 0 ? now < sunrise || now >= sunset : false;

    const body: WeatherResult = {
      tempC: Math.round(Number(data.main?.temp ?? 0)),
      condition: toCondition(code),
      night,
      description: String(data.weather?.[0]?.description ?? ''),
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
