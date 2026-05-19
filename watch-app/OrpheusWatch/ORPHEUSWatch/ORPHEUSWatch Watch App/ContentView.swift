//
//  ContentView.swift
//  ORPHEUSWatch Watch App
//
//  Created by Matt on 5/17/26.
//

import SwiftUI
import WatchKit
import WatchConnectivity
import Combine

struct ContentView: View {
    @StateObject private var watchSession = WatchSessionManager.shared
    @StateObject private var viewModel = WatchViewModel()
    @State private var showingHostInput = false
    @State private var hostText = ""
    @State private var tokenText = ""
    @State private var isTallScreen = false

    var body: some View {
        NavigationStack {
            GeometryReader { geo in
                VStack(spacing: isTallScreen ? 10 : 4) {
                    // Connection status
                    HStack {
                        Circle()
                            .fill(viewModel.connectionColor)
                            .frame(width: 6, height: 6)
                        Text(viewModel.connectionLabel)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                        Spacer()
                    }

                    // Avatar on tall screens, state pill on small
                    if isTallScreen {
                        DaemonAvatarView(
                            state: viewModel.daemonState,
                            intensity: viewModel.avatarIntensity,
                            isConnected: viewModel.isConnected
                        )
                        .frame(height: 70)
                        .padding(.vertical, 2)
                    } else {
                        StatePill(state: viewModel.daemonState)
                    }

                    Spacer(minLength: isTallScreen ? 6 : 2)

                    // Response display
                    responseDisplay
                        .frame(maxHeight: isTallScreen ? 100 : 60)

                    Spacer(minLength: isTallScreen ? 6 : 2)

                    // Error indicator
                    if let error = viewModel.connectionError {
                        Text(error)
                            .font(.caption2)
                            .foregroundColor(.red)
                            .lineLimit(1)
                    }

                    // Main action button
                    Button(action: handleMainAction) {
                        Image(systemName: mainButtonIcon)
                            .font(.system(size: isTallScreen ? 24 : 22, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(width: isTallScreen ? 52 : 46, height: isTallScreen ? 52 : 46)
                            .background(mainButtonColor)
                            .clipShape(Circle())
                    }
                    .buttonStyle(PlainButtonStyle())
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .onAppear {
                    isTallScreen = geo.size.height > 180
                }
            }
            .navigationTitle("ORPHEUS")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(action: { showingHostInput = true }) {
                        Image(systemName: "gear")
                            .font(.caption)
                    }
                }
            }
        }
        .sheet(isPresented: $showingHostInput) {
            HostInputView(host: $hostText, pairingToken: $tokenText, onSave: {
                viewModel.connect(to: hostText)
                showingHostInput = false
            })
        }
        .onAppear {
            watchSession.activate()
            tokenText = UserDefaults.standard.string(forKey: "orpheus_pairing_token") ?? ""
            if let savedHost = UserDefaults.standard.string(forKey: "orpheus_host"), !savedHost.isEmpty {
                hostText = savedHost
                viewModel.connect(to: savedHost)
            }
        }
        .onReceive(watchSession.$receivedHost.compactMap { $0 }) { host in
            hostText = host
            UserDefaults.standard.set(host, forKey: "orpheus_host")
            viewModel.connect(to: host)
        }
        .onReceive(watchSession.$receivedPairingToken.compactMap { $0 }) { token in
            tokenText = token
            UserDefaults.standard.set(token, forKey: "orpheus_pairing_token")
            if !hostText.isEmpty {
                viewModel.connect(to: hostText)
            }
        }
        .onReceive(watchSession.$relayEnvelopeData.compactMap { $0 }) { data in
            viewModel.processRelayedEnvelopeData(data)
        }
    }

    @ViewBuilder
    private var responseDisplay: some View {
        if !viewModel.lastResponse.isEmpty {
            ScrollView {
                Text(viewModel.lastResponse)
                    .font(.body)
                    .multilineTextAlignment(.leading)
            }
        } else if !viewModel.lastTranscription.isEmpty {
            Text(viewModel.lastTranscription)
                .font(.body)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.leading)
        } else {
            Text("Raise wrist and tap 🎙 to ask ORPHEUS")
                .font(.caption)
                .foregroundColor(.secondary)
                .multilineTextAlignment(.center)
        }
    }

    private var mainButtonIcon: String {
        if viewModel.isRecordingOnWatch {
            return "stop.fill"
        }
        switch viewModel.daemonState {
        case .listening:
            return "stop.fill"
        case .transcribing, .responding, .speaking:
            return "xmark"
        default:
            return "mic.fill"
        }
    }

    private var mainButtonColor: Color {
        if viewModel.isRecordingOnWatch {
            return .red
        }
        switch viewModel.daemonState {
        case .listening:
            return .red
        case .transcribing, .responding, .speaking:
            return .orange
        default:
            return .accentColor
        }
    }

    private func handleMainAction() {
        if viewModel.isRecordingOnWatch {
            viewModel.stopListening()
            return
        }

        switch viewModel.daemonState {
        case .transcribing, .responding, .speaking:
            viewModel.cancel()
        default:
            viewModel.startListening()
        }
    }
}

// MARK: - State Pill

struct StatePill: View {
    let state: DaemonState

    var body: some View {
        Text(stateLabel)
            .font(.caption2.bold())
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(stateColor.opacity(0.2))
            .foregroundColor(stateColor)
            .clipShape(Capsule())
    }

    private var stateLabel: String {
        switch state {
        case .idle: return "IDLE"
        case .listening: return "LISTENING"
        case .transcribing: return "TRANSCRIBING"
        case .responding: return "RESPONDING"
        case .speaking: return "SPEAKING"
        case .typing: return "TYPING"
        }
    }

    private var stateColor: Color {
        switch state {
        case .idle: return .gray
        case .listening: return .red
        case .transcribing: return .orange
        case .responding: return .blue
        case .speaking: return .purple
        case .typing: return .cyan
        }
    }
}

// MARK: - Host Input

struct HostInputView: View {
    @Binding var host: String
    @Binding var pairingToken: String
    let onSave: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section("Mac Address") {
                    TextField("IP or hostname", text: $host)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section("Pairing Token") {
                    SecureField("Optional", text: $pairingToken)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }
                Section {
                    Text("Enter your Mac's IP address and optional ORPHEUS_WATCH_TOKEN.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        UserDefaults.standard.set(host, forKey: "orpheus_host")
                        UserDefaults.standard.set(pairingToken, forKey: "orpheus_pairing_token")
                        onSave()
                    }
                }
            }
        }
    }
}

// MARK: - View Model

@MainActor
final class WatchViewModel: ObservableObject {
    @Published var isConnected = false
    @Published var daemonState: DaemonState = .idle
    @Published var lastTranscription = ""
    @Published var lastResponse = ""
    @Published var connectionError: String?
    @Published var avatarIntensity: Double = 0
    @Published var isRecordingOnWatch = false
    @Published var relayAvailable = false

    private var timerCancellable: AnyCancellable?
    private let client = WatchAPIClient.shared
    private let audioRecorder = WatchAudioRecorder()
    private let haptics = HapticsEngine()
    private var lastState: DaemonState = .idle
    private var intensityTarget: Double = 0

    func connect(to host: String) {
        client.connect(to: host)

        let c = client
        c.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.isConnected = $0 }
            .store(in: &cancellables)
        c.$daemonState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.handleStateChange($0) }
            .store(in: &cancellables)
        c.$lastTranscription
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.lastTranscription = $0 }
            .store(in: &cancellables)
        c.$lastResponse
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.lastResponse = $0 }
            .store(in: &cancellables)
        c.$connectionError
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.connectionError = $0 }
            .store(in: &cancellables)
        c.$relayAvailable
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.relayAvailable = $0 }
            .store(in: &cancellables)

        timerCancellable = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in self?.updateIntensity() }
    }

    var connectionLabel: String {
        if isConnected { return "Direct" }
        if relayAvailable || WatchSessionManager.shared.isReachable { return "iPhone Relay" }
        return "Disconnected"
    }

    var connectionColor: Color {
        if isConnected { return .green }
        if relayAvailable || WatchSessionManager.shared.isReachable { return .yellow }
        return .red
    }

    private func handleStateChange(_ newState: DaemonState) {
        daemonState = newState

        switch newState {
        case .idle:   intensityTarget = 0.1
        case .listening: intensityTarget = 0.4
        case .transcribing: intensityTarget = 0.6
        case .responding: intensityTarget = 0.8
        case .speaking: intensityTarget = 0.7
        case .typing: intensityTarget = 0.5
        }

        if lastState != newState {
            haptics.feedback(for: newState)
        }
        lastState = newState
    }

    private func updateIntensity() {
        let diff = intensityTarget - avatarIntensity
        avatarIntensity += diff * 0.1
    }

    func startListening() {
        guard isConnected else {
            guard WatchSessionManager.shared.isReachable else {
                connectionError = "Not connected"
                return
            }
            relayAvailable = true
            connectionError = nil
            startRelayRecording()
            return
        }

        startRelayRecording()
    }

    private func startRelayRecording() {
        lastTranscription = ""
        lastResponse = ""
        connectionError = nil
        isRecordingOnWatch = true
        handleStateChange(.listening)
        haptics.feedback(for: .listening)

        Task {
            do {
                try await audioRecorder.start()
            } catch {
                isRecordingOnWatch = false
                handleStateChange(client.daemonState)
                connectionError = error.localizedDescription
            }
        }
    }

    func stopListening() {
        guard isRecordingOnWatch else { return }

        do {
            let recording = try audioRecorder.stop()
            isRecordingOnWatch = false
            handleStateChange(.transcribing)
            client.sendAudio(recording)
        } catch {
            isRecordingOnWatch = false
            handleStateChange(client.daemonState)
            connectionError = error.localizedDescription
        }
    }

    func cancel() {
        if isRecordingOnWatch {
            audioRecorder.cancel()
            isRecordingOnWatch = false
            handleStateChange(client.daemonState)
            return
        }
        WatchSpeechSpeaker.shared.stop()
        client.cancel()
    }

    func processRelayedEnvelopeData(_ data: Data) {
        relayAvailable = true
        client.processRelayedEnvelopeData(data)
    }

    private var cancellables = Set<AnyCancellable>()
}

// MARK: - Haptics Engine

final class HapticsEngine {
    func feedback(for state: DaemonState) {
        let device = WKInterfaceDevice.current()
        switch state {
        case .listening:
            device.play(.start)
        case .transcribing:
            device.play(.click)
        case .responding:
            device.play(.success)
        case .speaking:
            device.play(.notification)
        case .idle:
            device.play(.stop)
        case .typing:
            device.play(.directionUp)
        }
    }
}

// MARK: - WatchConnectivity Manager

final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionManager()
    @Published var isReachable = false
    @Published var receivedHost: String?
    @Published var receivedPairingToken: String?
    @Published var relayEnvelopeData: Data?

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
        if let host = message["host"] as? String, !host.isEmpty {
            DispatchQueue.main.async {
                self.receivedHost = host
            }
        }
        if let token = message["pairingToken"] as? String {
            DispatchQueue.main.async {
                self.receivedPairingToken = token
            }
        }
        if let data = message["payloadData"] as? Data {
            DispatchQueue.main.async {
                self.relayEnvelopeData = data
            }
        }
    }

    func sendCommandThroughPhone(_ command: WatchCommand) -> Bool {
        guard WCSession.isSupported(), WCSession.default.isReachable else { return false }
        do {
            let envelope = WatchSocketMessage(
                id: UUID().uuidString,
                timestamp: Date().timeIntervalSince1970,
                payload: command
            )
            let data = try JSONEncoder().encode(envelope)
            WCSession.default.sendMessage(["commandData": data], replyHandler: nil, errorHandler: nil)
            return true
        } catch {
            return false
        }
    }
}
