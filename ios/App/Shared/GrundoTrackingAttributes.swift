import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct GrundoTrackingAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var distanceMeters: Double
        var speedMetersPerSecond: Double
        var timerReferenceDate: Date
        var elapsedSeconds: Double
        var isPaused: Bool
    }

    var activityType: String
}
