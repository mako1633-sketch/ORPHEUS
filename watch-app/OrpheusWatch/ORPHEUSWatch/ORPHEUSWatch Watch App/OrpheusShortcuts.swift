//
//  OrpheusShortcuts.swift
//  ORPHEUSWatch Watch App
//
//  Siri Shortcuts support. Requires App Intents framework.
//  Add to Info.plist: NSSiriUsageDescription
//

import AppIntents
import Foundation

@available(watchOS 10.0, *)
struct StartOrpheusVoiceIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Orpheus Voice"
    static var description = IntentDescription("Open ORPHEUS and start listening on Apple Watch")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        OrpheusLaunchRouter.queue(.listen)
        return .result(dialog: "Opening ORPHEUS.")
    }
}

@available(watchOS 10.0, *)
struct AskOrpheusIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Orpheus"
    static var description = IntentDescription("Ask ORPHEUS a question by voice or text")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Question", description: "What you want to ask ORPHEUS")
    var question: String

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let host = UserDefaults.standard.string(forKey: "orpheus_host"), !host.isEmpty else {
            throw IntentError.missingHost
        }

        let client = WatchAPIClient.shared
        client.connect(to: host)
        try await Task.sleep(nanoseconds: 500_000_000)

        var result = ""
        var isDone = false
        client.query(question) { fragment, done in
            result += fragment
            if done { isDone = true }
        }

        guard client.isConnected || client.relayAvailable else { throw IntentError.notConnected }

        for _ in 0..<120 {
            if isDone { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }

        return .result(value: result.isEmpty ? "No response" : result)
    }
}

@available(watchOS 10.0, *)
struct OrpheusStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Orpheus Status"
    static var description = IntentDescription("Check if ORPHEUS is online")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let host = UserDefaults.standard.string(forKey: "orpheus_host"), !host.isEmpty else {
            return .result(value: "Not configured. Set your Mac IP in the ORPHEUS watch app.")
        }

        let client = WatchAPIClient.shared
        client.connect(to: host)
        try await Task.sleep(nanoseconds: 500_000_000)

        if !client.isConnected {
            if WatchSessionManager.shared.isReachable {
                return .result(value: "ORPHEUS can use the iPhone relay. Open the watch app to ask by voice.")
            }
            return .result(value: "ORPHEUS is offline. Check your Mac is awake and the iPhone bridge is open.")
        }

        let label: String
        switch client.daemonState {
        case .idle:       label = "Idle and ready"
        case .listening:   label = "Listening"
        case .transcribing: label = "Transcribing"
        case .responding:   label = "Responding"
        case .speaking:     label = "Speaking"
        case .typing:       label = "Typing"
        }
        return .result(value: "ORPHEUS is \(label).")
    }
}

@available(watchOS 10.0, *)
struct OrpheusShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartOrpheusVoiceIntent(),
            phrases: [
                "Start \(.applicationName)",
                "Open \(.applicationName)",
                "Talk to \(.applicationName)",
            ],
            shortTitle: "Start Voice",
            systemImageName: "mic.circle.fill"
        )
        AppShortcut(
            intent: AskOrpheusIntent(),
            phrases: [
                "Ask \(.applicationName)",
                "Ask \(.applicationName) a question",
            ],
            shortTitle: "Ask Orpheus",
            systemImageName: "mic.fill"
        )
        AppShortcut(
            intent: OrpheusStatusIntent(),
            phrases: [
                "Check \(.applicationName) status",
                "Is \(.applicationName) online",
            ],
            shortTitle: "Status",
            systemImageName: "circle.fill"
        )
    }
}

enum IntentError: Error, CustomLocalizedStringResourceConvertible {
    case missingHost
    case notConnected

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .missingHost:
            return "ORPHEUS is not configured. Open the watch app and set your Mac's IP."
        case .notConnected:
            return "Cannot connect to your Mac. Make sure ORPHEUS is running and you're on the same Wi-Fi."
        }
    }
}
