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
async function toJpegBlob(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new PhotoError('Csak képet lehet feltölteni.');
  }

  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => {
    throw new PhotoError('Ezt a képet nem sikerült megnyitni.');
  });

  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) throw new PhotoError('A böngésző nem tudta feldolgozni a képet.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
  );
  if (!blob) throw new PhotoError('A képet nem sikerült előkészíteni.');
  return blob;
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
    uploaded.push({ path, url: await getDownloadURL(handle) });
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
