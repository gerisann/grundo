package app.grundo.android;

import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.List;

/** Capacitor bridge for the GRUNDO Android location foreground service. */
@CapacitorPlugin(
    name = "BackgroundLocation",
    permissions = {
        @Permission(
            alias = BackgroundLocationPlugin.LOCATION_PERMISSION,
            strings = { Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION }
        )
    }
)
public final class BackgroundLocationPlugin extends Plugin {
    static final String LOCATION_PERMISSION = "location";

    private TrackingLocationStore store;
    private boolean receiverRegistered;

    private final BroadcastReceiver eventReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String eventType = intent.getStringExtra(TrackingLocationService.EXTRA_EVENT_TYPE);
            if ("error".equals(eventType)) {
                JSObject error = new JSObject();
                error.put("code", intent.getStringExtra(TrackingLocationService.EXTRA_ERROR_CODE));
                error.put("message", intent.getStringExtra(TrackingLocationService.EXTRA_ERROR_MESSAGE));
                notifyListeners("error", error, true);
                return;
            }
            if (!"location".equals(eventType)) return;
            JSObject location = new JSObject();
            location.put("lat", intent.getDoubleExtra(TrackingLocationService.EXTRA_LAT, 0));
            location.put("lng", intent.getDoubleExtra(TrackingLocationService.EXTRA_LNG, 0));
            location.put("t", intent.getLongExtra(TrackingLocationService.EXTRA_TIME, 0));
            location.put("accuracy", intent.getFloatExtra(TrackingLocationService.EXTRA_ACCURACY, Float.MAX_VALUE));
            if (intent.getBooleanExtra(TrackingLocationService.EXTRA_HAS_ELEVATION, false)) {
                location.put("elevation", intent.getDoubleExtra(TrackingLocationService.EXTRA_ELEVATION, 0));
            }
            if (intent.getBooleanExtra(TrackingLocationService.EXTRA_HAS_SPEED, false)) {
                location.put("speed", intent.getFloatExtra(TrackingLocationService.EXTRA_SPEED, 0));
            }
            notifyListeners("location", location, true);
        }
    };

    @Override
    public void load() {
        store = new TrackingLocationStore(getContext());
        ContextCompat.registerReceiver(
            getContext(),
            eventReceiver,
            new IntentFilter(TrackingLocationService.EVENT_ACTION),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
        receiverRegistered = true;
    }

    @Override
    protected void handleOnDestroy() {
        if (receiverRegistered) {
            getContext().unregisterReceiver(eventReceiver);
            receiverRegistered = false;
        }
        store.close();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (!locationServicesEnabled()) {
            call.reject("A helymeghatározás ki van kapcsolva a készüléken.", "location_disabled");
            return;
        }
        if (!hasFineLocationPermission()) {
            requestPermissionForAlias(LOCATION_PERMISSION, call, "locationPermissionCallback");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void locationPermissionCallback(PluginCall call) {
        if (!hasFineLocationPermission()) {
            call.reject(
                "A GRUNDO GPS-rögzítéséhez pontos helyhozzáférés szükséges; a hozzávetőleges hely nem elég pontos.",
                "permission_denied"
            );
            return;
        }
        startService(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TrackingLocationService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void syncActivity(PluginCall call) {
        TrackingLocationService.sync(getContext(), null, call.getString("status", "recording"));
        call.resolve();
    }

    @PluginMethod
    public void drain(PluginCall call) {
        bridge.execute(() -> {
            try {
                List<JSObject> queued = store.drain();
                JSObject result = new JSObject();
                result.put("locations", new JSArray(queued));
                call.resolve(result);
            } catch (RuntimeException error) {
                call.reject("A háttérben rögzített GPS-pontok beolvasása nem sikerült.", "queue_failed", error);
            }
        });
    }

    private void startService(PluginCall call) {
        JSObject activityState = call.getObject("activityState");
        String status = activityState == null ? "recording" : activityState.getString("status", "recording");
        try {
            TrackingLocationService.start(
                getContext(),
                call.getString("activityType", "run"),
                status
            );
            JSObject result = new JSObject();
            result.put("permission", "granted");
            result.put("backgroundPermission", "granted");
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Az Android nem engedte elindítani a helyalapú háttérszolgáltatást.", "permission_denied", error);
        } catch (RuntimeException error) {
            call.reject("A helyalapú háttérszolgáltatás nem indítható el.", "unavailable", error);
        }
    }

    private boolean hasFineLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean locationServicesEnabled() {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return manager.isLocationEnabled();
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
            || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
}
