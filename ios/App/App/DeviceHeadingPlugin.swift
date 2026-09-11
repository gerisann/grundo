import Capacitor
import CoreLocation
import UIKit

/** Device orientation for the map marker without using WebView geolocation. */
@objc(DeviceHeadingPlugin)
public class DeviceHeadingPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "DeviceHeadingPlugin"
    public let jsName = "DeviceHeading"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    private let headingManager = CLLocationManager()
    private var requested = false
    private var latestAccuracy: CLLocationDirection = -1
    private var backgroundObserver: NSObjectProtocol?
    private var foregroundObserver: NSObjectProtocol?

    public override func load() {
        headingManager.delegate = self
        headingManager.headingFilter = 3
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.headingManager.stopUpdatingHeading()
        }
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            guard let self, self.requested else { return }
            self.updateHeadingOrientation()
            self.headingManager.startUpdatingHeading()
        }
    }

    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard CLLocationManager.headingAvailable() else {
            call.reject("Az irányérzékelő ezen a készüléken nem érhető el.", "unavailable")
            return
        }
        requested = true
        updateHeadingOrientation()
        headingManager.startUpdatingHeading()
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        requested = false
        headingManager.stopUpdatingHeading()
        call.resolve()
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateHeading heading: CLHeading) {
        updateHeadingOrientation()
        let trueHeadingAvailable = heading.trueHeading >= 0
        let degrees = trueHeadingAvailable ? heading.trueHeading : heading.magneticHeading
        guard degrees.isFinite else { return }
        latestAccuracy = heading.headingAccuracy

        notifyListeners("heading", data: [
            "degrees": degrees,
            "accuracyDeg": heading.headingAccuracy,
            "source": trueHeadingAvailable ? "true" : "magnetic",
            "at": Int64(heading.timestamp.timeIntervalSince1970 * 1000),
        ])
    }

    public func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
        latestAccuracy < 0 || latestAccuracy > 25
    }

    private func updateHeadingOrientation() {
        guard let orientation = bridge?.viewController?.view.window?.windowScene?.interfaceOrientation else {
            headingManager.headingOrientation = .portrait
            return
        }
        switch orientation {
        case .portrait:
            headingManager.headingOrientation = .portrait
        case .portraitUpsideDown:
            headingManager.headingOrientation = .portraitUpsideDown
        case .landscapeLeft:
            headingManager.headingOrientation = .landscapeLeft
        case .landscapeRight:
            headingManager.headingOrientation = .landscapeRight
        default:
            headingManager.headingOrientation = .portrait
        }
    }
}
