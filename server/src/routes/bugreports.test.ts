/**
 * A bugreport-melléklet ÚTVONAL-ELLENŐRZÉSE.
 *
 * Ez a határ egyik fele: a `storage.rules` a feltöltésnél zárja a felhasználót
 * a saját mappájába, ez pedig a bejelentésnél. Ha csak az egyik lenne meg, egy
 * hívás MÁS felhasználó fájljára mutató hivatkozást tehetne a saját
 * bejelentésébe — az admin adatlapja pedig aláírt olvasó-URL-t adna ki rá.
 *
 * docs/ai/terv-2026-09-09-bugreport-rendszer.md → 3., 7.
 */

import { describe, expect, it } from 'vitest';
import { mediaPathBelongsTo } from './bugreports';

const UID = 'user-1';
const REPORT = 'report-1';

describe('mediaPathBelongsTo', () => {
  it('elfogadja a saját bejelentés alatti fájlt', () => {
    expect(mediaPathBelongsTo(`bugreports/${UID}/${REPORT}/kep.png`, UID, REPORT)).toBe(true);
  });

  it('elutasítja MÁS felhasználó mappáját', () => {
    expect(mediaPathBelongsTo(`bugreports/mas-user/${REPORT}/kep.png`, UID, REPORT)).toBe(false);
  });

  it('elutasítja a másik bejelentéshez tartozó fájlt', () => {
    expect(mediaPathBelongsTo(`bugreports/${UID}/masik/kep.png`, UID, REPORT)).toBe(false);
  });

  it('elutasítja a fájlnév nélküli, csupasz előtagot', () => {
    expect(mediaPathBelongsTo(`bugreports/${UID}/${REPORT}/`, UID, REPORT)).toBe(false);
  });

  it('elutasítja a mappából kilépő szegmenst', () => {
    expect(
      mediaPathBelongsTo(`bugreports/${UID}/${REPORT}/../../mas/kep.png`, UID, REPORT),
    ).toBe(false);
  });

  it('elutasítja a más gyűjteményre mutató útvonalat', () => {
    expect(mediaPathBelongsTo(`avatars/${UID}/profile.jpg`, UID, REPORT)).toBe(false);
  });

  it('elutasítja az üres útvonalat', () => {
    expect(mediaPathBelongsTo('', UID, REPORT)).toBe(false);
  });
});
