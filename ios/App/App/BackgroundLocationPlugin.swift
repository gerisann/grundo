import Capacitor
import CoreLocation
import UIKit

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
        CAPPluginMethod(name: "syncActivity", returnType: CAPPluginReturnPromise),
    ]

    private let locationManager = CLLocationManager()
    private let queueKey = "grundo.backgroundLocationQueue.v1"
    private let maximumQueuedLocations = 500
    private var pendingStart = false
    private var requestedActivityType = "run"
    private var requestedActivityState: GrundoActivitySnapshot?
    private var liveActivityEnabled = true
    private var liveActivityController: AnyObject?

    /**
     A TARTÓS SORHOZ MÉG NEM ÍRT PONTOK — lásd `enqueue`/`persistPendingLocations`.

     ⚠️ GRUNDO #21 energiaelemzés, C1: korábban minden EGYES pont a teljes
     `UserDefaults`-sor kiolvasásával, bővítésével és teljes visszaírásával
     járt — 500 elemű sornál ez 500 szótár (de)szerializálását jelentette
     MINDEN mintára, ELŐTÉRBEN is, ahol a JS a pontot amúgy is azonnal
     megkapja a `notifyListeners` hívásból. Az in-memory puffer O(1)
     hozzáfűzést ad; a lemezre írás csak háttérben, ritkítva történik (lásd
     lent) — a `UserDefaults` egyetlen szerepe a FOLYAMAT-KILÖVÉS elleni
     védelem, nem a normál átadás.
     */
    private var pendingLocations: [[String: Any]] = []
    private var isBackgrounded = false
    private var lastPersistedAt = Date.distantPast
    /** Háttérben ennyi mp-enként (nem mintánként) írunk lemezre. */
    private let backgroundPersistIntervalS: TimeInterval = 10
    private var backgroundObserver: NSObjectProtocol?
    private var foregroundObserver: NSObjectProtocol?

    public override func load() {
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        // Alapérték — a `start()` mozgásforma szerint felülírja (lásd ott).
        locationManager.distanceFilter = 5
        locationManager.activityType = .fitness
        locationManager.pausesLocationUpdatesAutomatically = false
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true

        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.isBackgrounded = true
            // Azonnali biztosítéki írás a háttérbe lépés pillanatában — utána
            // a rendes ritkított ütem veszi át (`enqueue`).
            self?.persistPendingLocations()
        }
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.isBackgrounded = false
        }
    }

    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    }

    @objc func start(_ call: CAPPluginCall) {
        requestedActivityType = normalizedActivityType(call.getString("activityType"))
        // ⚠️ GRUNDO #21 energiaelemzés, C3: a szűrő mozgásformánként eltérő.
        // Bringánál a régi, egységes 5 méteres szűrő 30 km/h-nál kb.
        // 0,6 másodpercenként adott pontot — háromszor annyit, mint sétánál —,
        // pedig a területfoglaláshoz (18,8 m átlójú hatszögek) ez a felbontás
        // nem kell. Mindhárom érték jóval a hatszögátló alatt marad.
        locationManager.distanceFilter = distanceFilter(for: requestedActivityType)
        requestedActivityState = activitySnapshot(call.getObject("activityState"))
        liveActivityEnabled = call.getBool("liveActivityEnabled") ?? true
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
        endLiveActivity()
        call.resolve()
    }

    @objc func syncActivity(_ call: CAPPluginCall) {
        if let snapshot = activitySnapshot(call) {
            requestedActivityState = snapshot
            syncLiveActivity(snapshot)
        }
        call.resolve()
    }

    @objc func drain(_ call: CAPPluginCall) {
        // A lemezre írt ÉS a még csak memóriában lévő pontok együtt adják a
        // teljes sort — utóbbi azért létezik, mert előtérben (és a ritkítás
        // ablakában háttérben is) nem minden pont jut el azonnal a lemezig.
        var locations = queuedLocations()
        locations.append(contentsOf: pendingLocations)
        pendingLocations.removeAll()
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
            recordLiveActivityLocation(location)
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
        startLiveActivityIfNeeded()
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
        pendingLocations.append(payload)
        if pendingLocations.count > maximumQueuedLocations {
            pendingLocations.removeFirst(pendingLocations.count - maximumQueuedLocations)
        }
        // ELŐTÉRBEN nem írunk lemezre: a pont már elment a JS-nek a
        // `notifyListeners` hívással, a `UserDefaults` csak a folyamat-kilövés
        // elleni biztosíték, ami csak háttérben releváns.
        guard isBackgrounded else { return }
        guard Date().timeIntervalSince(lastPersistedAt) >= backgroundPersistIntervalS else { return }
        persistPendingLocations()
    }

    private func persistPendingLocations() {
        guard !pendingLocations.isEmpty else { return }
        var stored = queuedLocations()
        stored.append(contentsOf: pendingLocations)
        if stored.count > maximumQueuedLocations {
            stored.removeFirst(stored.count - maximumQueuedLocations)
        }
        UserDefaults.standard.set(stored, forKey: queueKey)
        pendingLocations.removeAll()
        lastPersistedAt = Date()
    }

    private func normalizedActivityType(_ value: String?) -> String {
        value == "walk" || value == "ride" ? value! : "run"
    }

    private func distanceFilter(for activityType: String) -> CLLocationDistance {
        switch activityType {
        case "walk": return 8
        case "ride": return 12
        default: return 5 // run
        }
    }

    private func activitySnapshot(_ value: JSObject?) -> GrundoActivitySnapshot? {
        guard let value,
              let startedAt = value["startedAt"] as? Double,
              let distanceM = value["distanceM"] as? Double,
              let pausedMs = value["pausedMs"] as? Double,
              let status = value["status"] as? String else { return nil }
        let pausedAt = value["pausedAt"] as? Double
        return GrundoActivitySnapshot(
            startedAt: Date(timeIntervalSince1970: startedAt / 1000),
            distanceM: max(0, distanceM),
            pausedSeconds: max(0, pausedMs / 1000),
            pausedAt: pausedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
            isPaused: status == "paused"
        )
    }

    /**
     A `syncActivity` a pillanatképet közvetlenül a plugin-hívás gyökerében
     kapja. Capacitor 8 alatt a `call.options` már `[AnyHashable: Any]`, nem
     `JSObject`; a típusos getterek használata ezért nemcsak biztonságosabb,
     hanem az Xcode 26-os Release fordítással is kompatibilis.
     */
    private func activitySnapshot(_ call: CAPPluginCall) -> GrundoActivitySnapshot? {
        guard let startedAt = call.getDouble("startedAt"),
              let distanceM = call.getDouble("distanceM"),
              let pausedMs = call.getDouble("pausedMs"),
              let status = call.getString("status") else { return nil }
        let pausedAt = call.getDouble("pausedAt")
        return GrundoActivitySnapshot(
            startedAt: Date(timeIntervalSince1970: startedAt / 1000),
            distanceM: max(0, distanceM),
            pausedSeconds: max(0, pausedMs / 1000),
            pausedAt: pausedAt.map { Date(timeIntervalSince1970: $0 / 1000) },
            isPaused: status == "paused"
        )
    }

    private func startLiveActivityIfNeeded() {
        guard liveActivityEnabled else { return }
        guard #available(iOS 16.1, *) else { return }
        let controller = (liveActivityController as? GrundoLiveActivityController)
            ?? GrundoLiveActivityController()
        liveActivityController = controller
        controller.start(
            activityType: requestedActivityType,
            snapshot: requestedActivityState ?? GrundoActivitySnapshot(
                startedAt: Date(),
                distanceM: 0,
                pausedSeconds: 0,
                pausedAt: nil,
                isPaused: false
            )
        )
    }

    private func syncLiveActivity(_ snapshot: GrundoActivitySnapshot) {
        guard #available(iOS 16.1, *),
              let controller = liveActivityController as? GrundoLiveActivityController else { return }
        controller.sync(snapshot)
    }

    private func recordLiveActivityLocation(_ location: CLLocation) {
        // ⚠️ GRUNDO #21 energiaelemzés, C2: ELŐTÉRBEN a JS oldali
        // `syncActivity` (lásd `syncLiveActivity`) az EGYETLEN forrás — az
        // a hiteles, horgony-szűrt távolságot küldi (`useRecorder.ts`
        // `apply`). Ez a natív ág korábban MINDEN mintánál futott, függetlenül
        // attól, hogy a JS is frissített-e — két, eltérő algoritmusú
        // távolságszámítás versenyzett ugyanazért a widgetért. Ez az ág
        // KIZÁRÓLAG akkor fut, amikor a WebView ténylegesen alszik (lezárt
        // képernyő) — ott viszont ez az EGYETLEN forrás, hiszen a JS nem fut.
        guard isBackgrounded else { return }
        guard #available(iOS 16.1, *),
              let controller = liveActivityController as? GrundoLiveActivityController else { return }
        controller.record(location)
    }

    private func endLiveActivity() {
        guard #available(iOS 16.1, *),
              let controller = liveActivityController as? GrundoLiveActivityController else { return }
        controller.end()
        liveActivityController = nil
    }
}
