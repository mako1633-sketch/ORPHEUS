//
//  BridgeView.swift
//  ORPHEUSWatch
//
//  iOS companion that shows Watch connectivity and lets the user set the Mac IP.
//

import SwiftUI
import WatchConnectivity
import Combine
import Foundation

struct BridgeView: View {
    @StateObject private var session = iOSWatchSession.shared
    @StateObject private var discovery = OrpheusBonjourBrowser()
    @State private var hostText = ""
    @State private var tokenText = ""
    @State private var setupCode = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Setup") {
                    checklistRow("Mac found", isOn: !discovery.services.isEmpty || !hostText.isEmpty)
                    checklistRow("Relay connected", isOn: session.isMacConnected)
                    checklistRow("Watch paired", isOn: session.isPaired)
                    checklistRow("Watch app installed", isOn: session.isWatchAppInstalled)
                    checklistRow("Watch reachable", isOn: session.isReachable)
                    checklistRow("Settings sent", isOn: session.didSendSettingsToWatch)

                    if let error = session.relayError {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                    }
                }
                Section("Discovered Macs") {
                    if discovery.services.isEmpty {
                        Text("Searching for ORPHEUS...")
                            .foregroundColor(.secondary)
                    } else {
                        ForEach(discovery.services) { service in
                            Button {
                                hostText = service.host
                                saveHost()
                            } label: {
                                VStack(alignment: .leading) {
                                    Text(service.name)
                                    Text("\(service.host):\(service.port)")
                                        .font(.caption)
                                        .foregroundColor(.secondary)
                                }
                            }
                        }
                    }
                }
                Section("Pairing Code") {
                    TextField("Paste setup code", text: $setupCode)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit { applySetupCode() }
                    Button("Apply Code") { applySetupCode() }
                }
                Section("Mac Address") {
                    TextField("IP or hostname", text: $hostText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit {
                            saveHost()
                        }
                    Button("Connect") { saveHost() }
                }
                Section("Pairing Token") {
                    SecureField("Optional ORPHEUS_WATCH_TOKEN", text: $tokenText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save Token") { saveHost() }
                }
                Section {
                    Text("Enter your Mac address and optional pairing token. Both are sent to Apple Watch for direct and relay connections.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("ORPHEUS Bridge")
            .refreshable {
                session.refreshWatchState()
            }
            .onAppear {
                session.activate()
                session.refreshWatchState()
                discovery.start()
                tokenText = UserDefaults.standard.string(forKey: "orpheus_pairing_token") ?? ""
                if let savedHost = UserDefaults.standard.string(forKey: "orpheus_host") {
                    hostText = savedHost
                    session.connectToMac(host: savedHost)
                }
            }
            .onDisappear {
                discovery.stop()
            }
            .onChange(of: discovery.services) { _, services in
                guard hostText.isEmpty, let first = services.first else { return }
                hostText = first.host
                saveHost()
            }
        }
    }

    private func checklistRow(_ title: String, isOn: Bool) -> some View {
        HStack {
            Image(systemName: isOn ? "checkmark.circle.fill" : "circle")
                .foregroundColor(isOn ? .green : .secondary)
            Text(title)
            Spacer()
        }
    }

    private func saveHost() {
        let trimmed = hostText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let token = tokenText.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(trimmed, forKey: "orpheus_host")
        UserDefaults.standard.set(token, forKey: "orpheus_pairing_token")
        session.connectToMac(host: trimmed)
        session.sendHostToWatch(trimmed, pairingToken: token)
    }

    private func applySetupCode() {
        guard let parsed = PairingCode.parse(setupCode) else {
            session.relayError = "Pairing code not recognized"
            return
        }
        hostText = parsed.host
        tokenText = parsed.token
        saveHost()
    }
}

final class iOSWatchSession: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = iOSWatchSession()
    @Published var isReachable = false
    @Published var isPaired = false
    @Published var isWatchAppInstalled = false
    @Published var isMacConnected = false
    @Published var relayError: String?
    @Published var didSendSettingsToWatch = false

    private var webSocketTask: URLSessionWebSocketTask?
    private lazy var urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    private var currentHost: String?
    private var reconnectTimer: Timer?
    private var queuedCommandData: [Data] = []
    private var intentionallyClosedTaskIds = Set<Int>()
    private var connectGeneration = 0

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else {
            relayError = "WatchConnectivity is not supported on this device"
            return
        }
        WCSession.default.delegate = self
        WCSession.default.activate()
        refreshWatchState()
    }

    func refreshWatchState() {
        guard WCSession.isSupported() else {
            isPaired = false
            isWatchAppInstalled = false
            isReachable = false
            return
        }

        let session = WCSession.default
        isPaired = session.isPaired
        isWatchAppInstalled = session.isWatchAppInstalled
        isReachable = session.isReachable
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async {
            self.refreshWatchState()
            if let error {
                self.relayError = error.localizedDescription
            }
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.refreshWatchState() }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let data = message["commandData"] as? Data {
            sendCommandDataToMac(data)
        }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if let data = userInfo["commandData"] as? Data {
            sendCommandDataToMac(data)
        }
    }

    func connectToMac(host: String) {
        let token = UserDefaults.standard.string(forKey: "orpheus_pairing_token") ?? ""
        currentHost = host
        reconnectTimer?.invalidate()
        connectGeneration += 1
        let generation = connectGeneration
        if let webSocketTask {
            intentionallyClosedTaskIds.insert(webSocketTask.taskIdentifier)
            webSocketTask.cancel(with: .normalClosure, reason: nil)
        }
        relayError = "Checking Mac relay..."
        preflightMac(host: host, token: token) { [weak self] result in
            DispatchQueue.main.async {
                guard let self, generation == self.connectGeneration else { return }
                switch result {
                case .success:
                    self.openMacSocket(host: host, token: token)
                case .failure(let error):
                    self.isMacConnected = false
                    self.relayError = error.localizedDescription
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func openMacSocket(host: String, token: String) {
        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = 8472
        components.path = "/ws"
        if !token.isEmpty {
            components.queryItems = [URLQueryItem(name: "token", value: token)]
        }
        guard let url = components.url else {
            relayError = "Mac address is invalid"
            return
        }
        relayError = "Connecting to Mac..."
        webSocketTask = urlSession.webSocketTask(with: url)
        webSocketTask?.resume()
    }

    private func preflightMac(
        host: String,
        token: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        var healthComponents = URLComponents()
        healthComponents.scheme = "http"
        healthComponents.host = host
        healthComponents.port = 8472
        healthComponents.path = "/health"
        guard let healthURL = healthComponents.url else {
            completion(.failure(BridgeRelayError.invalidHost))
            return
        }

        URLSession.shared.dataTask(with: healthURL) { data, response, error in
            if let error {
                completion(.failure(Self.preflightError(from: error)))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse,
                  (200..<300).contains(httpResponse.statusCode),
                  let data else {
                completion(.failure(BridgeRelayError.macUnavailable))
                return
            }

            let requiresToken = Self.healthRequiresToken(from: data)
            if requiresToken && token.isEmpty {
                completion(.failure(BridgeRelayError.pairingTokenRequired))
                return
            }

            guard requiresToken else {
                completion(.success(()))
                return
            }

            Self.validateStatus(host: host, token: token, completion: completion)
        }.resume()
    }

    private static func validateStatus(
        host: String,
        token: String,
        completion: @escaping (Result<Void, Error>) -> Void
    ) {
        var components = URLComponents()
        components.scheme = "http"
        components.host = host
        components.port = 8472
        components.path = "/api/status"
        components.queryItems = [URLQueryItem(name: "token", value: token)]
        guard let url = components.url else {
            completion(.failure(BridgeRelayError.invalidHost))
            return
        }

        URLSession.shared.dataTask(with: url) { _, response, error in
            if let error {
                completion(.failure(preflightError(from: error)))
                return
            }

            guard let httpResponse = response as? HTTPURLResponse else {
                completion(.failure(BridgeRelayError.macUnavailable))
                return
            }

            switch httpResponse.statusCode {
            case 200..<300:
                completion(.success(()))
            case 401:
                completion(.failure(BridgeRelayError.pairingTokenRejected))
            default:
                completion(.failure(BridgeRelayError.macUnavailable))
            }
        }.resume()
    }

    func sendHostToWatch(_ host: String, pairingToken: String) {
        guard WCSession.isSupported() else { return }
        refreshWatchState()
        guard isPaired else {
            relayError = "No paired Apple Watch found"
            didSendSettingsToWatch = false
            return
        }
        guard isWatchAppInstalled else {
            relayError = "Install ORPHEUS on Apple Watch, then open it once"
            didSendSettingsToWatch = false
            return
        }
        let payload = ["host": host, "pairingToken": pairingToken]
        do {
            try WCSession.default.updateApplicationContext(payload)
            didSendSettingsToWatch = true
        } catch {
            relayError = Self.describeWatchConnectivity(error: error)
            didSendSettingsToWatch = false
        }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(payload, replyHandler: nil) { [weak self] error in
                DispatchQueue.main.async {
                    self?.relayError = Self.describeWatchConnectivity(error: error)
                }
            }
        } else {
            WCSession.default.transferUserInfo(payload)
        }
    }

    private func sendCommandDataToMac(_ data: Data) {
        guard isMacConnected else {
            queuedCommandData.append(data)
            relayError = currentHost == nil ? "Mac is not configured" : "Mac relay is reconnecting"
            if let currentHost {
                connectToMac(host: currentHost)
            }
            return
        }
        webSocketTask?.send(.data(data)) { [weak self] error in
            if let error {
                DispatchQueue.main.async {
                    self?.relayError = error.localizedDescription
                }
            }
        }
    }

    private func shouldIgnoreClose(for task: URLSessionTask, error: Error?) -> Bool {
        if intentionallyClosedTaskIds.remove(task.taskIdentifier) != nil {
            return true
        }
        let nsError = error as NSError?
        return nsError?.domain == NSURLErrorDomain && nsError?.code == NSURLErrorCancelled
    }

    private func flushQueuedCommands() {
        guard isMacConnected else { return }
        let commands = queuedCommandData
        queuedCommandData.removeAll()
        for data in commands {
            sendCommandDataToMac(data)
        }
    }

    private func receiveFromMac() {
        webSocketTask?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                let data: Data?
                switch message {
                case .data(let receivedData):
                    data = receivedData
                case .string(let text):
                    data = text.data(using: .utf8)
                @unknown default:
                    data = nil
                }

                if let data, WCSession.isSupported(), WCSession.default.isReachable {
                    WCSession.default.sendMessage(["payloadData": data], replyHandler: nil, errorHandler: nil)
                }
                self.receiveFromMac()
            case .failure(let error):
                DispatchQueue.main.async {
                    guard !Self.isCancelled(error) else { return }
                    self.isMacConnected = false
                    self.relayError = Self.isSocketClose(error)
                        ? "Mac relay reconnecting..."
                        : Self.describe(error: error)
                    self.scheduleReconnect()
                }
            }
        }
    }

    private func scheduleReconnect() {
        reconnectTimer?.invalidate()
        guard let currentHost else { return }
        reconnectTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: false) { [weak self] _ in
            self?.connectToMac(host: currentHost)
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {}
}

extension iOSWatchSession: URLSessionWebSocketDelegate {
    func urlSession(
        _ session: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didOpenWithProtocol protocol: String?
    ) {
        DispatchQueue.main.async {
            self.isMacConnected = true
            self.relayError = nil
            self.receiveFromMac()
            self.flushQueuedCommands()
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async {
            guard !self.shouldIgnoreClose(for: task, error: error) else { return }
            self.isMacConnected = false
            if let error {
                self.relayError = Self.isSocketClose(error)
                    ? "Mac relay reconnecting..."
                    : Self.describe(error: error)
            }
            self.scheduleReconnect()
        }
    }

    private static func isCancelled(_ error: Error) -> Bool {
        let nsError = error as NSError
        return nsError.domain == NSURLErrorDomain && nsError.code == NSURLErrorCancelled
    }

    private static func isSocketClose(_ error: Error) -> Bool {
        error.localizedDescription.localizedCaseInsensitiveContains("socket")
    }

    private static func healthRequiresToken(from data: Data) -> Bool {
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return object["requiresPairingToken"] as? Bool ?? false
    }

    private static func preflightError(from error: Error) -> Error {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut:
                return BridgeRelayError.macUnavailable
            case NSURLErrorNotConnectedToInternet:
                return BridgeRelayError.phoneOffline
            default:
                break
            }
        }
        return error
    }

    private static func describe(error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorCannotConnectToHost, NSURLErrorNetworkConnectionLost:
                return "Mac server is offline or blocked"
            case NSURLErrorUserAuthenticationRequired:
                return "Pairing token rejected"
            case NSURLErrorNotConnectedToInternet:
                return "iPhone is offline"
            case NSURLErrorCancelled:
                return "Mac relay is reconnecting"
            default:
                break
            }
        }
        if isSocketClose(error) {
            return "Mac relay reconnecting..."
        }
        return error.localizedDescription
    }

    private static func describeWatchConnectivity(error: Error) -> String {
        let nsError = error as NSError
        if nsError.domain == WCError.errorDomain {
            switch WCError.Code(rawValue: nsError.code) {
            case .deviceNotPaired:
                return "No paired Apple Watch found"
            case .watchAppNotInstalled:
                return "Install ORPHEUS on Apple Watch, then open it once"
            case .notReachable:
                return "Open ORPHEUS on Apple Watch to receive settings now"
            case .payloadUnsupportedTypes:
                return "Watch settings payload is unsupported"
            default:
                break
            }
        }
        return error.localizedDescription
    }
}

private enum BridgeRelayError: LocalizedError {
    case invalidHost
    case macUnavailable
    case pairingTokenRequired
    case pairingTokenRejected
    case phoneOffline

    var errorDescription: String? {
        switch self {
        case .invalidHost:
            return "Mac address is invalid"
        case .macUnavailable:
            return "Mac server is offline or blocked"
        case .pairingTokenRequired:
            return "Pairing token required"
        case .pairingTokenRejected:
            return "Pairing token rejected"
        case .phoneOffline:
            return "iPhone is offline"
        }
    }
}

struct OrpheusBonjourService: Identifiable, Equatable {
    let id: String
    let name: String
    let host: String
    let port: Int
}

final class OrpheusBonjourBrowser: NSObject, ObservableObject, NetServiceBrowserDelegate, NetServiceDelegate {
    @Published var services: [OrpheusBonjourService] = []

    private let browser = NetServiceBrowser()
    private var resolving: [NetService] = []

    override init() {
        super.init()
        browser.delegate = self
    }

    func start() {
        browser.searchForServices(ofType: "_orpheus-watch._tcp.", inDomain: "local.")
    }

    func stop() {
        browser.stop()
        resolving.removeAll()
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didFind service: NetService, moreComing: Bool) {
        service.delegate = self
        resolving.append(service)
        service.resolve(withTimeout: 5)
    }

    func netServiceDidResolveAddress(_ sender: NetService) {
        guard let host = sender.hostName?.trimmingCharacters(in: CharacterSet(charactersIn: ".")) else {
            return
        }

        let item = OrpheusBonjourService(
            id: "\(sender.name)-\(host)-\(sender.port)",
            name: sender.name,
            host: host,
            port: sender.port
        )
        DispatchQueue.main.async {
            if !self.services.contains(item) {
                self.services.append(item)
            }
        }
    }

    func netServiceBrowser(_ browser: NetServiceBrowser, didRemove service: NetService, moreComing: Bool) {
        DispatchQueue.main.async {
            self.services.removeAll { $0.name == service.name }
        }
    }
}
