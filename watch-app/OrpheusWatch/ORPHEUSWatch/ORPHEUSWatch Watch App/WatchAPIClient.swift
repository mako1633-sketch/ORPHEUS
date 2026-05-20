//
//  WatchAPIClient.swift
//  ORPHEUSWatch
//
//  Shared WebSocket client connecting to the ORPHEUS Mac server.
//

import Foundation
import Combine
import WidgetKit

final class WatchAPIClient: NSObject, ObservableObject {
    static let shared = WatchAPIClient()

    @Published var isConnected = false
    @Published var daemonState: DaemonState = .idle
    @Published var lastTranscription: String = ""
    @Published var lastResponse: String = ""
    @Published var connectionError: String?
    @Published var relayAvailable = false
    @Published var activeRoute: WatchConnectionRoute = .disconnected

    private var webSocketTask: URLSessionWebSocketTask?
    private var reconnectTimer: Timer?
    private let serverPort = 8472
    private var currentHost: String?
    private lazy var urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    private var queryFragmentHandler: ((String, Bool) -> Void)?
    private let sharedDefaults: UserDefaults? = UserDefaults(suiteName: "group.com.yourcompany.OrpheusWatch")
    private var intentionallyClosedTaskIds = Set<Int>()

    private override init() {
        super.init()
    }

    func connect(to host: String) {
        disconnect()
        currentHost = host
        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = serverPort
        components.path = "/ws"
        if let token = UserDefaults.standard.string(forKey: "orpheus_pairing_token"), !token.isEmpty {
            components.queryItems = [URLQueryItem(name: "token", value: token)]
        }
        guard let url = components.url else {
            connectionError = "Invalid Mac address"
            return
        }
        connectionError = "Connecting to Mac..."
        webSocketTask = urlSession.webSocketTask(with: url)
        webSocketTask?.resume()
    }

    func disconnect() {
        reconnectTimer?.invalidate()
        reconnectTimer = nil
        if let webSocketTask {
            intentionallyClosedTaskIds.insert(webSocketTask.taskIdentifier)
            webSocketTask.cancel(with: .normalClosure, reason: nil)
        }
        webSocketTask = nil
        isConnected = false
        activeRoute = .disconnected
    }

    @discardableResult
    func send(command: WatchCommand) -> Bool {
        guard isConnected else {
            if WatchSessionManager.shared.sendCommandThroughPhone(command) {
                relayAvailable = true
                activeRoute = .relay
                connectionError = nil
                return true
            }
            connectionError = WatchSessionManager.shared.isReachable
                ? "iPhone relay is not ready"
                : "Open the iPhone bridge or connect to your Mac"
            activeRoute = .disconnected
            return false
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
                    DispatchQueue.main.async { self?.connectionError = Self.describe(error: error) }
                }
            }
        } catch {
            connectionError = error.localizedDescription
            return false
        }
        return true
    }

    func query(_ text: String, onFragment: ((String, Bool) -> Void)? = nil) {
        lastResponse = ""
        queryFragmentHandler = onFragment
        send(command: .query(text: text))
    }

    func sendAudio(_ recording: WatchAudioRecording) {
        lastResponse = ""
        lastTranscription = ""
        _ = send(command: .audio(
            audioBase64: recording.data.base64EncodedString(),
            mimeType: recording.mimeType,
            duration: recording.duration
        ))
    }

    func cancel()  { _ = send(command: .cancel) }
    func requestStatus() { _ = send(command: .status) }
    func toggleListening() { _ = send(command: .listen) }

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
            syncToSharedDefaults(state: s, preview: r ?? lastResponse, route: activeRoute)
        case .query(let f, let done, _):
            if !f.isEmpty {
                lastResponse += f
                syncToSharedDefaults(state: daemonState, preview: lastResponse, route: activeRoute)
            }
            queryFragmentHandler?(f, done)
            if done {
                WatchSpeechSpeaker.shared.speak(lastResponse)
                queryFragmentHandler = nil
            }
        case .error(let msg):
            connectionError = msg
            queryFragmentHandler?("", true)
            queryFragmentHandler = nil
            if msg.localizedCaseInsensitiveContains("unauthorized") {
                connectionError = "Pairing token rejected"
            }
        default:
            break
        }
    }

    func processRelayedEnvelopeData(_ data: Data) {
        handleMessage(data)
    }

    private func syncToSharedDefaults(state: DaemonState, preview: String, route: WatchConnectionRoute) {
        sharedDefaults?.set(state.rawValue, forKey: "daemonState")
        sharedDefaults?.set(String(preview.prefix(120)), forKey: "lastResponsePreview")
        sharedDefaults?.set(route.rawValue, forKey: "connectionRoute")
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
                    guard !Self.isCancelled(error) else { return }
                    self.isConnected = false
                    self.activeRoute = WatchSessionManager.shared.isReachable ? .relay : .disconnected
                    self.connectionError = Self.describe(error: error)
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
            self?.relayAvailable = false
            self?.activeRoute = .direct
            self?.connectionError = nil
            self?.startListening()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard !self.shouldIgnoreClose(for: task, error: error) else { return }
            self.isConnected = false
            self.activeRoute = WatchSessionManager.shared.isReachable ? .relay : .disconnected
            if let error = error {
                self.connectionError = Self.describe(error: error)
            }
            self.scheduleReconnect()
        }
    }

    private func shouldIgnoreClose(for task: URLSessionTask, error: Error?) -> Bool {
        if intentionallyClosedTaskIds.remove(task.taskIdentifier) != nil {
            return true
        }
        let nsError = error as NSError?
        return nsError?.domain == NSURLErrorDomain && nsError?.code == NSURLErrorCancelled
    }

    private static func isCancelled(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private static func describe(error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorCannotConnectToHost:
                return "Mac server is not reachable"
            case NSURLErrorNetworkConnectionLost:
                return "Connection dropped"
            case NSURLErrorNotConnectedToInternet:
                return "Watch is offline"
            case NSURLErrorUserAuthenticationRequired:
                return "Pairing token rejected"
            case NSURLErrorCancelled:
                return "Connection is reconnecting"
            default:
                break
            }
        }
        if error.localizedDescription.localizedCaseInsensitiveContains("socket") {
            return "Connection closed; reconnecting"
        }
        return error.localizedDescription
    }
}
