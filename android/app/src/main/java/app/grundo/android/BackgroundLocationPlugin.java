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
        ),
        @Permission(
            alias = BackgroundLocationPlugin.NOTIFICATION_PERMISSION,
            strings = { Manifest.permission.POST_NOTIFICATIONS }
        )
    }
)
public final class BackgroundLocationPlugin extends Plugin {
    static final String LOCATION_PERMISSION = "location";
    static final String NOTIFICATION_PERMISSION = "notifications";

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
        continueAfterLocationPermission(call);
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
        continueAfterLocationPermission(call);
    }

    @PermissionCallback
    private void notificationPermissionCallback(PluginCall call) {
        // The foreground service may still start after denial, but Android 13+
        // then shows it only in the system task manager instead of the notification drawer.
        startService(call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        TrackingLocationService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void syncActivity(PluginCall call) {
        TrackingLocationService.sync(
            getContext(),
            call.getString("status", "recording"),
            readMillis(call, "startedAt", System.currentTimeMillis()),
            readDouble(call, "distanceM", 0d),
            readMillis(call, "pausedMs", 0L),
            readNullableMillis(call, "pausedAt")
        );
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
        long now = System.currentTimeMillis();
        try {
            TrackingLocationService.start(
                getContext(),
                call.getString("activityType", "run"),
                status,
                readMillis(activityState, "startedAt", now),
                readDouble(activityState, "distanceM", 0d),
                readMillis(activityState, "pausedMs", 0L),
                readNullableMillis(activityState, "pausedAt"),
                call.getBoolean("liveActivityEnabled", true)
            );
            JSObject result = new JSObject();
            result.put("permission", "granted");
            result.put("backgroundPermission", "granted");
            result.put("notificationPermission", hasNotificationPermission() ? "granted" : "not_granted");
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Az Android nem engedte elindítani a helyalapú háttérszolgáltatást.", "permission_denied", error);
        } catch (RuntimeException error) {
            call.reject("A helyalapú háttérszolgáltatás nem indítható el.", "unavailable", error);
        }
    }

    private void continueAfterLocationPermission(PluginCall call) {
        boolean showLiveStats = call.getBoolean("liveActivityEnabled", true);
        if (showLiveStats && Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && !hasNotificationPermission()) {
            requestPermissionForAlias(NOTIFICATION_PERMISSION, call, "notificationPermissionCallback");
            return;
        }
        startService(call);
    }

    private boolean hasFineLocationPermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private static long readMillis(PluginCall call, String key, long fallback) {
        Double value = call.getDouble(key);
        return finiteMillis(value, fallback);
    }

    private static double readDouble(PluginCall call, String key, double fallback) {
        Double value = call.getDouble(key);
        return value != null && Double.isFinite(value) ? value : fallback;
    }

    private static Long readNullableMillis(PluginCall call, String key) {
        if (!call.getData().has(key) || call.getData().isNull(key)) return null;
        Double value = call.getDouble(key);
        return value != null && Double.isFinite(value) ? Math.round(value) : null;
    }

    private static long readMillis(JSObject object, String key, long fallback) {
        if (object == null || !object.has(key) || object.isNull(key)) return fallback;
        return finiteMillis(object.optDouble(key, Double.NaN), fallback);
    }

    private static double readDouble(JSObject object, String key, double fallback) {
        if (object == null || !object.has(key) || object.isNull(key)) return fallback;
        double value = object.optDouble(key, Double.NaN);
        return Double.isFinite(value) ? value : fallback;
    }

    private static Long readNullableMillis(JSObject object, String key) {
        if (object == null || !object.has(key) || object.isNull(key)) return null;
        double value = object.optDouble(key, Double.NaN);
        return Double.isFinite(value) ? Math.round(value) : null;
    }

    private static long finiteMillis(Double value, long fallback) {
        return value != null && Double.isFinite(value) ? Math.round(value) : fallback;
    }

    private boolean locationServicesEnabled() {
        LocationManager manager = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) return manager.isLocationEnabled();
        return manager.isProviderEnabled(LocationManager.GPS_PROVIDER)
            || manager.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
    }
}
