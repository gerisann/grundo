package app.grundo.android;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * A FIREBASE TEST LAB GAME LOOP BELÉPŐJE — CSAK DEBUG BUILDBEN.
 *
 * A Test Lab a `com.google.intent.action.TEST_LOOP` intenttel indítja az
 * appot, átad egy `scenario` sorszámot és egy írható fájlt. A futás végét
 * onnan ismeri fel, hogy az activity bezárul; a fájlba írt tartalmat pedig
 * feltölti a Cloud Storage-be az eredmények mellé.
 *
 * ⚠️ MIÉRT KÜLÖN ACTIVITY, ÉS MIÉRT A `debug` FORRÁSKÖNYVTÁRBAN:
 *
 *   1. Ez az osztály és a hozzá tartozó intent-filter a KIADÁSI APK-ból
 *      teljesen hiányzik — a Gradle a `src/debug`-ot csak debug variánsba
 *      fordítja. Így egy éles telepítésen nincs mit elindítani.
 *   2. A `MainActivity` egyetlen sorral sem változik. A mérőbelépő nem
 *      szivároghat bele a rendes indulásba egy elrontott feltétel miatt.
 *
 * A `MainActivity`-ből származik, hogy a natív pluginok (helymeghatározás,
 * App Check, üzenetek) ugyanúgy regisztrálva legyenek — a mérendő lánc
 * pontosan az legyen, ami élesben fut.
 */
public class GameLoopActivity extends MainActivity {

    private static final String TAG = "GrundoGameLoop";

    /** A Test Lab által adott írható fájl. `null`, ha kézzel indítottuk. */
    private Uri logFile;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        int scenario = intent != null ? intent.getIntExtra("scenario", 1) : 1;
        logFile = intent != null ? intent.getData() : null;

        Log.i(TAG, "Game Loop indul, scenario=" + scenario + ", logFile=" + logFile);

        WebView webView = getBridge().getWebView();
        /*
         * A hidat a betöltés ELŐTT kell beregisztrálni: az
         * `addJavascriptInterface` csak a KÖVETKEZŐ oldalbetöltéstől látszik a
         * JS-ben. A `loadUrl` alatta pont ez a következő betöltés.
         */
        webView.addJavascriptInterface(new JsBridge(), "GrundoGameLoop");
        webView.post(() -> webView.loadUrl("https://localhost/gameloop?scenario=" + scenario));
    }

    /**
     * ⚠️ AZ ÍRÁS ÉS A ZÁRÁS KÜLÖN METÓDUS, szándékosan — lásd a JS oldali
     * párját (`src/admin/gameLoopBridge.ts`). Ha egy hívás lenne, egy írás
     * közbeni kivétel úgy zárná le a futást, hogy a Test Lab ÜRES fájlt tölt
     * fel, és a futás sikeresnek látszana mérés nélkül.
     */
    private class JsBridge {

        @JavascriptInterface
        public void writeResult(String json) {
            if (logFile == null) {
                // Kézi indítás Test Lab nélkül: a naplóba tesszük, hogy az
                // `adb logcat`-ből akkor is kiolvasható legyen.
                Log.i(TAG, "Nincs logFile, az eredmény a naplóba megy: " + json);
                return;
            }
            try (OutputStream out = getContentResolver().openOutputStream(logFile)) {
                if (out == null) {
                    Log.e(TAG, "A logFile nem nyitható írásra: " + logFile);
                    return;
                }
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.flush();
                Log.i(TAG, "Eredmény kiírva, " + json.length() + " bájt.");
            } catch (Exception error) {
                Log.e(TAG, "Az eredmény kiírása elszállt.", error);
            }
        }

        @JavascriptInterface
        public void finish() {
            Log.i(TAG, "A JS oldal végzett, zárom az activityt.");
            runOnUiThread(GameLoopActivity.this::finish);
        }
    }
}
