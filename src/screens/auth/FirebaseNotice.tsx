import { firebaseConfigured, missingFirebaseConfig } from '@/lib/firebase';

/**
 * Fejlesztői figyelmeztetés hiányzó Firebase-konfiguráció esetén.
 *
 * Korábban a hiányzó környezeti változó a modul betöltésekor dobott, és az
 * app fehér képernyőre futott. Jobb, ha az app elindul, és megmondja, mi
 * hiányzik — így a helyi fejlesztés a bejelentkezésen kívül működik.
 */
export function FirebaseNotice() {
  if (firebaseConfigured) return null;

  return (
    <div className="auth__error" role="alert">
      <strong>A Firebase nincs beállítva</strong> — a bejelentkezés nem működik.
      <br />
      Hiányzó változó: {missingFirebaseConfig.join(', ')}.
      <br />
      Másold a <code>.env.example</code> fájlt <code>.env.local</code> néven, és töltsd ki.
    </div>
  );
}
