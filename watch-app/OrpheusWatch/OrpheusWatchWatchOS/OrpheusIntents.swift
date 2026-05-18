import AppIntents
import Foundation

// MARK: - Ask Orpheus Intent

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

        // Wait briefly for connection
        try await Task.sleep(nanoseconds: 500_000_000)

        guard client.isConnected else {
            throw IntentError.notConnected
        }

        var result = ""
        var isDone = false

        client.query(question) { fragment, done in
            result += fragment
            if done { isDone = true }
        }

        // Wait for response (with timeout)
        for _ in 0..<120 {
            if isDone { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }

        return .result(value: result.isEmpty ? "No response received" : result)
    }
}

// MARK: - Orpheus Status Intent

struct OrpheusStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Check Orpheus Status"
    static var description = IntentDescription("Check if ORPHEUS is online and what it's doing")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let host = UserDefaults.standard.string(forKey: "orpheus_host"), !host.isEmpty else {
            return .result(value: "ORPHEUS is not configured. Open the watch app and set your Mac's IP.")
        }

        let client = WatchAPIClient.shared
        client.connect(to: host)
        try await Task.sleep(nanoseconds: 500_000_000)

        let state = client.daemonState
        let connected = client.isConnected

        let statusText: String
        if !connected {
            statusText = "ORPHEUS is offline. Your Mac may be asleep or unreachable."
        } else {
            switch state {
            case .idle:
                statusText = "ORPHEUS is idle and ready."
            case .listening:
                statusText = "ORPHEUS is listening for voice input."
            case .transcribing:
                statusText = "ORPHEUS is transcribing your speech."
            case .responding:
                statusText = "ORPHEUS is working on a response."
            case .speaking:
                statusText = "ORPHEUS is speaking the response."
            case .typing:
                statusText = "ORPHEUS is typing."
            }
        }

        return .result(value: statusText)
    }
}

// MARK: - Orpheus Command Intent

struct OrpheusCommandIntent: AppIntent {
    static var title: LocalizedStringResource = "Run Orpheus Command"
    static var description = IntentDescription("Send a quick command to ORPHEUS: commit, test, status, etc.")
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Command", description: "The command to run")
    var command: CommandChoice

    enum CommandChoice: String, AppEnum {
        case commit = "commit"
        case test = "test"
        case status = "status"
        case deploy = "deploy"
        case lint = "lint"
        case build = "build"

        static var typeDisplayRepresentation: TypeDisplayRepresentation {
            TypeDisplayRepresentation(name: "Command")
        }

        static var caseDisplayRepresentations: [CommandChoice: DisplayRepresentation] = [
            .commit: DisplayRepresentation(title: "Commit and push code"),
            .test: DisplayRepresentation(title: "Run test suite"),
            .status: DisplayRepresentation(title: "Check system status"),
            .deploy: DisplayRepresentation(title: "Deploy to production"),
            .lint: DisplayRepresentation(title: "Run linter"),
            .build: DisplayRepresentation(title: "Build project"),
        ]
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<String> {
        guard let host = UserDefaults.standard.string(forKey: "orpheus_host"), !host.isEmpty else {
            throw IntentError.missingHost
        }

        let client = WatchAPIClient.shared
        client.connect(to: host)
        try await Task.sleep(nanoseconds: 500_000_000)

        guard client.isConnected else {
            throw IntentError.notConnected
        }

        let prompt: String
        switch command {
        case .commit:
            prompt = "Commit all changes with a good message and push to origin"
        case .test:
            prompt = "Run the test suite and report results"
        case .status:
            prompt = "Check system status: memory, git state, and pending tasks"
        case .deploy:
            prompt = "Run the production deployment workflow"
        case .lint:
            prompt = "Run the linter and report any issues"
        case .build:
            prompt = "Build the project and report success or failures"
        }

        var result = ""
        var isDone = false

        client.query(prompt) { fragment, done in
            result += fragment
            if done { isDone = true }
        }

        for _ in 0..<120 {
            if isDone { break }
            try await Task.sleep(nanoseconds: 500_000_000)
        }

        return .result(value: result.isEmpty ? "Command sent" : result)
    }
}

// MARK: - App Shortcuts Provider

struct OrpheusShortcutsProvider: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        return [
            AppShortcut(
                intent: AskOrpheusIntent(),
                phrases: [
                    "Ask Orpheus \(.question)",
                    "Orpheus, \(.question)",
                    "Hey Orpheus, \(.question)",
                ],
                shortTitle: "Ask Orpheus",
                systemImageName: "mic.fill"
            ),
            AppShortcut(
                intent: OrpheusStatusIntent(),
                phrases: [
                    "Check Orpheus status",
                    "What's Orpheus doing",
                    "Is Orpheus online",
                ],
                shortTitle: "Status",
                systemImageName: "circle.fill"
            ),
            AppShortcut(
                intent: OrpheusCommandIntent(),
                phrases: [
                    "Orpheus, \(.command)",
                    "Run \(.command) with Orpheus",
                    "Tell Orpheus to \(.command)",
                ],
                shortTitle: "Run Command",
                systemImageName: "terminal.fill"
            ),
        ]
    }
}

// MARK: - Error Types

enum IntentError: Error, CustomLocalizedStringResourceConvertible {
    case missingHost
    case notConnected

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .missingHost:
            return "ORPHEUS is not configured. Open the watch app and set your Mac's IP address."
        case .notConnected:
            return "Cannot connect to your Mac. Make sure ORPHEUS is running and you're on the same Wi-Fi network."
        }
    }
}
