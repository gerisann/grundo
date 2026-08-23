import Capacitor
import CoreLocation

/**
 * A GRUNDO saját helyforrása.
 *
 * A WebView JavaScriptje a lezárt képernyőn felfüggesztődik, ezért a natív
 * réteg nem csak eseményt küld, hanem a közben érkező pontokat is tartósan
 * sorba teszi. A JavaScript a következő ébredéskor a `drain` hívással veszi
 * át őket, így a háttérben megtett út nem vész el.
 */
@objc(BackgroundLocationPlugin)
public class BackgroundLocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "BackgroundLocationPlugin"
    public let jsName = "BackgroundLocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drain", returnType: CAPPluginReturnPromise),
    ]

    private let locationManager = CLLocationManager()
    private let queueKey = "grundo.backgroundLocationQueue.v1"
    private let maximumQueuedLocations = 500
    private var pendingStart = false

    public override func load() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 5
        locationManager.activityType = .fitness
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
    }

    @objc func start(_ call: CAPPluginCall) {
        switch locationManager.authorizationStatus {
        case .authorizedAlways:
            startUpdates()
            call.resolve(["permission": "granted", "backgroundPermission": "granted"])
        case .authorizedWhenInUse:
            // A V1 specifikációja szerint a lezárt képernyős rögzítéshez
            // „Always” jogosultságot is kérünk. A rendszer ezt a kezdeti
            // „Használat közben” döntés után, saját ütemében jelenítheti meg;
            // előtérben addig is elindítható a mérés.
            locationManager.requestAlwaysAuthorization()
            startUpdates()
            call.resolve(["permission": "granted", "backgroundPermission": "not_granted"])
        case .notDetermined:
            pendingStart = true
            locationManager.requestWhenInUseAuthorization()
            call.resolve(["permission": "prompt"])
        case .denied, .restricted:
            call.reject("Nincs helyhozzáférés. Engedélyezd a GRUNDO számára a készülék beállításaiban.")
        @unknown default:
            call.reject("A helyhozzáférés állapota ismeretlen.")
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        pendingStart = false
        locationManager.stopUpdatingLocation()
        call.resolve()
    }

    @objc func drain(_ call: CAPPluginCall) {
        let locations = queuedLocations()
        UserDefaults.standard.removeObject(forKey: queueKey)
        call.resolve(["locations": locations])
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard pendingStart else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways:
            pendingStart = false
            startUpdates()
        case .authorizedWhenInUse:
            pendingStart = false
            manager.requestAlwaysAuthorization()
            startUpdates()
            notifyListeners("backgroundPermission", data: ["granted": false])
        case .denied, .restricted:
            pendingStart = false
            notifyListeners("error", data: ["code": "permission_denied"])
        case .notDetermined:
            break
        @unknown default:
            pendingStart = false
            notifyListeners("error", data: ["code": "unavailable"])
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        for location in locations where location.horizontalAccuracy >= 0 {
            let payload = locationPayload(location)
            enqueue(payload)
            notifyListeners("location", data: payload)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        notifyListeners("error", data: ["code": "unavailable", "message": error.localizedDescription])
    }

    private func startUpdates() {
        // Az Info.plist `UIBackgroundModes: location` bejegyzése nélkül ez az
        // iOS-ben végzetes hiba lenne, ezért a két rész mindig együtt változik.
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.startUpdatingLocation()
    }

    private func locationPayload(_ location: CLLocation) -> [String: Any] {
        var payload: [String: Any] = [
            "lat": location.coordinate.latitude,
            "lng": location.coordinate.longitude,
            "t": Int(location.timestamp.timeIntervalSince1970 * 1000),
            "accuracy": location.horizontalAccuracy,
        ]
        if location.verticalAccuracy >= 0 {
            payload["elevation"] = location.altitude
        }
        if location.speed >= 0 {
            payload["speed"] = location.speed
        }
        return payload
    }

    private func queuedLocations() -> [[String: Any]] {
        UserDefaults.standard.array(forKey: queueKey) as? [[String: Any]] ?? []
    }

    private func enqueue(_ payload: [String: Any]) {
        var queued = queuedLocations()
        queued.append(payload)
        if queued.count > maximumQueuedLocations {
            queued.removeFirst(queued.count - maximumQueuedLocations)
        }
        UserDefaults.standard.set(queued, forKey: queueKey)
    }
}
