/**
 * Aktivitás-fotók feltöltése.
 *
 * A kép NEM a backenden megy át: a Cloud Run kérésmérete korlátos, és
 * értelmetlen lenne több megabájtot átereszteni rajta, amikor a Storage
 * közvetlenül is fogadja. A `storage.rules` a felhasználót a saját mappájába
 * zárja; a szerver csak a HIVATKOZÁST kapja meg, és ellenőrzi az előtagot.
 *
 * ⚠️ AZ EXIF-ADATOK ITT TŰNNEK EL, MÉG A FELTÖLTÉS ELŐTT.
 *
 * A tárolási szabályok eredetileg szerveroldali EXIF-törlést terveztek, de az
 * későn van: a nyers fájl addigra már fent van, és egy fotó EXIF-je tartalmazza
 * a KÉSZÍTÉS PONTOS GPS-KOORDINÁTÁJÁT. Aki a privát zónával elrejti a
 * lakcímét, majd feltölt egy otthon készült képet, ugyanazt az adatot adná ki
 * a hátsó ajtón.
 *
 * A vászonra rajzolás és újrakódolás minden metaadatot eldob — nem szűri,
 * hanem el sem viszi: az új fájl a képpontokból készül, semmi másból.
 */

import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import { storage } from '@/lib/firebase';
import type { ActivityPhoto } from '@/lib/api';

/** Ennyi kép tartozhat egy aktivitáshoz — a szerver is ezt kényszeríti ki. */
export const MAX_PHOTOS = 5;

/**
 * A leghosszabb oldal ekkorára zsugorodik.
 *
 * Egy mai telefon 4000 képpont széles képet készít, ami a feed-kártyán
 * huszonöt méretre kicsinyítve jelenik meg. A teljes felbontás feltöltése a
 * felhasználó mobilnetét fogyasztaná el, hogy aztán a böngésző eldobja.
 */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export class PhotoError extends Error {}

/**
 * Egyetlen kép előkészítése: méretezés, forgatás nélkül, metaadat nélkül.
 *
 * A `createImageBitmap` a legtöbb böngészőben tiszteletben tartja az EXIF
 * tájolást (`imageOrientation: 'from-image'`), tehát az álló képek nem
 * fordulnak el — ez az egyetlen EXIF-adat, amit MEG AKARUNK tartani, és
 * pontosan azért, mert a képpontokba égetjük bele.
 */
async function toJpegBlob(file: File, maxEdge = MAX_EDGE): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoError('Csak képet lehet feltölteni.');
  }

  const source = await decodeImage(file);

  const scale = Math.min(1, maxEdge / Math.max(source.width, source.height));
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new PhotoError('A böngésző nem tudta feldolgozni a képet.');
  context.drawImage(source.image, 0, 0, width, height);
  source.release();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new PhotoError('A képet nem sikerült előkészíteni.');
  return blob;
}

interface DecodedImage {
  image: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

/**
 * Safari/WKWebView fallback: régebbi iOS-verziókban a `createImageBitmap`
 * hiányozhat. Az `<img>` út ugyanúgy vászonra rajzol, ezért az EXIF és minden
 * más metaadat a feltöltött JPEG-ből továbbra is eltűnik.
 */
async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        image: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // A WebKit által támogatott formátumokat még az <img> dekóder megnyithatja.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new PhotoError('Ezt a képet nem sikerült megnyitni.'));
      element.src = url;
    });
    return {
      image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}

export interface UploadProgress {
  /** Hányadik kép készül éppen, 1-től. */
  index: number;
  total: number;
}

/**
 * Képek feltöltése egy aktivitáshoz.
 *
 * Sorban, nem párhuzamosan: mobilneten öt párhuzamos feltöltés egymástól veszi
 * el a sávszélességet, és a felhasználó nem látja, hol tart. Egyesével a
 * visszajelzés is őszinte marad.
 */
export async function uploadActivityPhotos(
  files: readonly File[],
  uid: string,
  activityId: string,
  onProgress?: (progress: UploadProgress) => void,
): Promise<ActivityPhoto[]> {
  if (!storage) throw new PhotoError('A képfeltöltés nincs beállítva.');
  if (files.length > MAX_PHOTOS) {
    throw new PhotoError(`Legfeljebb ${MAX_PHOTOS} képet lehet feltölteni.`);
  }

  const uploaded: ActivityPhoto[] = [];

  for (const [index, file] of files.entries()) {
    onProgress?.({ index: index + 1, total: files.length });

    const blob = await toJpegBlob(file);
    // Az egyediséghez idő + véletlen: két kép ugyanabban a másodpercben is
    // érkezhet, és a fájlnév ütközése az elsőt némán felülírná.
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const path = `activities/${uid}/${activityId}/${name}`;

    const handle = ref(storage, path);
    await uploadBytes(handle, blob, { contentType: 'image/jpeg' });
    uploaded.push({ path });
  }

  return uploaded;
}

/**
 * A szerkesztéskor kivett képek takarítása.
 *
 * A dokumentum frissítése az elsődleges művelet: ha egy fájl törlése hálózati
 * hibán elbukik, attól az aktivitás már nem hivatkozik rá. A hívó ezért ezt a
 * műveletet a sikeres PATCH után futtatja, és a hibát nem fordítja vissza.
 */
export async function deleteActivityPhotos(paths: readonly string[]): Promise<void> {
  if (!storage || paths.length === 0) return;
  const bucket = storage;
  await Promise.allSettled(paths.map((path) => deleteObject(ref(bucket, path))));
}

/** Profilkép: fix objektumútvonal, EXIF nélkül, legfeljebb 512 px-en. */
export async function uploadProfilePhoto(file: File, uid: string): Promise<string> {
  if (!storage) throw new PhotoError('A képfeltöltés nincs beállítva.');
  const blob = await toJpegBlob(file, 512);
  const handle = ref(storage, `avatars/${uid}/profile.jpg`);
  await uploadBytes(handle, blob, { contentType: 'image/jpeg' });
  const url = await getDownloadURL(handle);
  // A fájl neve állandó, ezért a verzióparaméter töri meg a böngésző cache-ét.
  return `${url}${url.includes('?') ? '&' : '?'}v=${Date.now()}`;
}
