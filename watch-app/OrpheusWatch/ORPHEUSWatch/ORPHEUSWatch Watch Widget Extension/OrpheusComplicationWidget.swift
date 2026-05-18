import WidgetKit
import SwiftUI

struct ComplicationProvider: TimelineProvider {
    func placeholder(in context: Context) -> ComplicationEntry {
        ComplicationEntry(date: Date(), state: "idle", responsePreview: "Ready")
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
        return ComplicationEntry(date: Date(), state: state, responsePreview: preview)
    }
}

struct ComplicationEntry: TimelineEntry {
    let date: Date
    let state: String
    let responsePreview: String

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
}

struct OrpheusComplicationWidget: Widget {
    let kind = "OrpheusComplicationWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: ComplicationProvider()) { entry in
            OrpheusComplicationView(entry: entry)
                .containerBackground(.clear, for: .widget)
        }
        .configurationDisplayName("ORPHEUS Status")
        .description("Shows daemon state at a glance.")
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
            Text(initials(state: entry.state))
                .font(.system(size: 14, weight: .semibold, design: .rounded))
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
            }
            Spacer()
        }
        .padding(.horizontal, 6)
    }

    private var inlineLayout: some View {
        Text("ORP • \(entry.state.capitalized)")
            .font(.system(size: 12, weight: .medium))
            .foregroundColor(entry.color)
    }

    private func initials(state: String) -> String {
        switch state {
        case "idle": return "O"
        case "listening": return "🎙"
        case "transcribing": return "✍️"
        case "responding": return "⚡"
        case "speaking": return "🔊"
        case "typing": return "💬"
        default: return "?"
        }
    }
}
