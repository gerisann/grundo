package app.grundo.android;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.SystemClock;
import android.widget.RemoteViews;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/**
 * User-started location foreground service.
 *
 * The service owns GPS collection and the durable SQLite queue, so recording
 * does not depend on the WebView remaining alive while the screen is locked.
 */
public final class TrackingLocationService extends Service {
    static final String EVENT_ACTION = "app.grundo.android.BACKGROUND_LOCATION_EVENT";
    static final String EXTRA_EVENT_TYPE = "eventType";
    static final String EXTRA_ERROR_CODE = "errorCode";
    static final String EXTRA_ERROR_MESSAGE = "errorMessage";
    static final String EXTRA_LAT = "lat";
    static final String EXTRA_LNG = "lng";
    static final String EXTRA_TIME = "t";
    static final String EXTRA_ACCURACY = "accuracy";
    static final String EXTRA_ELEVATION = "elevation";
    static final String EXTRA_SPEED = "speed";
    static final String EXTRA_HAS_ELEVATION = "hasElevation";
    static final String EXTRA_HAS_SPEED = "hasSpeed";

    private static final String ACTION_START = "app.grundo.android.action.START_TRACKING";
    private static final String PREFS_NAME = "grundo.backgroundLocation.v1";
    private static final String PREF_ACTIVE = "active";
    private static final String PREF_ACTIVITY_TYPE = "activityType";
    private static final String PREF_STATUS = "status";
    private static final String PREF_STARTED_AT = "startedAt";
    private static final String PREF_DISTANCE_BITS = "distanceBits";
    private static final String PREF_PAUSED_MS = "pausedMs";
    private static final String PREF_PAUSED_AT = "pausedAt";
    private static final String PREF_SPEED_BITS = "speedBits";
    private static final String PREF_LIVE_DETAILS = "liveDetails";
    private static final String CHANNEL_ID = "grundo_tracking_live_v2";
    private static final int NOTIFICATION_ID = 7301;
    private static final long LOCATION_INTERVAL_MS = 1_000L;
    private static final float MAX_NOTIFICATION_ACCURACY_M = 50f;
    private static final double MAX_NOTIFICATION_SPEED_MPS = 40d;
    private static final long MAX_NOTIFICATION_IDLE_MS = 30_000L;

    private static volatile TrackingLocationService instance;

    private FusedLocationProviderClient locationClient;
    private TrackingLocationStore store;
    private HandlerThread locationThread;
    private Handler locationHandler;
    private boolean requestingLocations;
    private boolean foregroundStarted;
    private long startedAtMs;
    private double distanceM;
    private long pausedMs;
    @Nullable private Long pausedAtMs;
    private boolean paused;
    private double speedMps;
    private float minDistanceM = TrackingLocationPolicy.minDistanceMeters("run");
    @Nullable private Location lastNotificationLocation;

    private final LocationCallback locationCallback = new LocationCallback() {
        @Override
        public void onLocationResult(LocationResult result) {
            for (Location location : result.getLocations()) {
                if (!location.hasAccuracy() || location.getAccuracy() < 0) continue;
                store.enqueue(location);
                recordNotificationLocation(location);
                broadcastLocation(location);
            }
        }
    };

    static void start(
        Context context,
        String activityType,
        String status,
        long startedAtMs,
        double distanceM,
        long pausedMs,
        @Nullable Long pausedAtMs,
        boolean liveDetails
    ) {
        SharedPreferences prefs = preferences(context);
        SharedPreferences.Editor editor = prefs.edit()
            .putBoolean(PREF_ACTIVE, true)
            .putString(PREF_ACTIVITY_TYPE, normalizeActivityType(activityType))
            .putString(PREF_STATUS, normalizeStatus(status))
            .putLong(PREF_STARTED_AT, startedAtMs)
            .putLong(PREF_DISTANCE_BITS, Double.doubleToRawLongBits(Math.max(0d, distanceM)))
            .putLong(PREF_PAUSED_MS, Math.max(0L, pausedMs))
            .putLong(PREF_SPEED_BITS, Double.doubleToRawLongBits(0d))
            .putBoolean(PREF_LIVE_DETAILS, liveDetails);
        putNullableLong(editor, PREF_PAUSED_AT, pausedAtMs);
        editor.apply();
        Intent intent = new Intent(context, TrackingLocationService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(context, intent);
    }

    static void sync(
        Context context,
        String status,
        long startedAtMs,
        double distanceM,
        long pausedMs,
        @Nullable Long pausedAtMs
    ) {
        if (!isActive(context)) return;
        SharedPreferences.Editor editor = preferences(context).edit()
            .putString(PREF_STATUS, normalizeStatus(status))
            .putLong(PREF_STARTED_AT, startedAtMs)
            .putLong(PREF_DISTANCE_BITS, Double.doubleToRawLongBits(Math.max(0d, distanceM)))
            .putLong(PREF_PAUSED_MS, Math.max(0L, pausedMs));
        putNullableLong(editor, PREF_PAUSED_AT, pausedAtMs);
        editor.apply();
        TrackingLocationService running = instance;
        if (running != null && running.locationHandler != null) {
            running.locationHandler.post(running::applyPersistedState);
        }
    }

    static void stop(Context context) {
        preferences(context).edit().putBoolean(PREF_ACTIVE, false).apply();
        context.stopService(new Intent(context, TrackingLocationService.class));
    }

    static boolean isActive(Context context) {
        return preferences(context).getBoolean(PREF_ACTIVE, false);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        locationClient = LocationServices.getFusedLocationProviderClient(this);
        store = new TrackingLocationStore(this);
        locationThread = new HandlerThread("grundo-location");
        locationThread.start();
        locationHandler = new Handler(locationThread.getLooper());
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (!isActive(this)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        applyPersistedState();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopLocationUpdates();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        locationHandler.post(store::close);
        locationThread.quitSafely();
        instance = null;
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void applyPersistedState() {
        if (!hasFineLocationPermission()) {
            failAndStop("permission_denied", "A pontos helyhozzáférés megszűnt; a rögzítés leállt.");
            return;
        }
        SharedPreferences prefs = preferences(this);
        startedAtMs = prefs.getLong(PREF_STARTED_AT, System.currentTimeMillis());
        distanceM = readDouble(prefs, PREF_DISTANCE_BITS, 0d);
        pausedMs = prefs.getLong(PREF_PAUSED_MS, 0L);
        pausedAtMs = prefs.contains(PREF_PAUSED_AT) ? prefs.getLong(PREF_PAUSED_AT, 0L) : null;
        paused = "paused".equals(prefs.getString(PREF_STATUS, "recording"));
        speedMps = paused ? 0d : readDouble(prefs, PREF_SPEED_BITS, 0d);
        float previousMinDistanceM = minDistanceM;
        minDistanceM = TrackingLocationPolicy.minDistanceMeters(prefs.getString(PREF_ACTIVITY_TYPE, "run"));
        updateForegroundNotification();
        if (paused) {
            lastNotificationLocation = null;
            stopLocationUpdates();
        } else {
            if (requestingLocations && previousMinDistanceM != minDistanceM) stopLocationUpdates();
            startLocationUpdates();
        }
    }

    private void updateForegroundNotification() {
        Notification notification = buildNotification();
        if (foregroundStarted) {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, notification);
            return;
        }
        int foregroundType = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
            : 0;
        ServiceCompat.startForeground(
            this,
            NOTIFICATION_ID,
            notification,
            foregroundType
        );
        foregroundStarted = true;
    }

    private Notification buildNotification() {
        SharedPreferences prefs = preferences(this);
        String status = prefs.getString(PREF_STATUS, "recording");
        String activityType = prefs.getString(PREF_ACTIVITY_TYPE, "run");
        int textResource;
        if ("paused".equals(status)) textResource = R.string.tracking_notification_paused;
        else if ("walk".equals(activityType)) textResource = R.string.tracking_notification_walk;
        else if ("ride".equals(activityType)) textResource = R.string.tracking_notification_ride;
        else textResource = R.string.tracking_notification_run;

        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tracking)
            .setContentTitle(getString(R.string.tracking_notification_title))
            .setContentText(getString(textResource))
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setShowWhen(false)
            .setSilent(true);

        if (prefs.getBoolean(PREF_LIVE_DETAILS, true)) {
            RemoteViews compact = trackingRemoteViews(R.layout.notification_tracking_compact);
            RemoteViews expanded = trackingRemoteViews(R.layout.notification_tracking_expanded);
            builder
                .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
                .setCustomContentView(compact)
                .setCustomBigContentView(expanded);
        }
        return builder.build();
    }

    private RemoteViews trackingRemoteViews(int layoutId) {
        long elapsedMs = TrackingNotificationFormatter.elapsedMillis(
            System.currentTimeMillis(),
            startedAtMs,
            pausedMs,
            pausedAtMs,
            paused
        );
        long chronometerBase = SystemClock.elapsedRealtime() - elapsedMs;
        String distance = TrackingNotificationFormatter.distance(distanceM);
        String speed = TrackingNotificationFormatter.speed(paused ? 0d : speedMps);
        RemoteViews views = new RemoteViews(getPackageName(), layoutId);

        if (layoutId == R.layout.notification_tracking_compact) {
            views.setTextViewText(R.id.tracking_compact_distance, distance);
            views.setChronometer(R.id.tracking_compact_elapsed, chronometerBase, null, !paused);
            views.setTextViewText(R.id.tracking_compact_speed, speed);
            return views;
        }

        views.setTextViewText(R.id.tracking_activity_label, getString(activityTextResource()));
        views.setTextViewText(
            R.id.tracking_status,
            getString(paused ? R.string.tracking_status_paused : R.string.tracking_status_live)
        );
        views.setTextViewText(R.id.tracking_distance, distance);
        views.setChronometer(R.id.tracking_elapsed, chronometerBase, null, !paused);
        views.setTextViewText(R.id.tracking_speed, speed);
        return views;
    }

    private int activityTextResource() {
        if (paused) return R.string.tracking_notification_paused;
        String activityType = preferences(this).getString(PREF_ACTIVITY_TYPE, "run");
        if ("walk".equals(activityType)) return R.string.tracking_notification_walk;
        if ("ride".equals(activityType)) return R.string.tracking_notification_ride;
        return R.string.tracking_notification_run;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.tracking_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setDescription(getString(R.string.tracking_notification_title));
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void startLocationUpdates() {
        if (requestingLocations) return;
        LocationRequest request = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, LOCATION_INTERVAL_MS)
            .setMinUpdateIntervalMillis(LOCATION_INTERVAL_MS)
            .setMinUpdateDistanceMeters(minDistanceM)
            .setWaitForAccurateLocation(false)
            .build();
        try {
            locationClient.requestLocationUpdates(request, locationCallback, locationThread.getLooper());
            requestingLocations = true;
        } catch (SecurityException error) {
            failAndStop("permission_denied", "A pontos helyhozzáférés megszűnt; a rögzítés leállt.");
        } catch (RuntimeException error) {
            failAndStop("unavailable", "Az Android helyszolgáltatása nem indítható el.");
        }
    }

    private void stopLocationUpdates() {
        if (!requestingLocations || locationClient == null) return;
        locationClient.removeLocationUpdates(locationCallback);
        requestingLocations = false;
    }

    private void recordNotificationLocation(Location location) {
        Location previous = lastNotificationLocation;
        lastNotificationLocation = location;
        if (paused || location.getAccuracy() > MAX_NOTIFICATION_ACCURACY_M || previous == null) return;

        long deltaMs = location.getTime() - previous.getTime();
        if (deltaMs <= 0L) return;
        double meters = location.distanceTo(previous);
        double calculatedSpeed = meters / (deltaMs / 1_000d);
        if (calculatedSpeed > MAX_NOTIFICATION_SPEED_MPS) return;
        if (meters < minDistanceM && deltaMs < MAX_NOTIFICATION_IDLE_MS) return;

        distanceM += meters;
        speedMps = location.hasSpeed() && location.getSpeed() >= 0f
            ? location.getSpeed()
            : calculatedSpeed;
        preferences(this).edit()
            .putLong(PREF_DISTANCE_BITS, Double.doubleToRawLongBits(distanceM))
            .putLong(PREF_SPEED_BITS, Double.doubleToRawLongBits(speedMps))
            .apply();
        if (foregroundStarted && preferences(this).getBoolean(PREF_LIVE_DETAILS, true)) {
            getSystemService(NotificationManager.class).notify(NOTIFICATION_ID, buildNotification());
        }
    }

    private boolean hasFineLocationPermission() {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void broadcastLocation(Location location) {
        Intent event = new Intent(EVENT_ACTION)
            .setPackage(getPackageName())
            .putExtra(EXTRA_EVENT_TYPE, "location")
            .putExtra(EXTRA_LAT, location.getLatitude())
            .putExtra(EXTRA_LNG, location.getLongitude())
            .putExtra(EXTRA_TIME, location.getTime())
            .putExtra(EXTRA_ACCURACY, location.getAccuracy())
            .putExtra(EXTRA_HAS_ELEVATION, location.hasAltitude())
            .putExtra(EXTRA_HAS_SPEED, location.hasSpeed());
        if (location.hasAltitude()) event.putExtra(EXTRA_ELEVATION, location.getAltitude());
        if (location.hasSpeed()) event.putExtra(EXTRA_SPEED, location.getSpeed());
        sendBroadcast(event);
    }

    private void failAndStop(String code, String message) {
        Intent event = new Intent(EVENT_ACTION)
            .setPackage(getPackageName())
            .putExtra(EXTRA_EVENT_TYPE, "error")
            .putExtra(EXTRA_ERROR_CODE, code)
            .putExtra(EXTRA_ERROR_MESSAGE, message);
        sendBroadcast(event);
        preferences(this).edit().putBoolean(PREF_ACTIVE, false).apply();
        stopLocationUpdates();
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static void putNullableLong(SharedPreferences.Editor editor, String key, @Nullable Long value) {
        if (value == null) editor.remove(key);
        else editor.putLong(key, value);
    }

    private static double readDouble(SharedPreferences prefs, String key, double fallback) {
        if (!prefs.contains(key)) return fallback;
        return Double.longBitsToDouble(prefs.getLong(key, Double.doubleToRawLongBits(fallback)));
    }

    private static String normalizeActivityType(@Nullable String value) {
        return "walk".equals(value) || "ride".equals(value) ? value : "run";
    }

    private static String normalizeStatus(@Nullable String value) {
        return "paused".equals(value) ? "paused" : "recording";
    }
}
