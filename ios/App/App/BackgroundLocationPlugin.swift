import Capacitor
import CoreLocation
import Foundation
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
        CAPPluginMethod(name: "getCurrentPosition", returnType: CAPPluginReturnPromise),
    ]

    private let locationManager = CLLocationManager()

    /**
     KÜLÖN MANAGER AZ EGYSZERI FIXHEZ — és ez nem stílus kérdése.

     A `locationManager` `didUpdateLocations` visszahívása MINDEN pontot a
     rögzítés sorába tesz (`enqueue`). Ha a térkép középre igazításához kért
     egyetlen fix ugyanazon a manageren jönne, az bekerülne egy éppen futó
     vagy később induló aktivitás nyomvonalába — egy olyan pont, amit a
     felhasználó nem is mozogva tett meg. A két forgalmat ezért a delegate is
     a manager azonossága szerint választja szét.
     */
    private lazy var oneShotManager: CLLocationManager = {
        let manager = CLLocationManager()
        manager.delegate = self
        // A térkép középre állításához száz méter bőven elég, és jóval
        // kevesebb energiába kerül, mint a `kCLLocationAccuracyBest`.
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
        return manager
    }()
    /**
     A még válaszra váró `getCurrentPosition` hívások.

     A hívást SAJÁT MAGUNK tartjuk életben: a bridge `keepAlive` jelzője csak
     a mentett hívások nyilvántartásáról szól, a `resolve` closure enélkül is
     érvényes marad (`CapacitorBridge.swift`). Így a válasz akkor is megérkezik
     a JS-hez, ha az engedélykérdés után percekkel jön az első fix.
     */
    private var pendingPositionCalls: [CAPPluginCall] = []
    private var awaitingPositionAuthorization = false
    /** A korábbi, 500 pontos UserDefaults-sor frissítés utáni beolvasásához. */
    private let legacyQueueKey = "grundo.backgroundLocationQueue.v1"
    /** Androiddal azonos, többórás rögzítésre méretezett felső korlát. */
    private let maximumQueuedLocations = 25_000
    private let queueDirectoryName = "grundo.backgroundLocationQueue.v2"
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
    private lazy var queueDirectoryURL: URL? = {
        do {
            let root = try FileManager.default.url(
                for: .applicationSupportDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true
            )
            var directory = root.appendingPathComponent(queueDirectoryName, isDirectory: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            try? directory.setResourceValues(values)
            return directory
        } catch {
            NSLog("[GRUNDO] Háttér-GPS sor mappája nem hozható létre: %@", error.localizedDescription)
            return nil
        }
    }()

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
        }
        foregroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.willEnterForegroundNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            // A WebView ébredése előtt az utolsó, még memóriában lévő
            // háttérpontok is kerüljenek a drain által olvasott sorba.
            self?.persistPendingLocations()
            self?.isBackgrounded = false
        }
    }

    deinit {
        persistPendingLocations()
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        if let foregroundObserver { NotificationCenter.default.removeObserver(foregroundObserver) }
    }

    @objc func start(_ call: CAPPluginCall) {
        /**
         GRUNDO #42: a lezárt képernyő alatt is gyűjtő lemezes sor NEM tudja,
         melyik logikai aktivitáshoz tartozik — csak azt, hogy „háttérben
         gyűjtött, még át nem adott pont". Ha a JS oldal VADONATÚJ aktivitást
         indít (`resume: false`), egy korábbi, félbehagyott/force-quitolt
         aktivitás itt ragadt maradéka NEM kerülhet bele — eldobjuk, mielőtt
         bármi mást tennénk. Legitim folytatásnál (`resume: true`, az
         IndexedDB-ből visszaállított állapothoz) a sor változatlanul
         megmarad, a `drain()` később helyesen visszaadja.
         */
        if call.getBool("resume") != true {
            pendingLocations.removeAll()
            clearPersistedLocations()
        }
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
            requestAlwaysOnce()
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

    /**
     EGYSZERI POZÍCIÓ a térkép középre igazításához.

     ⚠️ EZÉRT VAN EGYÁLTALÁN: a WebView `navigator.geolocation` hívása
     natívban KÉT rendszerablakot hoz — a CoreLocation magyar kérdését, és a
     WebKit saját, OLDAL-SZINTŰ kérdését, ami a mi processzünkben rajzolódik,
     ezért angolul és a Capacitor kiszolgálójának nevével („localhost would
     like to use your current location"). Mérve: iPhone, 2026-09-09. Ez a
     natív út a másodikat teljesen megkerüli — nincs weboldal, ami engedélyt
     kérne.

     A `whenInUse` szintnél többet NEM kér: a „Mindig" a rögzítés indításának
     a dolga (`start` → `requestAlwaysOnce`).
     */
    @objc func getCurrentPosition(_ call: CAPPluginCall) {
        switch oneShotManager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            pendingPositionCalls.append(call)
            oneShotManager.requestLocation()
        case .notDetermined:
            pendingPositionCalls.append(call)
            awaitingPositionAuthorization = true
            oneShotManager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            call.reject(
                "Nincs helyhozzáférés. Engedélyezd a GRUNDO számára a készülék beállításaiban.",
                "permission_denied"
            )
        @unknown default:
            call.reject("A helyhozzáférés állapota ismeretlen.", "unavailable")
        }
    }

    private func resolvePendingPositions(with location: CLLocation) {
        let calls = pendingPositionCalls
        pendingPositionCalls.removeAll()
        for call in calls {
            call.resolve([
                "lat": location.coordinate.latitude,
                "lng": location.coordinate.longitude,
                "accuracy": location.horizontalAccuracy,
                "t": Int64(location.timestamp.timeIntervalSince1970 * 1000),
            ])
        }
    }

    private func rejectPendingPositions(_ message: String, _ code: String) {
        let calls = pendingPositionCalls
        pendingPositionCalls.removeAll()
        for call in calls { call.reject(message, code) }
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
        // A lemezre írt ÉS a még csak memóriában lévő háttérpontok együtt
        // adják a teljes sort. Időrendbe rendezzük, mert Core Location
        // kötegei és az ébredéskori élő callback egymást megelőzhetik.
        var locations = queuedLocations()
        locations.append(contentsOf: pendingLocations)
        locations.sort { locationTimestamp($0) < locationTimestamp($1) }
        pendingLocations.removeAll()
        clearPersistedLocations()
        call.resolve(["locations": locations])
    }

    /// Az „Always” jogosultságot ÉLETÜNKBEN EGYSZER kérjük.
    ///
    /// ⚠️ MÉRT HIBA (Jeff, iPhone 17 Pro Max, 2026-09-09): az első használatnál
    /// HÁROMSZOR kellett helyzet-engedélyt adnia. A lánc a következő volt:
    ///
    ///   1. `notDetermined` → `requestWhenInUseAuthorization()` → 1. rendszerkérdés
    ///   2. a válasz beérkezik → `locationManagerDidChangeAuthorization` az
    ///      `.authorizedWhenInUse` ágon AZONNAL `requestAlwaysAuthorization()`-t
    ///      hívott → 2. rendszerkérdés
    ///   3. a következő rögzítés indításakor a `start()` megint
    ///      `.authorizedWhenInUse`-t látott, és ÚJRA kérte → 3. rendszerkérdés
    ///
    /// Két külön helyen kértük ugyanazt, és egyik sem emlékezett arra, hogy a
    /// felhasználó már döntött. Ez a jelző a teljes telepítés élettartamára
    /// megjegyzi a kérést; aki nemet mondott, azt nem zaklatjuk többé — az
    /// „Always” a rendszer Beállításaiban bármikor megadható.
    private static let alwaysRequestedKey = "grundo.locationAlwaysRequested"

    private func requestAlwaysOnce() {
        let defaults = UserDefaults.standard
        guard !defaults.bool(forKey: Self.alwaysRequestedKey) else { return }
        defaults.set(true, forKey: Self.alwaysRequestedKey)
        locationManager.requestAlwaysAuthorization()
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        /**
         AZ EGYSZERI FIX ÁGA ELŐSZÖR, ÉS KÜLÖN.

         A delegate mindkét managertől megkapja ezt a hívást. A `pendingStart`
         a rögzítésé; az egyszeri fix külön jelzőt használ, különben egy
         térkép-középre-igazítás elindíthatná a rögzítést, vagy fordítva: egy
         rögzítés-indítás nyelné el az egyszeri fix válaszát.
         */
        if awaitingPositionAuthorization {
            switch manager.authorizationStatus {
            case .authorizedAlways, .authorizedWhenInUse:
                awaitingPositionAuthorization = false
                oneShotManager.requestLocation()
            case .denied, .restricted:
                awaitingPositionAuthorization = false
                rejectPendingPositions(
                    "Nincs helyhozzáférés. Engedélyezd a GRUNDO számára a készülék beállításaiban.",
                    "permission_denied"
                )
            case .notDetermined:
                break
            @unknown default:
                awaitingPositionAuthorization = false
                rejectPendingPositions("A helyhozzáférés állapota ismeretlen.", "unavailable")
            }
        }

        guard pendingStart else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways:
            pendingStart = false
            startUpdates()
        case .authorizedWhenInUse:
            pendingStart = false
            requestAlwaysOnce()
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
        /**
         ⚠️ AZ EGYSZERI FIX NEM KERÜLHET A RÖGZÍTÉS SORÁBA. Egy térkép-középre
         igazításhoz kért pont nem a felhasználó megtett útja.
         */
        if manager === oneShotManager {
            if let location = locations.last(where: { $0.horizontalAccuracy >= 0 }) {
                resolvePendingPositions(with: location)
            } else {
                rejectPendingPositions("Nem sikerült helyzetet mérni.", "unavailable")
            }
            return
        }

        for location in locations where location.horizontalAccuracy >= 0 {
            let payload = locationPayload(location)
            enqueue(payload)
            recordLiveActivityLocation(location)
            notifyListeners("location", data: payload)
        }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        /**
         ⚠️ A `requestLocation()` MINDIG lezárul: vagy fixszel, vagy ezzel a
         hibával. Ha itt nem oldanánk fel a várakozó hívásokat, a JS ígérete
         örökre nyitva maradna, és a térkép a betöltő állapotában ragadna.
         */
        if manager === oneShotManager {
            rejectPendingPositions(error.localizedDescription, "unavailable")
            return
        }
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
        // A v1 sor egyszeri kompatibilitási bemenete: egy frissítés közben
        // már rögzített pont sem veszhet el.
        var locations = UserDefaults.standard.array(forKey: legacyQueueKey) as? [[String: Any]] ?? []
        for url in persistedBatchURLs() {
            do {
                let data = try Data(contentsOf: url)
                let value = try PropertyListSerialization.propertyList(from: data, options: [], format: nil)
                if let batch = value as? [[String: Any]] {
                    locations.append(contentsOf: batch)
                }
            } catch {
                NSLog("[GRUNDO] Háttér-GPS köteg nem olvasható (%@): %@", url.lastPathComponent, error.localizedDescription)
            }
        }
        return locations
    }

    private func enqueue(_ payload: [String: Any]) {
        // Előtérben a JS azonnal megkapja a pontot, és saját IndexedDB-
        // mentése védi. A natív sor kizárólag a felfüggesztett WebView alatti
        // szakaszé; így nem tároljuk és nem adjuk vissza duplán a teljes
        // előtéri útvonalat.
        guard isBackgrounded else { return }
        pendingLocations.append(payload)
        if pendingLocations.count > maximumQueuedLocations {
            pendingLocations.removeFirst(pendingLocations.count - maximumQueuedLocations)
        }
        guard Date().timeIntervalSince(lastPersistedAt) >= backgroundPersistIntervalS else { return }
        persistPendingLocations()
    }

    private func persistPendingLocations() {
        guard !pendingLocations.isEmpty else { return }
        guard let directory = queueDirectoryURL else { return }
        let batch = pendingLocations
        do {
            let data = try PropertyListSerialization.data(
                fromPropertyList: batch,
                format: .binary,
                options: 0
            )
            let millis = Int64(Date().timeIntervalSince1970 * 1000)
            let name = String(
                format: "%020lld-%05d-%@.plist",
                millis,
                batch.count,
                UUID().uuidString
            )
            try data.write(to: directory.appendingPathComponent(name), options: .atomic)
            pendingLocations.removeAll()
            lastPersistedAt = Date()
            prunePersistedBatches()
        } catch {
            // Íráshibánál a memória-puffer érintetlen marad: a következő fix
            // újrapróbálja, a drain pedig így is át tudja adni.
            NSLog("[GRUNDO] Háttér-GPS köteg mentése sikertelen: %@", error.localizedDescription)
        }
    }

    private func persistedBatchURLs() -> [URL] {
        guard let directory = queueDirectoryURL else { return [] }
        let urls = try? FileManager.default.contentsOfDirectory(
            at: directory,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        )
        return (urls ?? [])
            .filter { $0.pathExtension == "plist" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    private func prunePersistedBatches() {
        var batches = persistedBatchURLs().map { url in
            (url: url, count: batchCount(from: url.lastPathComponent))
        }
        var total = batches.reduce(0) { $0 + $1.count }
        while total > maximumQueuedLocations, let oldest = batches.first {
            do {
                try FileManager.default.removeItem(at: oldest.url)
                total -= oldest.count
                batches.removeFirst()
            } catch {
                NSLog("[GRUNDO] Régi háttér-GPS köteg nem törölhető: %@", error.localizedDescription)
                break
            }
        }
    }

    private func batchCount(from fileName: String) -> Int {
        let parts = fileName.split(separator: "-", maxSplits: 2)
        return parts.count > 1 ? (Int(parts[1]) ?? 0) : 0
    }

    private func clearPersistedLocations() {
        UserDefaults.standard.removeObject(forKey: legacyQueueKey)
        for url in persistedBatchURLs() {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func locationTimestamp(_ location: [String: Any]) -> Int64 {
        if let number = location["t"] as? NSNumber { return number.int64Value }
        if let value = location["t"] as? Int { return Int64(value) }
        return 0
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
