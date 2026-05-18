import ClockKit
import SwiftUI
import WidgetKit

/// watchOS Complication provider for ORPHEUS.
/// Shows daemon state, connection status, and last query on the watch face.
@main
struct OrpheusComplicationWidget: Widget {
    let kind: String = "OrpheusComplicationWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: OrpheusProvider()) { entry in
            ComplicationView(entry: entry)
        }
        .configurationDisplayName("ORPHEUS")
        .description("Show ORPHEUS status on your watch face")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
            .accessoryCorner,
        ])
    }
}

// MARK: - Timeline Entry

struct OrpheusEntry: TimelineEntry {
    let date: Date
    let state: DaemonState
    let isConnected: Bool
    let lastQuery: String
    let intensity: Double
}

// MARK: - Timeline Provider

struct OrpheusProvider: TimelineProvider {
    func placeholder(in context: Context) -> OrpheusEntry {
        OrpheusEntry(
            date: Date(),
            state: .idle,
            isConnected: true,
            lastQuery: "Ready",
            intensity: 0.1
        )
    }

    func getSnapshot(in context: Context, completion: @escaping (OrpheusEntry) -> Void) {
        let entry = loadFromSharedDefaults()
        completion(entry)
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<OrpheusEntry>) -> Void) {
        let entry = loadFromSharedDefaults()
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: entry.date)!
        let timeline = Timeline(entries: [entry], policy: .after(nextUpdate))
        completion(timeline)
    }

    private func loadFromSharedDefaults() -> OrpheusEntry {
        let defaults = UserDefaults(suiteName: "group.com.orpheus.watch")
        let stateRaw = defaults?.string(forKey: "daemon_state") ?? "idle"
        let state = DaemonState(rawValue: stateRaw) ?? .idle
        let connected = defaults?.bool(forKey: "is_connected") ?? false
        let query = defaults?.string(forKey: "last_query") ?? "Tap to connect"
        let intensity = defaults?.double(forKey: "avatar_intensity") ?? 0.0

        return OrpheusEntry(
            date: Date(),
            state: state,
            isConnected: connected,
            lastQuery: query,
            intensity: intensity
        )
    }
}

// MARK: - Complication Views

struct ComplicationView: View {
    let entry: OrpheusEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            CircularView(entry: entry)
        case .accessoryRectangular:
            RectangularView(entry: entry)
        case .accessoryInline:
            InlineView(entry: entry)
        case .accessoryCorner:
            CornerView(entry: entry)
        default:
            CircularView(entry: entry)
        }
    }
}

// MARK: - Circular (small round)

struct CircularView: View {
    let entry: OrpheusEntry

    var body: some View {
        ZStack {
            Circle()
                .fill(entry.isConnected ? entry.stateColor.opacity(0.15) : Color.gray.opacity(0.1))

            if entry.isConnected {
                // Animated pulse ring
                Circle()
                    .stroke(entry.stateColor.opacity(0.6 + entry.intensity * 0.4), lineWidth: 2)
                    .scaleEffect(1.0 + entry.intensity * 0.1)

                // State icon
                Image(systemName: stateIcon)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(entry.stateColor)
            } else {
                Image(systemName: "xmark.circle")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.gray)
            }
        }
    }

    private var stateIcon: String {
        switch entry.state {
        case .idle: return "circle"
        case .listening: return "mic.fill"
        case .transcribing: return "waveform"
        case .responding: return "ellipsis.bubble.fill"
        case .speaking: return "speaker.wave.2.fill"
        case .typing: return "keyboard"
        }
    }

    private var stateColor: Color {
        switch entry.state {
        case .idle: return .gray
        case .listening: return .red
        case .transcribing: return .orange
        case .responding: return .blue
        case .speaking: return .purple
        case .typing: return .cyan
        }
    }
}

// MARK: - Rectangular (medium wide)

struct RectangularView: View {
    let entry: OrpheusEntry

    var body: some View {
        HStack(spacing: 8) {
            // Mini avatar
            DaemonAvatarView(
                state: entry.state,
                intensity: entry.intensity,
                isConnected: entry.isConnected
            )
            .frame(width: 36, height: 36)

            VStack(alignment: .leading, spacing: 2) {
                Text(entry.isConnected ? entry.stateLabel : "Offline")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(entry.isConnected ? entry.stateColor : .gray)

                Text(entry.lastQuery)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()
        }
        .padding(.horizontal, 4)
    }

    private var stateLabel: String {
        switch entry.state {
        case .idle: return "ORPHEUS"
        case .listening: return "Listening..."
        case .transcribing: return "Transcribing"
        case .responding: return "Responding"
        case .speaking: return "Speaking"
        case .typing: return "Typing"
        }
    }

    private var stateColor: Color {
        switch entry.state {
        case .idle: return .primary
        case .listening: return .red
        case .transcribing: return .orange
        case .responding: return .blue
        case .speaking: return .purple
        case .typing: return .cyan
        }
    }
}

// MARK: - Inline (text-only strip)

struct InlineView: View {
    let entry: OrpheusEntry

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: stateIcon)
                .font(.caption2)
                .foregroundColor(entry.isConnected ? entry.stateColor : .gray)
            Text(entry.isConnected ? entry.stateLabel : "ORPHEUS — Offline")
                .font(.caption2)
        }
    }

    private var stateIcon: String {
        switch entry.state {
        case .idle: return "circle"
        case .listening: return "mic.fill"
        case .transcribing: return "waveform"
        case .responding: return "ellipsis.bubble.fill"
        case .speaking: return "speaker.wave.2.fill"
        case .typing: return "keyboard"
        }
    }

    private var stateLabel: String {
        switch entry.state {
        case .idle: return "ORPHEUS"
        case .listening: return "Listening"
        case .transcribing: return "Transcribing"
        case .responding: return "Responding"
        case .speaking: return "Speaking"
        case .typing: return "Typing"
        }
    }

    private var stateColor: Color {
        switch entry.state {
        case .idle: return .gray
        case .listening: return .red
        case .transcribing: return .orange
        case .responding: return .blue
        case .speaking: return .purple
        case .typing: return .cyan
        }
    }
}

// MARK: - Corner (Apple Watch Ultra / corner slot)

struct CornerView: View {
    let entry: OrpheusEntry

    var body: some View {
        ZStack {
            if entry.isConnected {
                Circle()
                    .fill(entry.stateColor.opacity(0.2))
                    .frame(width: 28, height: 28)

                Image(systemName: stateIcon)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(entry.stateColor)
            } else {
                Image(systemName: "xmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.gray)
            }
        }
    }

    private var stateIcon: String {
        switch entry.state {
        case .idle: return "circle"
        case .listening: return "mic.fill"
        case .transcribing: return "waveform"
        case .responding: return "ellipsis.bubble.fill"
        case .speaking: return "speaker.wave.2.fill"
        case .typing: return "keyboard"
        }
    }

    private var stateColor: Color {
        switch entry.state {
        case .idle: return .gray
        case .listening: return .red
        case .transcribing: return .orange
        case .responding: return .blue
        case .speaking: return .purple
        case .typing: return .cyan
        }
    }
}
