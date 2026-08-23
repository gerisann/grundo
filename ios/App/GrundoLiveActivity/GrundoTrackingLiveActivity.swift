import ActivityKit
import Foundation
import SwiftUI
import WidgetKit

struct GrundoTrackingLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: GrundoTrackingAttributes.self) { context in
            LockScreenView(context: context)
                .activityBackgroundTint(Color(red: 0.055, green: 0.047, blue: 0.075))
                .activitySystemActionForegroundColor(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    BrandMark()
                }
                DynamicIslandExpandedRegion(.trailing) {
                    TimerValue(state: context.state, compact: true)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(activityLabel(context.attributes.activityType))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 28) {
                        Metric(value: distance(context.state.distanceMeters), label: "TÁV")
                        Metric(value: speed(context.state.speedMetersPerSecond), label: "SEBESSÉG")
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                Image(systemName: "hexagon.fill")
                    .foregroundStyle(grundoGradient)
            } compactTrailing: {
                Text(distance(context.state.distanceMeters))
                    .font(.caption2.monospacedDigit().weight(.semibold))
            } minimal: {
                Image(systemName: context.state.isPaused ? "pause.fill" : "figure.run")
                    .foregroundStyle(grundoGradient)
            }
            .keylineTint(Color(red: 0.98, green: 0.37, blue: 0.45))
        }
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<GrundoTrackingAttributes>

    var body: some View {
        VStack(spacing: 14) {
            HStack {
                BrandMark()
                VStack(alignment: .leading, spacing: 1) {
                    Text("GRUNDO")
                        .font(.headline.weight(.bold))
                    Text(context.state.isPaused
                         ? "Rögzítés szüneteltetve"
                         : activityLabel(context.attributes.activityType))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                StatusPill(isPaused: context.state.isPaused)
            }

            HStack(spacing: 0) {
                Metric(value: distance(context.state.distanceMeters), label: "TÁV")
                Divider().frame(height: 38)
                VStack(spacing: 3) {
                    TimerValue(state: context.state, compact: false)
                    Text("IDŐ")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity)
                Divider().frame(height: 38)
                Metric(value: speed(context.state.speedMetersPerSecond), label: "SEBESSÉG")
            }
        }
        .padding(16)
        .foregroundStyle(.white)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibilitySummary(context))
    }
}

private struct BrandMark: View {
    var body: some View {
        Image(systemName: "hexagon.fill")
            .font(.title2)
            .foregroundStyle(grundoGradient)
    }
}

private struct StatusPill: View {
    let isPaused: Bool

    var body: some View {
        Label(isPaused ? "Szünet" : "Élő", systemImage: isPaused ? "pause.fill" : "location.fill")
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(.white.opacity(0.1), in: Capsule())
            .foregroundStyle(isPaused ? Color.gray : Color.green)
    }
}

private struct Metric: View {
    let value: String
    let label: String

    var body: some View {
        VStack(spacing: 3) {
            Text(value)
                .font(.title3.monospacedDigit().weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.75)
            Text(label)
                .font(.caption2.weight(.medium))
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct TimerValue: View {
    let state: GrundoTrackingAttributes.ContentState
    let compact: Bool

    var body: some View {
        Group {
            if state.isPaused {
                Text(duration(state.elapsedSeconds))
            } else {
                Text(state.timerReferenceDate, style: .timer)
            }
        }
        .font(compact
              ? .caption2.monospacedDigit().weight(.semibold)
              : .title3.monospacedDigit().weight(.bold))
        .lineLimit(1)
    }
}

private let grundoGradient = LinearGradient(
    colors: [Color(red: 0.55, green: 0.31, blue: 0.96),
             Color(red: 0.98, green: 0.37, blue: 0.45)],
    startPoint: .topLeading,
    endPoint: .bottomTrailing
)

private func activityLabel(_ type: String) -> String {
    switch type {
    case "walk": return "Séta folyamatban"
    case "ride": return "Bringázás folyamatban"
    default: return "Futás folyamatban"
    }
}

private func distance(_ meters: Double) -> String {
    String(format: "%.2f km", max(0, meters) / 1000)
}

private func speed(_ metersPerSecond: Double) -> String {
    String(format: "%.1f km/h", max(0, metersPerSecond) * 3.6)
}

private func duration(_ seconds: Double) -> String {
    let total = max(0, Int(seconds.rounded()))
    return String(format: "%d:%02d:%02d", total / 3600, (total / 60) % 60, total % 60)
}

private func accessibilitySummary(
    _ context: ActivityViewContext<GrundoTrackingAttributes>
) -> String {
    "\(activityLabel(context.attributes.activityType)), "
        + "\(distance(context.state.distanceMeters)), "
        + "\(duration(context.state.elapsedSeconds)), "
        + "\(speed(context.state.speedMetersPerSecond))"
}
