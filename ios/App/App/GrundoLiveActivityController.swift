import ActivityKit
import CoreLocation
import Foundation

struct GrundoActivitySnapshot {
    let startedAt: Date
    let distanceM: Double
    let pausedSeconds: Double
    let pausedAt: Date?
    let isPaused: Bool
}

@available(iOS 16.1, *)
final class GrundoLiveActivityController {
    private var activity: Activity<GrundoTrackingAttributes>?
    private var snapshot: GrundoActivitySnapshot?

    /**
     Az utolsó ELFOGADOTT fix — a szűrés EHHEZ mér, nem a legutóbb kapotthoz.

     ⚠️ A KETTŐ NEM UGYANAZ, és a különbség vitte el a távot. Korábban egyetlen
     `lastLocation` volt, amit egy `defer` MINDEN fixnél előreléptetett — a
     kapukon elbukó minták is új referenciaponttá váltak, és az azokon átívelő
     szakasz távja végleg elveszett. Mérve (2026-09-01, Jamal 12 órás menete):
     azonos percben 86,07 km a zárolt képernyőn és 92,69 km az appban, 7,1%
     hiány. Az elutasított minta mostantól SEMMIT nem mozdít.
     */
    private var lastAccepted: CLLocation?

    /**
     A táv HORGONYA — nem a legutóbbi ponthoz mérünk, hanem ehhez.

     Ugyanaz a szabály, mint a JS oldalon (`tracking/recorder.ts`
     `anchoredTotal`): amíg a minta a horgony `stationaryRadiusM` sugarú körén
     belül marad, a táv nem nő és a horgony nem mozdul. Enélkül egy álló
     helyzetben vándorló GPS-jel lassan kilométereket adna hozzá — a
     láncösszeg ezt nem tudja megkülönböztetni a valódi mozgástól.
     */
    private var anchor: CLLocation?

    private var lastSpeed = 0.0
    private var lastRecordedUpdateAt = Date.distantPast

    /*
     ⚠️ EZEK A SZÁMOK A JAVASCRIPT OLDAL MÁSOLATAI, és annak is kell
     maradniuk. A forrásuk `src/config/gameplay.ts` és `src/tracking/filter.ts`;
     Swiftből nem lehet importálni őket, tehát ez az egyetlen hely, ahol a
     rendszerben ugyanaz a szabály kétszer szerepel.

     Ha ott változik valamelyik, ITT IS ÁT KELL VEZETNI — különben a zárolt
     képernyő megint mást fog mutatni, mint az app, és a hiba pontosan úgy néz
     majd ki, mint egy GPS-pontatlanság.
     */
    /** `GAMEPLAY.MAX_GPS_ACCURACY_M` — e fölött a fixet eldobjuk. Volt: 50. */
    private static let maxAccuracyM: CLLocationAccuracy = 30
    /** `FILTER.MAX_SPEED_MPS` — 144 km/h, fizikailag lehetetlen gyalog/bringán. */
    private static let maxSpeedMps: Double = 40
    /** `FILTER.MIN_MOVE_M` — ennél közelebbi pontot nem rögzítünk. */
    private static let minMoveM: CLLocationDistance = 5
    /** `FILTER.MAX_GAP_MS` — ennyi idő után akkor is rögzítünk, ha alig mozdult. */
    private static let maxGapS: TimeInterval = 30
    /** `GAMEPLAY.GPS_STATIONARY_RADIUS_M` — a horgony sugara. */
    private static let stationaryRadiusM: CLLocationDistance = 12
    /**
     Ennyi mp-enként frissítjük TÉNYLEGESEN a widgetet a `record()` (GPS-
     alapú, lezárt képernyős) ágon — a `snapshot`/`distanceM` ettől
     függetlenül minden mintánál pontosan frissül, csak a push ritkább.
     A hívó (`BackgroundLocationPlugin`) mostantól ezt az ágat kizárólag
     háttérben futtatja, tehát ez a szám a LOCKSCREEN widget frissülési
     ütemét szabja, nem a mért adat pontosságát (GRUNDO #21, C2).
     */
    private let recordUpdateIntervalS: TimeInterval = 10

    func start(activityType: String, snapshot: GrundoActivitySnapshot) {
        self.snapshot = snapshot
        lastAccepted = nil
        anchor = nil
        lastSpeed = 0

        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        if let existing = Activity<GrundoTrackingAttributes>.activities.first {
            activity = existing
            sync(snapshot)
            return
        }

        do {
            let attributes = GrundoTrackingAttributes(activityType: activityType)
            let state = contentState(for: snapshot)
            if #available(iOS 16.2, *) {
                activity = try Activity.request(
                    attributes: attributes,
                    content: ActivityContent(state: state, staleDate: nil),
                    pushType: nil
                )
            } else {
                activity = try Activity.request(
                    attributes: attributes,
                    contentState: state,
                    pushType: nil
                )
            }
        } catch {
            NSLog("[GRUNDO] Live Activity indítása sikertelen: %@", error.localizedDescription)
        }
    }

    /**
     A HITELES ÉRTÉK MEGÉRKEZETT A JAVASCRIPTBŐL.

     ⚠️ ILYENKOR A SAJÁT REFERENCIÁNKAT EL KELL DOBNI. A `record()` csak
     háttérben fut; előtérben a JS szinkronizál. Ha a referenciát megtartanánk,
     a háttérbe visszatérés utáni ELSŐ fix az egész előtérben megtett utat
     hozzáadná a JS által már beleszámolt távhoz — kétszer könyvelnénk
     ugyanazt a szakaszt. (Ez a hiba a régi kódban benne volt, és ellentétes
     irányban torzított, mint az elvesztett szakaszok; a kettő eredője volt a
     mért −7,1%.)

     A nullázás ára legfeljebb egyetlen fixnyi táv: a háttér első mintája
     újra lehorgonyoz, és onnantól pontosan mér. Cserébe minden előtérbe
     visszatérés HELYREÁLLÍTJA a widget értékét, mert a JS a teljes,
     kiürített háttérsorból újraszámolja.
     */
    func sync(_ snapshot: GrundoActivitySnapshot) {
        self.snapshot = snapshot
        lastAccepted = nil
        anchor = nil
        update(contentState(for: snapshot))
    }

    /**
     Háttérben megtett táv — UGYANAZZAL A SZABÁLLYAL, mint a JavaScript.

     Két lépés, pontosan úgy, ahogy `tracking/filter.ts` (`evaluate`) és
     `tracking/recorder.ts` (`anchoredTotal`) csinálja:

       1. SZŰRÉS — a mintát az utolsó ELFOGADOTT ponthoz mérjük. Ami elbukik,
          az nyomtalanul eltűnik: nem lesz belőle referencia, és nem mozdítja
          a horgonyt sem.
       2. HORGONY — az elfogadott pont csak akkor ad távot, ha a horgonytól
          legalább `stationaryRadiusM`-re van; ekkor ő lesz az új horgony.
     */
    func record(_ location: CLLocation) {
        guard var current = snapshot, !current.isPaused else { return }
        guard location.horizontalAccuracy >= 0,
              location.horizontalAccuracy <= Self.maxAccuracyM else { return }

        guard let previous = lastAccepted else {
            // Az első elfogadott fix csak lehorgonyoz — nincs mihez mérni.
            lastAccepted = location
            anchor = location
            return
        }

        let seconds = location.timestamp.timeIntervalSince(previous.timestamp)
        guard seconds > 0 else { return }
        let meters = location.distance(from: previous)
        guard meters / seconds <= Self.maxSpeedMps else { return }
        guard meters >= Self.minMoveM || seconds >= Self.maxGapS else { return }

        lastAccepted = location
        lastSpeed = location.speed >= 0 ? location.speed : meters / seconds

        /*
         A HORGONY CSAK A TÁVOT KAPUZZA, a sebességet és a widget frissítését
         NEM. Álló helyzetben a táv helyesen nem nő, de a sebesség attól még
         változik (nullára) — ha itt kilépnénk, a zárolt képernyő az utolsó
         menet közbeni sebességnél ragadna.
         */
        if let anchorPoint = anchor {
            let delta = location.distance(from: anchorPoint)
            if delta >= Self.stationaryRadiusM {
                anchor = location
                current = GrundoActivitySnapshot(
                    startedAt: current.startedAt,
                    distanceM: current.distanceM + delta,
                    pausedSeconds: current.pausedSeconds,
                    pausedAt: current.pausedAt,
                    isPaused: false
                )
            }
        } else {
            anchor = location
        }
        snapshot = current

        let now = Date()
        guard now.timeIntervalSince(lastRecordedUpdateAt) >= recordUpdateIntervalS else { return }
        lastRecordedUpdateAt = now
        update(contentState(for: current))
    }

    func end() {
        guard let activity else { return }
        let finalState = contentState(for: snapshot ?? GrundoActivitySnapshot(
            startedAt: Date(), distanceM: 0, pausedSeconds: 0, pausedAt: nil, isPaused: true
        ))
        Task {
            if #available(iOS 16.2, *) {
                await activity.end(
                    ActivityContent(state: finalState, staleDate: nil),
                    dismissalPolicy: .immediate
                )
            } else {
                await activity.end(using: finalState, dismissalPolicy: .immediate)
            }
        }
        self.activity = nil
        snapshot = nil
        lastAccepted = nil
        anchor = nil
    }

    private func update(_ state: GrundoTrackingAttributes.ContentState) {
        guard let activity else { return }
        Task {
            if #available(iOS 16.2, *) {
                await activity.update(ActivityContent(state: state, staleDate: nil))
            } else {
                await activity.update(using: state)
            }
        }
    }

    private func contentState(
        for snapshot: GrundoActivitySnapshot
    ) -> GrundoTrackingAttributes.ContentState {
        let now = Date()
        let openPause = snapshot.isPaused
            ? max(0, now.timeIntervalSince(snapshot.pausedAt ?? now))
            : 0
        let elapsed = max(
            0,
            now.timeIntervalSince(snapshot.startedAt) - snapshot.pausedSeconds - openPause
        )
        return GrundoTrackingAttributes.ContentState(
            distanceMeters: snapshot.distanceM,
            speedMetersPerSecond: snapshot.isPaused ? 0 : lastSpeed,
            timerReferenceDate: now.addingTimeInterval(-elapsed),
            elapsedSeconds: elapsed,
            isPaused: snapshot.isPaused
        )
    }
}
