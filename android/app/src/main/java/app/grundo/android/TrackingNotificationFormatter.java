package app.grundo.android;

import java.util.Locale;

/** Pure formatting and elapsed-time helpers for the tracking notification. */
final class TrackingNotificationFormatter {
    private TrackingNotificationFormatter() {}

    static long elapsedMillis(
        long nowMs,
        long startedAtMs,
        long pausedMs,
        Long pausedAtMs,
        boolean paused
    ) {
        long openPauseMs = paused && pausedAtMs != null
            ? Math.max(0L, nowMs - pausedAtMs)
            : 0L;
        return Math.max(0L, nowMs - startedAtMs - Math.max(0L, pausedMs) - openPauseMs);
    }

    static String distance(double meters) {
        return String.format(Locale.US, "%.2f km", Math.max(0d, meters) / 1_000d);
    }

    static String speed(double metersPerSecond) {
        return String.format(Locale.US, "%.1f km/h", Math.max(0d, metersPerSecond) * 3.6d);
    }
}
