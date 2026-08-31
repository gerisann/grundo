package app.grundo.android;

import androidx.annotation.Nullable;

/** Shared limits for long-running native Android tracking. */
final class TrackingLocationPolicy {
    static final int MAX_QUEUED_LOCATIONS = 25_000;

    private static final float RUN_MIN_DISTANCE_M = 5f;
    private static final float WALK_MIN_DISTANCE_M = 8f;
    private static final float RIDE_MIN_DISTANCE_M = 12f;

    private TrackingLocationPolicy() {}

    static float minDistanceMeters(@Nullable String activityType) {
        if ("walk".equals(activityType)) return WALK_MIN_DISTANCE_M;
        if ("ride".equals(activityType)) return RIDE_MIN_DISTANCE_M;
        return RUN_MIN_DISTANCE_M;
    }

    static int overflowRows(long queuedCount) {
        long overflow = Math.max(0L, queuedCount - MAX_QUEUED_LOCATIONS);
        return (int) Math.min(Integer.MAX_VALUE, overflow);
    }
}
