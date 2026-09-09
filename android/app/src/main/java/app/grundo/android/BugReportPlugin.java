package app.grundo.android;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Rect;
import android.media.projection.MediaProjectionManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.WebView;
import android.view.PixelCopy;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.ByteArrayOutputStream;

/**
 * Native source for the bugreport screenshot attachment.
 *
 * NOT html2canvas: that would redraw the DOM, and the Mapbox GL canvas would
 * stay empty in the saved image. PixelCopy captures what is ACTUALLY on
 * screen (docs/ai/terv-2026-09-09-bugreport-rendszer.md, point 9).
 *
 * The caller (src/lib/screenshot.ts) is responsible for hiding the floating
 * bug button and the menu BEFORE calling this — the whole WebView is
 * captured, so the debug UI would be in the image if left open.
 */
@CapacitorPlugin(name = "BugReport")
public class BugReportPlugin extends Plugin {

    @PluginMethod
    public void captureScreenshot(PluginCall call) {
        WebView webView = getBridge().getWebView();
        if (webView == null || getActivity() == null) {
            call.reject("A webnézet nem elérhető.");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            call.reject("A képernyőkép ehhez az Android-verzióhoz nem támogatott.");
            return;
        }

        int width = webView.getWidth();
        int height = webView.getHeight();
        if (width <= 0 || height <= 0) {
            call.reject("A webnézet mérete ismeretlen.");
            return;
        }

        int[] location = new int[2];
        webView.getLocationInWindow(location);
        Rect area = new Rect(location[0], location[1], location[0] + width, location[1] + height);

        Bitmap bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        PixelCopy.request(
            getActivity().getWindow(),
            area,
            bitmap,
            copyResult -> {
                if (copyResult != PixelCopy.SUCCESS) {
                    call.reject("A képernyőkép nem készült el (kód: " + copyResult + ").");
                    return;
                }
                ByteArrayOutputStream stream = new ByteArrayOutputStream();
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream);
                bitmap.recycle();
                JSObject result = new JSObject();
                result.put("base64", Base64.encodeToString(stream.toByteArray(), Base64.NO_WRAP));
                call.resolve(result);
            },
            new Handler(Looper.getMainLooper())
        );
    }

    @PluginMethod
    public void startVideoRecording(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("A képernyőrögzítés nem indítható el.");
            return;
        }
        MediaProjectionManager manager = (MediaProjectionManager) activity.getSystemService(
            Context.MEDIA_PROJECTION_SERVICE
        );
        startActivityForResult(call, manager.createScreenCaptureIntent(), "videoPermissionResult");
    }

    @ActivityCallback
    private void videoPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null) {
            call.reject("A képernyőrögzítést nem engedélyezted.");
            return;
        }
        MediaProjectionRecordingService.start(
            getContext(),
            result.getResultCode(),
            data,
            new MediaProjectionRecordingService.StartCallback() {
                @Override
                public void onStarted() {
                    call.resolve();
                }

                @Override
                public void onError(String message) {
                    call.reject(message);
                }
            }
        );
    }

    @PluginMethod
    public void stopVideoRecording(PluginCall call) {
        MediaProjectionRecordingService.stop(new MediaProjectionRecordingService.StopCallback() {
            @Override
            public void onStopped(String uri, long durationMs) {
                JSObject result = new JSObject();
                result.put("uri", uri);
                result.put("durationMs", durationMs);
                call.resolve(result);
            }

            @Override
            public void onError(String message) {
                call.reject(message);
            }
        });
    }

    @PluginMethod
    public void deleteVideoRecording(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || !MediaProjectionRecordingService.deleteCompleted(uri)) {
            call.reject("A videófájl nem található.");
            return;
        }
        call.resolve();
    }
}
