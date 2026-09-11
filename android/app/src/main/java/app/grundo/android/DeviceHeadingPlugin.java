package app.grundo.android;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.view.Surface;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Device orientation for the map marker without using WebView geolocation. */
@CapacitorPlugin(name = "DeviceHeading")
public class DeviceHeadingPlugin extends Plugin implements SensorEventListener {
    private static final float MIN_CHANGE_DEGREES = 3f;

    private SensorManager sensorManager;
    private Sensor rotationSensor;
    private float lastHeading = Float.NaN;
    private boolean running;

    @Override
    public void load() {
        sensorManager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) {
            rotationSensor = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR);
        }
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (sensorManager == null || rotationSensor == null) {
            call.reject("Az irányérzékelő ezen a készüléken nem érhető el.", "unavailable");
            return;
        }
        lastHeading = Float.NaN;
        running = true;
        boolean registered = startSensor();
        if (!registered) {
            running = false;
            call.reject("Az irányérzékelő nem indítható el.", "unavailable");
            return;
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        running = false;
        stopSensor();
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        running = false;
        stopSensor();
    }

    @Override
    protected void handleOnPause() {
        stopSensor();
    }

    @Override
    protected void handleOnResume() {
        if (running) startSensor();
    }

    @Override
    public void onSensorChanged(SensorEvent event) {
        if (event.sensor.getType() != Sensor.TYPE_ROTATION_VECTOR) return;

        float[] rotationMatrix = new float[9];
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values);
        float[] displayMatrix = remapForDisplay(rotationMatrix);
        float[] orientation = new float[3];
        SensorManager.getOrientation(displayMatrix, orientation);
        float degrees = normalizeDegrees((float) Math.toDegrees(orientation[0]));

        if (!Float.isNaN(lastHeading)
            && angularDistance(lastHeading, degrees) < MIN_CHANGE_DEGREES) {
            return;
        }

        lastHeading = degrees;
        long now = System.currentTimeMillis();
        JSObject data = new JSObject();
        data.put("degrees", degrees);
        data.put("accuracy", accuracyName(event.accuracy));
        data.put("source", "magnetic");
        data.put("at", now);
        notifyListeners("heading", data);
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {
        // Accuracy is included with the next heading sample.
    }

    private void stopSensor() {
        if (sensorManager != null) sensorManager.unregisterListener(this);
    }

    private boolean startSensor() {
        return sensorManager != null
            && rotationSensor != null
            && sensorManager.registerListener(this, rotationSensor, SensorManager.SENSOR_DELAY_UI);
    }

    private float[] remapForDisplay(float[] rotationMatrix) {
        int rotation = displayRotation();
        if (rotation == Surface.ROTATION_0) return rotationMatrix;

        int xAxis;
        int yAxis;
        switch (rotation) {
            case Surface.ROTATION_90:
                xAxis = SensorManager.AXIS_Y;
                yAxis = SensorManager.AXIS_MINUS_X;
                break;
            case Surface.ROTATION_180:
                xAxis = SensorManager.AXIS_MINUS_X;
                yAxis = SensorManager.AXIS_MINUS_Y;
                break;
            case Surface.ROTATION_270:
                xAxis = SensorManager.AXIS_MINUS_Y;
                yAxis = SensorManager.AXIS_X;
                break;
            default:
                return rotationMatrix;
        }
        float[] remapped = new float[9];
        return SensorManager.remapCoordinateSystem(rotationMatrix, xAxis, yAxis, remapped)
            ? remapped
            : rotationMatrix;
    }

    @SuppressWarnings("deprecation")
    private int displayRotation() {
        WindowManager manager = (WindowManager) getContext().getSystemService(Context.WINDOW_SERVICE);
        return manager == null ? Surface.ROTATION_0 : manager.getDefaultDisplay().getRotation();
    }

    private static float normalizeDegrees(float degrees) {
        return (degrees % 360f + 360f) % 360f;
    }

    private static float angularDistance(float from, float to) {
        float difference = Math.abs(from - to) % 360f;
        return Math.min(difference, 360f - difference);
    }

    private static String accuracyName(int accuracy) {
        switch (accuracy) {
            case SensorManager.SENSOR_STATUS_ACCURACY_HIGH:
                return "high";
            case SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM:
                return "medium";
            case SensorManager.SENSOR_STATUS_ACCURACY_LOW:
                return "low";
            default:
                return "unreliable";
        }
    }
}
