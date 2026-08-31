package app.grundo.android;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

public final class TrackingLocationPolicyTest {
    @Test
    public void usesActivitySpecificDistanceFilters() {
        assertEquals(5f, TrackingLocationPolicy.minDistanceMeters("run"), 0f);
        assertEquals(8f, TrackingLocationPolicy.minDistanceMeters("walk"), 0f);
        assertEquals(12f, TrackingLocationPolicy.minDistanceMeters("ride"), 0f);
        assertEquals(5f, TrackingLocationPolicy.minDistanceMeters(null), 0f);
        assertEquals(5f, TrackingLocationPolicy.minDistanceMeters("unknown"), 0f);
    }

    @Test
    public void prunesOnlyTheRowsAboveTheExactCapacity() {
        assertEquals(0, TrackingLocationPolicy.overflowRows(0));
        assertEquals(0, TrackingLocationPolicy.overflowRows(25_000));
        assertEquals(1, TrackingLocationPolicy.overflowRows(25_001));
        assertEquals(250, TrackingLocationPolicy.overflowRows(25_250));
    }
}
