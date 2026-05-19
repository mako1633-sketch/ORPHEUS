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

    var body: some View {
        NavigationStack {
            List {
                Section("Connection") {
                    HStack {
                        Text("Apple Watch")
                        Spacer()
                        Circle()
                            .fill(session.isReachable ? Color.green : Color.red)
                            .frame(width: 12, height: 12)
                        Text(session.isReachable ? "Reachable" : "Not reachable")
                            .foregroundColor(.secondary)
                    }
                    HStack {
                        Text("Mac Relay")
                        Spacer()
                        Circle()
                            .fill(session.isMacConnected ? Color.green : Color.red)
                            .frame(width: 12, height: 12)
                        Text(session.isMacConnected ? "Connected" : "Offline")
                            .foregroundColor(.secondary)
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
            .onAppear {
                session.activate()
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
}

final class iOSWatchSession: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = iOSWatchSession()
    @Published var isReachable = false
    @Published var isMacConnected = false
    @Published var relayError: String?

    private var webSocketTask: URLSessionWebSocketTask?
    private lazy var urlSession = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    private var currentHost: String?

    private override init() { super.init() }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(
        _ session: WCSession,
        activationDidCompleteWith activationState: WCSessionActivationState,
        error: Error?
    ) {
        DispatchQueue.main.async { self.isReachable = session.isReachable }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { self.isReachable = session.isReachable }
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if let data = message["commandData"] as? Data {
            sendCommandDataToMac(data)
        }
    }

    func connectToMac(host: String) {
        currentHost = host
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        var components = URLComponents()
        components.scheme = "ws"
        components.host = host
        components.port = 8472
        components.path = "/ws"
        if let token = UserDefaults.standard.string(forKey: "orpheus_pairing_token"), !token.isEmpty {
            components.queryItems = [URLQueryItem(name: "token", value: token)]
        }
        guard let url = components.url else { return }
        webSocketTask = urlSession.webSocketTask(with: url)
        webSocketTask?.resume()
    }

    func sendHostToWatch(_ host: String, pairingToken: String) {
        guard WCSession.isSupported(), WCSession.default.isReachable else { return }
        WCSession.default.sendMessage(
            ["host": host, "pairingToken": pairingToken],
            replyHandler: nil,
            errorHandler: nil
        )
    }

    private func sendCommandDataToMac(_ data: Data) {
        guard isMacConnected else {
            relayError = "Mac relay is offline"
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
                    self.isMacConnected = false
                    self.relayError = error.localizedDescription
                }
            }
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
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        DispatchQueue.main.async {
            self.isMacConnected = false
            if let error {
                self.relayError = error.localizedDescription
            }
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
}
