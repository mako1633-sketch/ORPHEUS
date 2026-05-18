import Foundation
import Combine

/// Shared API client that talks to the ORPHEUS Mac server.
/// Used by both the iOS companion and watchOS app (via WatchConnectivity relay).
final class WatchAPIClient: ObservableObject {
    static let shared = WatchAPIClient()

    @Published var isConnected = false
    @Published var daemonState: DaemonState = .idle
    @Published var lastTranscription: String = ""
    @Published var lastResponse: String = ""
    @Published var connectionError: String?

    private var webSocketTask: URLSessionWebSocketTask?
    private var reconnectTimer: Timer?
    private let serverPort = 8472
    private var currentHost: String?
    private var sharedDefaults: UserDefaults? {
        UserDefaults(suiteName: "group.com.orpheus.watch")
    }

    /// Auto-discover the Mac on the local network.
    func connect(to host: String) {
        currentHost = host
        let url = URL(string: "ws://\(host):\(serverPort)/ws")!
        webSocketTask = URLSession.shared.webSocketTask(with: url)
        webSocketTask?.delegate = self
        webSocketTask?.resume()
    }

    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isConnected = false
        publishToComplications()
    }

    /// Send a command to the ORPHEUS server.
    func send(command: WatchCommand) {
        guard isConnected else {
            connectionError = "Not connected"
            return
        }

        let envelope = WatchSocketMessage(
            id: UUID().uuidString,
            timestamp: Date().timeIntervalSince1970,
            payload: command
        )

        do {
            let data = try JSONEncoder().encode(envelope)
            webSocketTask?.send(.data(data)) { [weak self] error in
                if let error = error {
                    self?.connectionError = error.localizedDescription
                }
            }
        } catch {
            connectionError = error.localizedDescription
        }
    }

    /// Query with streaming response via callback.
    func query(_ text: String, onFragment: @escaping (String, Bool) -> Void) {
        lastResponse = ""
        send(command: .query(text: text))

        // Set up a temporary handler for query responses
        // In production, this would be cleaner; for PoC we rely on the
        // existing WebSocket message loop calling onFragment when done arrives.
        // The intent uses polling on lastResponse instead.
    }

    func cancel() {
        send(command: .cancel)
    }

    func requestStatus() {
        send(command: .status)
    }

    func toggleListening() {
        send(command: .listen)
    }

    // MARK: - Complication Publishing

    private func publishToComplications() {
        sharedDefaults?.set(daemonState.rawValue, forKey: "daemon_state")
        sharedDefaults?.set(isConnected, forKey: "is_connected")
        sharedDefaults?.set(lastTranscription, forKey: "last_query")
        sharedDefaults?.set(0.0, forKey: "avatar_intensity")
        sharedDefaults?.synchronize()

        // Request widget timeline reload
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: "OrpheusComplicationWidget")
        #endif
    }

    private func handleMessage(_ data: Data) {
        do {
            let envelope = try JSONDecoder().decode(WatchSocketMessage<WatchResponse>.self, from: data)
            DispatchQueue.main.async { [weak self] in
                self?.processResponse(envelope.payload)
            }
        } catch {
            connectionError = "Decode error: \(error.localizedDescription)"
        }
    }

    private func processResponse(_ response: WatchResponse) {
        switch response {
        case .status(let state, let transcription, let response, _, _):
            daemonState = state
            if let t = transcription { lastTranscription = t }
            if let r = response { lastResponse = r }
            publishToComplications()
        case .query(let fragment, let done, _):
            if !fragment.isEmpty {
                lastResponse += fragment
            }
            if done {
                publishToComplications()
            }
        case .error(let message):
            connectionError = message
        default:
            break
        }
    }

    private func startListening() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .data(let data):
                    self.handleMessage(data)
                case .string(let text):
                    if let data = text.data(using: .utf8) {
                        self.handleMessage(data)
                    }
                @unknown default:
                    break
                }
                self.startListening()
            case .failure(let error):
                self.isConnected = false
                self.connectionError = error.localizedDescription
                self.publishToComplications()
                self.scheduleReconnect()
            }
        }
    }

    private func scheduleReconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { [weak self] _ in
            guard let self = self, let host = self.currentHost else { return }
            self.connect(to: host)
        }
    }
}

extension WatchAPIClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        DispatchQueue.main.async { [weak self] in
            self?.isConnected = true
            self?.connectionError = nil
            self?.publishToComplications()
            self?.startListening()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.isConnected = false
            if let error = error {
                self?.connectionError = error.localizedDescription
            }
            self?.publishToComplications()
            self?.scheduleReconnect()
        }
    }
}
