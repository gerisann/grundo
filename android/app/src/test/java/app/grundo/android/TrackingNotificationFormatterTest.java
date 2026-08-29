package app.grundo.android;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class TrackingNotificationFormatterTest {
    @Test
    public void elapsedMillisSubtractsClosedAndOpenPauses() {
        assertEquals(
            50_000L,
            TrackingNotificationFormatter.elapsedMillis(
                200_000L,
                100_000L,
                25_000L,
                175_000L,
                true
            )
        );
    }

    @Test
    public void elapsedMillisDoesNotSubtractPausedAtWhileRecording() {
        assertEquals(
            75_000L,
            TrackingNotificationFormatter.elapsedMillis(
                200_000L,
                100_000L,
                25_000L,
                175_000L,
                false
            )
        );
    }

    @Test
    public void formatsMetricsLikeTheIosLiveActivity() {
        assertEquals("0.02 km", TrackingNotificationFormatter.distance(20d));
        assertEquals("11.2 km/h", TrackingNotificationFormatter.speed(11.2d / 3.6d));
    }
}
