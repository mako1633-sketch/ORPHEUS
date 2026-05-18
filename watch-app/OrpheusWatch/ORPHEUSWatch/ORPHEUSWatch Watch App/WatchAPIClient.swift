//
//  WatchAPIClient.swift
//  ORPHEUSWatch
//
//  Shared WebSocket client connecting to the ORPHEUS Mac server.
//

import Foundation
import Combine

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
    private let sharedDefaults: UserDefaults? = UserDefaults(suiteName: "group.com.yourcompany.OrpheusWatch")

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
    }

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
                    DispatchQueue.main.async { self?.connectionError = error.localizedDescription }
                }
            }
        } catch {
            connectionError = error.localizedDescription
        }
    }

    func query(_ text: String, onFragment: ((String, Bool) -> Void)? = nil) {
        send(command: .query(text: text))
    }

    func cancel()  { send(command: .cancel) }
    func requestStatus() { send(command: .status) }
    func toggleListening() { send(command: .listen) }

    // MARK: - Message handling

    private func handleMessage(_ data: Data) {
        do {
            let envelope = try JSONDecoder().decode(
                WatchSocketMessage<WatchResponse>.self, from: data
            )
            DispatchQueue.main.async { [weak self] in
                self?.processResponse(envelope.payload)
            }
        } catch {
            DispatchQueue.main.async { [weak self] in
                self?.connectionError = "Decode error: \(error.localizedDescription)"
            }
        }
    }

    private func processResponse(_ response: WatchResponse) {
        switch response {
        case .status(let s, let t, let r, _, _):
            daemonState = s
            if let t = t { lastTranscription = t }
            if let r = r { lastResponse = r }
            syncToSharedDefaults(state: s, preview: r ?? lastResponse)
        case .query(let f, let done, _):
            if !f.isEmpty {
                lastResponse += f
                syncToSharedDefaults(state: daemonState, preview: lastResponse)
            }
        case .error(let msg):
            connectionError = msg
        default:
            break
        }
    }

    private func syncToSharedDefaults(state: DaemonState, preview: String) {
        sharedDefaults?.set(state.rawValue, forKey: "daemonState")
        sharedDefaults?.set(String(preview.prefix(120)), forKey: "lastResponsePreview")
        WidgetCenter.shared.reloadAllTimelines()
    }

    private func startListening() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }
            switch result {
            case .success(let message):
                switch message {
                case .data(let data):   self.handleMessage(data)
                case .string(let text):
                    if let d = text.data(using: .utf8) { self.handleMessage(d) }
                @unknown default:
                    break
                }
                self.startListening()
            case .failure(let error):
                DispatchQueue.main.async {
                    self.isConnected = false
                    self.connectionError = error.localizedDescription
                }
                self.scheduleReconnect()
            }
        }
    }

    private func scheduleReconnect() {
        reconnectTimer?.invalidate()
        guard let host = currentHost else { return }
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: false) { [weak self] _ in
            self?.connect(to: host)
        }
    }
}

// MARK: - WebSocket Delegate

extension WatchAPIClient: URLSessionWebSocketDelegate {
    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        DispatchQueue.main.async { [weak self] in
            self?.isConnected = true
            self?.connectionError = nil
            self?.startListening()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.isConnected = false
            if let error = error {
                self?.connectionError = error.localizedDescription
            }
            self?.scheduleReconnect()
        }
    }
}
