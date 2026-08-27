package app.grundo.android;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;
import com.getcapacitor.JSObject;
import java.util.ArrayList;
import java.util.List;

/** Durable native queue used while the Capacitor WebView is suspended. */
final class TrackingLocationStore extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "grundo_tracking.db";
    private static final int DATABASE_VERSION = 1;
    private static final int MAX_QUEUED_LOCATIONS = 25_000;

    TrackingLocationStore(Context context) {
        super(context.getApplicationContext(), DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE locations (" +
            "id INTEGER PRIMARY KEY AUTOINCREMENT," +
            "t INTEGER NOT NULL UNIQUE," +
            "lat REAL NOT NULL," +
            "lng REAL NOT NULL," +
            "accuracy REAL NOT NULL," +
            "elevation REAL," +
            "speed REAL)"
        );
        db.execSQL("CREATE INDEX locations_time ON locations(t)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        throw new IllegalStateException("Unsupported tracking database upgrade: " + oldVersion + " -> " + newVersion);
    }

    void enqueue(Location location) {
        SQLiteDatabase db = getWritableDatabase();
        ContentValues values = new ContentValues();
        values.put("t", location.getTime());
        values.put("lat", location.getLatitude());
        values.put("lng", location.getLongitude());
        values.put("accuracy", location.hasAccuracy() ? location.getAccuracy() : Float.MAX_VALUE);
        if (location.hasAltitude()) values.put("elevation", location.getAltitude());
        if (location.hasSpeed()) values.put("speed", location.getSpeed());
        db.insertWithOnConflict("locations", null, values, SQLiteDatabase.CONFLICT_IGNORE);
        db.execSQL(
            "DELETE FROM locations WHERE id <= (" +
            "SELECT id FROM locations ORDER BY id DESC LIMIT 1 OFFSET " + MAX_QUEUED_LOCATIONS + ")"
        );
    }

    List<JSObject> drain() {
        SQLiteDatabase db = getWritableDatabase();
        List<JSObject> locations = new ArrayList<>();
        db.beginTransaction();
        try (
            Cursor cursor = db.query(
                "locations",
                new String[] { "lat", "lng", "t", "accuracy", "elevation", "speed" },
                null,
                null,
                null,
                null,
                "t ASC"
            )
        ) {
            int latIndex = cursor.getColumnIndexOrThrow("lat");
            int lngIndex = cursor.getColumnIndexOrThrow("lng");
            int timeIndex = cursor.getColumnIndexOrThrow("t");
            int accuracyIndex = cursor.getColumnIndexOrThrow("accuracy");
            int elevationIndex = cursor.getColumnIndexOrThrow("elevation");
            int speedIndex = cursor.getColumnIndexOrThrow("speed");
            while (cursor.moveToNext()) {
                JSObject location = new JSObject();
                location.put("lat", cursor.getDouble(latIndex));
                location.put("lng", cursor.getDouble(lngIndex));
                location.put("t", cursor.getLong(timeIndex));
                location.put("accuracy", cursor.getDouble(accuracyIndex));
                if (!cursor.isNull(elevationIndex)) location.put("elevation", cursor.getDouble(elevationIndex));
                if (!cursor.isNull(speedIndex)) location.put("speed", cursor.getDouble(speedIndex));
                locations.add(location);
            }
            db.delete("locations", null, null);
            db.setTransactionSuccessful();
        } finally {
            db.endTransaction();
        }
        return locations;
    }
}
