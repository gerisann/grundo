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
    private var lastLocation: CLLocation?
    private var lastSpeed = 0.0
    private var lastRecordedUpdateAt = Date.distantPast
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
        lastLocation = nil
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

    func sync(_ snapshot: GrundoActivitySnapshot) {
        self.snapshot = snapshot
        update(contentState(for: snapshot))
    }

    func record(_ location: CLLocation) {
        guard var current = snapshot, !current.isPaused else {
            lastLocation = location
            return
        }
        defer { lastLocation = location }
        guard location.horizontalAccuracy >= 0, location.horizontalAccuracy <= 50 else { return }

        if let previous = lastLocation {
            let seconds = location.timestamp.timeIntervalSince(previous.timestamp)
            let meters = location.distance(from: previous)
            guard seconds > 0, meters / seconds <= 40 else { return }
            guard meters >= 5 || seconds >= 30 else { return }
            current = GrundoActivitySnapshot(
                startedAt: current.startedAt,
                distanceM: current.distanceM + meters,
                pausedSeconds: current.pausedSeconds,
                pausedAt: current.pausedAt,
                isPaused: false
            )
            lastSpeed = location.speed >= 0 ? location.speed : meters / seconds
            snapshot = current

            let now = Date()
            guard now.timeIntervalSince(lastRecordedUpdateAt) >= recordUpdateIntervalS else { return }
            lastRecordedUpdateAt = now
            update(contentState(for: current))
        }
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
        lastLocation = nil
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
