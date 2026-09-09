import Capacitor
import UIKit
import WebKit

/**
 * A bugreport képernyőkép-mellékletének natív forrása.
 *
 * ⚠️ NEM `html2canvas`: az a DOM-ot rajzolná újra, tehát a Mapbox GL vászon
 * ÜRESEN maradna a mentett képen. A `WKWebView.takeSnapshot` azt menti, ami
 * TÉNYLEGESEN a képernyőn van (docs/ai/terv-2026-09-09-bugreport-rendszer.md,
 * 9. pont).
 *
 * A hívó (JS oldal, `src/lib/screenshot.ts`) felelőssége elrejteni a lebegő
 * 🐞 gombot és a menüt HÍVÁS ELŐTT — ez a plugin a teljes webnézetet
 * lefényképezi, tehát a debug-felület is rajta lenne, ha nyitva marad.
 */
@objc(BugReportPlugin)
public class BugReportPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BugReportPlugin"
    public let jsName = "BugReport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "captureScreenshot", returnType: CAPPluginReturnPromise),
    ]

    @objc func captureScreenshot(_ call: CAPPluginCall) {
        guard let webView = bridge?.webView else {
            call.reject("A webnézet nem elérhető.")
            return
        }

        DispatchQueue.main.async {
            let config = WKSnapshotConfiguration()
            webView.takeSnapshot(with: config) { image, error in
                if let error = error {
                    call.reject("A képernyőkép nem készült el.", nil, error)
                    return
                }
                guard let image = image, let data = image.pngData() else {
                    call.reject("A képernyőkép nem készült el.")
                    return
                }
                call.resolve(["base64": data.base64EncodedString()])
            }
        }
    }
}
