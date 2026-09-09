import Capacitor
import ReplayKit
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
    private static let maxVideoDuration: TimeInterval = 30

    public let identifier = "BugReportPlugin"
    public let jsName = "BugReport"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "captureScreenshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "startVideoRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stopVideoRecording", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "deleteVideoRecording", returnType: CAPPluginReturnPromise),
    ]

    private var videoStartedAt: Date?
    private var videoOutputURL: URL?
    private var completedVideo: (url: URL, durationMs: Int)?
    private var stopCalls: [CAPPluginCall] = []
    private var stopTimer: Timer?
    private var stoppingVideo = false

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

    @objc func startVideoRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let recorder = RPScreenRecorder.shared()
            guard recorder.isAvailable else {
                call.reject("A képernyőrögzítés ezen az eszközön nem érhető el.")
                return
            }
            guard !recorder.isRecording, self.videoStartedAt == nil else {
                call.reject("Már folyamatban van egy videórögzítés.")
                return
            }

            self.removeCompletedVideo()
            let outputURL = FileManager.default.temporaryDirectory
                .appendingPathComponent("grundo-bugreport-\(UUID().uuidString).mp4")
            try? FileManager.default.removeItem(at: outputURL)
            recorder.isMicrophoneEnabled = false
            recorder.startRecording { error in
                DispatchQueue.main.async {
                    if let error = error {
                        call.reject("A videórögzítés nem indult el.", nil, error)
                        return
                    }
                    self.videoStartedAt = Date()
                    self.videoOutputURL = outputURL
                    self.stopTimer = Timer.scheduledTimer(
                        withTimeInterval: Self.maxVideoDuration,
                        repeats: false
                    ) { [weak self] _ in
                        self?.finishVideoRecording()
                    }
                    call.resolve()
                }
            }
        }
    }

    @objc func stopVideoRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let completed = self.completedVideo {
                call.resolve(self.videoResult(completed))
                return
            }
            guard self.videoStartedAt != nil, self.videoOutputURL != nil else {
                call.reject("Nincs folyamatban videórögzítés.")
                return
            }
            self.stopCalls.append(call)
            self.finishVideoRecording()
        }
    }

    @objc func deleteVideoRecording(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let uri = call.getString("uri"),
                  let completed = self.completedVideo,
                  completed.url.absoluteString == uri else {
                call.reject("A videófájl nem található.")
                return
            }
            self.removeCompletedVideo()
            call.resolve()
        }
    }

    private func finishVideoRecording() {
        guard !stoppingVideo,
              let startedAt = videoStartedAt,
              let outputURL = videoOutputURL else { return }

        stoppingVideo = true
        stopTimer?.invalidate()
        stopTimer = nil
        RPScreenRecorder.shared().stopRecording(withOutput: outputURL) { error in
            DispatchQueue.main.async {
                self.stoppingVideo = false
                self.videoStartedAt = nil
                self.videoOutputURL = nil
                let calls = self.stopCalls
                self.stopCalls.removeAll()

                if let error = error {
                    try? FileManager.default.removeItem(at: outputURL)
                    calls.forEach { $0.reject("A videó nem készült el.", nil, error) }
                    return
                }

                let durationMs = min(
                    Int(Date().timeIntervalSince(startedAt) * 1000),
                    Int(Self.maxVideoDuration * 1000)
                )
                let result = (url: outputURL, durationMs: max(0, durationMs))
                self.completedVideo = result
                calls.forEach { $0.resolve(self.videoResult(result)) }
            }
        }
    }

    private func videoResult(_ result: (url: URL, durationMs: Int)) -> [String: Any] {
        ["uri": result.url.absoluteString, "durationMs": result.durationMs]
    }

    private func removeCompletedVideo() {
        if let url = completedVideo?.url {
            try? FileManager.default.removeItem(at: url)
        }
        completedVideo = nil
    }
}
