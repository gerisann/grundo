package app.grundo.android;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Point;
import android.hardware.display.DisplayManager;
import android.hardware.display.VirtualDisplay;
import android.media.MediaRecorder;
import android.media.projection.MediaProjection;
import android.media.projection.MediaProjectionManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import android.util.DisplayMetrics;
import android.view.WindowManager;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.File;
import java.io.IOException;

/** Owns the user-approved MediaProjection session and its temporary MP4. */
public final class MediaProjectionRecordingService extends Service {
    interface StartCallback {
        void onStarted();
        void onError(String message);
    }

    interface StopCallback {
        void onStopped(String uri, long durationMs);
        void onError(String message);
    }

    private static final String ACTION_START = "app.grundo.android.action.START_BUGREPORT_VIDEO";
    private static final String EXTRA_RESULT_CODE = "resultCode";
    private static final String EXTRA_RESULT_DATA = "resultData";
    private static final String CHANNEL_ID = "grundo_bugreport_video_v1";
    private static final int NOTIFICATION_ID = 7302;
    private static final long MAX_DURATION_MS = 30_000L;
    private static final int MAX_EDGE_PX = 1280;
    private static final int VIDEO_BITRATE = 4_000_000;
    private static final Object LOCK = new Object();

    @Nullable private static MediaProjectionRecordingService instance;
    @Nullable private static StartCallback pendingStart;
    @Nullable private static CompletedVideo completedVideo;

    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    @Nullable private MediaProjection projection;
    @Nullable private MediaRecorder recorder;
    @Nullable private VirtualDisplay virtualDisplay;
    @Nullable private File outputFile;
    private long startedAtElapsedMs;
    private boolean stopping;

    static void start(
        Context context,
        int resultCode,
        Intent resultData,
        StartCallback callback
    ) {
        synchronized (LOCK) {
            if (pendingStart != null || (instance != null && instance.recorder != null)) {
                callback.onError("Már folyamatban van egy videórögzítés.");
                return;
            }
            removeCompletedLocked();
            pendingStart = callback;
        }
        Intent intent = new Intent(context, MediaProjectionRecordingService.class)
            .setAction(ACTION_START)
            .putExtra(EXTRA_RESULT_CODE, resultCode)
            .putExtra(EXTRA_RESULT_DATA, resultData);
        try {
            ContextCompat.startForegroundService(context, intent);
        } catch (RuntimeException error) {
            failPendingStart("A képernyőrögzítés szolgáltatása nem indítható el.");
        }
    }

    static void stop(StopCallback callback) {
        MediaProjectionRecordingService running;
        synchronized (LOCK) {
            if (completedVideo != null) {
                callback.onStopped(completedVideo.uri, completedVideo.durationMs);
                return;
            }
            running = instance;
        }
        if (running == null || running.recorder == null) {
            callback.onError("Nincs folyamatban videórögzítés.");
            return;
        }
        running.mainHandler.post(() -> running.finishRecording(callback));
    }

    static boolean deleteCompleted(String uri) {
        synchronized (LOCK) {
            if (completedVideo == null || !completedVideo.uri.equals(uri)) return false;
            removeCompletedLocked();
            return true;
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        synchronized (LOCK) {
            instance = this;
        }
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent == null || !ACTION_START.equals(intent.getAction())) {
            failStartAndStop("A képernyőrögzítés indítási adatai hiányoznak.");
            return START_NOT_STICKY;
        }

        try {
            // Android 14+ requires the typed foreground service to be active
            // before getMediaProjection() consumes the one-shot grant.
            startForegroundForProjection();
            int resultCode = intent.getIntExtra(EXTRA_RESULT_CODE, 0);
            Intent resultData = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                ? intent.getParcelableExtra(EXTRA_RESULT_DATA, Intent.class)
                : intent.getParcelableExtra(EXTRA_RESULT_DATA);
            if (resultData == null) {
                throw new IllegalStateException("MediaProjection grant missing");
            }
            startCapture(resultCode, resultData);
            resolvePendingStart();
        } catch (IOException | RuntimeException error) {
            failStartAndStop("A videórögzítés nem indult el.");
        }
        return START_NOT_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        mainHandler.removeCallbacksAndMessages(null);
        releaseCaptureResources();
        synchronized (LOCK) {
            if (instance == this) instance = null;
        }
        super.onDestroy();
    }

    private void startForegroundForProjection() {
        Intent launchIntent = new Intent(this, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_tracking)
            .setContentTitle(getString(R.string.video_notification_title))
            .setContentText(getString(R.string.video_notification_text))
            .setContentIntent(contentIntent)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .build();
        int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            : 0;
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, type);
    }

    private void startCapture(int resultCode, Intent resultData) throws IOException {
        MediaProjectionManager manager = (MediaProjectionManager) getSystemService(
            Context.MEDIA_PROJECTION_SERVICE
        );
        projection = manager.getMediaProjection(resultCode, resultData);
        if (projection == null) throw new IllegalStateException("MediaProjection unavailable");
        projection.registerCallback(new MediaProjection.Callback() {
            @Override
            public void onStop() {
                mainHandler.post(() -> finishRecording(null));
            }
        }, mainHandler);

        DisplayMetrics metrics = getResources().getDisplayMetrics();
        Point size = displaySize();
        int[] scaled = scaledEvenSize(size.x, size.y);
        outputFile = new File(getCacheDir(), "grundo-bugreport-" + System.currentTimeMillis() + ".mp4");
        recorder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
            ? new MediaRecorder(this)
            : new MediaRecorder();
        recorder.setVideoSource(MediaRecorder.VideoSource.SURFACE);
        recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
        recorder.setVideoEncoder(MediaRecorder.VideoEncoder.H264);
        recorder.setVideoSize(scaled[0], scaled[1]);
        recorder.setVideoFrameRate(30);
        recorder.setVideoEncodingBitRate(VIDEO_BITRATE);
        recorder.setOutputFile(outputFile.getAbsolutePath());
        recorder.prepare();

        virtualDisplay = projection.createVirtualDisplay(
            "GRUNDO bugreport",
            scaled[0],
            scaled[1],
            metrics.densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            recorder.getSurface(),
            null,
            mainHandler
        );
        recorder.start();
        startedAtElapsedMs = SystemClock.elapsedRealtime();
        mainHandler.postDelayed(() -> finishRecording(null), MAX_DURATION_MS);
    }

    private Point displaySize() {
        WindowManager manager = getSystemService(WindowManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            android.graphics.Rect bounds = manager.getMaximumWindowMetrics().getBounds();
            return new Point(bounds.width(), bounds.height());
        }
        Point size = new Point();
        manager.getDefaultDisplay().getRealSize(size);
        return size;
    }

    private static int[] scaledEvenSize(int width, int height) {
        double scale = Math.min(1d, MAX_EDGE_PX / (double) Math.max(width, height));
        int scaledWidth = Math.max(2, ((int) Math.round(width * scale)) & ~1);
        int scaledHeight = Math.max(2, ((int) Math.round(height * scale)) & ~1);
        return new int[] { scaledWidth, scaledHeight };
    }

    private void finishRecording(@Nullable StopCallback callback) {
        if (stopping) return;
        if (recorder == null || outputFile == null) {
            if (callback != null) callback.onError("Nincs folyamatban videórögzítés.");
            return;
        }
        stopping = true;
        mainHandler.removeCallbacksAndMessages(null);
        File finishedFile = outputFile;
        long durationMs = Math.min(
            MAX_DURATION_MS,
            Math.max(0L, SystemClock.elapsedRealtime() - startedAtElapsedMs)
        );
        try {
            recorder.stop();
            String uri = Uri.fromFile(finishedFile).toString();
            synchronized (LOCK) {
                completedVideo = new CompletedVideo(uri, durationMs, finishedFile);
            }
            if (callback != null) callback.onStopped(uri, durationMs);
        } catch (RuntimeException error) {
            finishedFile.delete();
            if (callback != null) callback.onError("A videó nem készült el.");
        } finally {
            releaseCaptureResources();
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private void releaseCaptureResources() {
        if (virtualDisplay != null) virtualDisplay.release();
        virtualDisplay = null;
        if (recorder != null) recorder.release();
        recorder = null;
        if (projection != null) projection.stop();
        projection = null;
        outputFile = null;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            getString(R.string.video_channel_name),
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setSound(null, null);
        channel.enableVibration(false);
        channel.setShowBadge(false);
        getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private void failStartAndStop(String message) {
        if (outputFile != null) outputFile.delete();
        failPendingStart(message);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private static void resolvePendingStart() {
        StartCallback callback;
        synchronized (LOCK) {
            callback = pendingStart;
            pendingStart = null;
        }
        if (callback != null) callback.onStarted();
    }

    private static void failPendingStart(String message) {
        StartCallback callback;
        synchronized (LOCK) {
            callback = pendingStart;
            pendingStart = null;
        }
        if (callback != null) callback.onError(message);
    }

    private static void removeCompletedLocked() {
        if (completedVideo != null) completedVideo.file.delete();
        completedVideo = null;
    }

    private static final class CompletedVideo {
        final String uri;
        final long durationMs;
        final File file;

        CompletedVideo(String uri, long durationMs, File file) {
            this.uri = uri;
            this.durationMs = durationMs;
            this.file = file;
        }
    }
}
