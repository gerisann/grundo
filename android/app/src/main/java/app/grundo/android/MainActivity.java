package app.grundo.android;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // ⚠️ IDEIGLENES, TELJESÍTMÉNYMÉRÉSHEZ (GRUNDO #21): a WebView
        // remote debugging RELEASE buildben is bekapcsolva, hogy a
        // `chrome://inspect`-tel élő Play Console-os teszt-buildet
        // lehessen profilozni. Szándékosan NEM `BuildConfig.DEBUG` mögé
        // rejtve — az release buildben mindig hamis, ezért egy ilyen őr
        // itt épp a mérést tenné lehetetlenné. A `setWebContentsDebuggingEnabled`
        // a WebView LÉTREHOZÁSA ELŐTT kell hogy fusson, ezért van a
        // `super.onCreate()` (ami a Capacitor hidat és a WebView-t építi)
        // előtt, a `registerPlugin` hívás mellett.
        //
        // TEENDŐ A MÉRÉS UTÁN: ezt a sort törölni kell, mielőtt a GRUNDO
        // tényleges nyilvános kiadást kap — élesben nem maradhat bekapcsolva
        // a távoli hibakeresés.
        WebView.setWebContentsDebuggingEnabled(true);
        registerPlugin(BackgroundLocationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
