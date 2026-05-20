import WidgetKit
import SwiftUI

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), state: "idle", responsePreview: "Ready", route: "disconnected")
    }

    func getSnapshot(in context: Context, completion: @escaping (ComplicationEntry) -> Void) {
        completion(readEntry())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<ComplicationEntry>) -> Void) {
        let entry = readEntry()
        let nextUpdate = Calendar.current.date(byAdding: .minute, value: 15, to: entry.date)!
        completion(Timeline(entries: [entry], policy: .after(nextUpdate)))
    }

    private func readEntry() -> ComplicationEntry {
        let shared = UserDefaults(suiteName: "group.com.yourcompany.OrpheusWatch")
        let state = shared?.string(forKey: "daemonState") ?? "idle"
        let preview = shared?.string(forKey: "lastResponsePreview") ?? "Ready"
        let route = shared?.string(forKey: "connectionRoute") ?? "disconnected"
        return ComplicationEntry(date: Date(), state: state, responsePreview: preview, route: route)
    }
}

struct ComplicationEntry: TimelineEntry {
    let date: Date
    let state: String
    let responsePreview: String
    let route: String

    var color: Color {
        switch state {
        case "listening": return .red
        case "transcribing": return .orange
        case "responding": return .blue
        case "speaking": return .purple
        case "typing": return .cyan
        default: return .gray
        }
    }

    var routeLabel: String {
        switch route {
        case "direct": return "Direct"
        case "relay": return "Relay"
        default: return "Offline"
        }
    }

    var symbolName: String {
        switch state {
        case "listening": return "mic.fill"
        case "transcribing": return "waveform"
        case "responding": return "sparkles"
        case "speaking": return "speaker.wave.2.fill"
        case "typing": return "keyboard"
        default: return "circle.fill"
        }
    }
}

struct OrpheusComplicationWidget: Widget {
    let kind = "OrpheusComplicationWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ComplicationProvider()) { entry in
            OrpheusComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
                .widgetURL(URL(string: "orpheuswatch://listen"))
        }
        .configurationDisplayName("ORPHEUS Status")
        .description("Shows daemon state and connection route at a glance.")
        .supportedFamilies([
            .accessoryCircular,
            .accessoryRectangular,
            .accessoryInline,
            .accessoryCorner,
        ])
    }
}

struct OrpheusComplicationView: View {
    let entry: ComplicationEntry
    @Environment(\.widgetFamily) var family

    var body: some View {
        switch family {
        case .accessoryCircular:
            circularLayout
        case .accessoryRectangular:
            rectangularLayout
        case .accessoryInline, .accessoryCorner:
            inlineLayout
        default:
            circularLayout
        }
    }

    private var circularLayout: some View {
        ZStack {
            Circle()
                .stroke(entry.color.opacity(0.4), lineWidth: 3)
                .frame(width: 44, height: 44)
            Circle()
                .fill(entry.color.opacity(0.15))
                .frame(width: 34, height: 34)
            Image(systemName: entry.symbolName)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(entry.color)
        }
    }

    private var rectangularLayout: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(entry.color)
                .frame(width: 8, height: 8)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.state.capitalized)
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
                Text(entry.responsePreview)
                    .font(.system(size: 9))
                    .foregroundColor(.gray)
                    .lineLimit(1)
                Text(entry.routeLabel)
                    .font(.system(size: 8, weight: .medium))
                    .foregroundColor(entry.color)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 6)
    }

    private var inlineLayout: some View {
        Text("ORP • \(entry.state.capitalized) • \(entry.routeLabel)")
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(entry.color)
    }
}
