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
    @State private var holdGestureActive = false
    @State private var holdRecordingStarted = false
    @State private var pendingLaunchAction: OrpheusLaunchAction?
    @State private var pendingLaunchAttempts = 0
    @AppStorage("orpheus_watch_speak_replies") private var speakReplies = true

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
                            .lineLimit(2)
                    }

                    mainActionButton
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
            HostInputView(host: $hostText, pairingToken: $tokenText, speakReplies: $speakReplies, onSave: {
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
            viewModel.setSpeakReplies(speakReplies)
            consumeQueuedLaunchAction()
        }
        .onChange(of: speakReplies) { _, enabled in
            viewModel.setSpeakReplies(enabled)
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
        .onChange(of: viewModel.isConnected) { _, _ in
            attemptPendingLaunchAction()
        }
        .onChange(of: watchSession.isReachable) { _, _ in
            attemptPendingLaunchAction()
        }
        .onOpenURL { url in
            if let action = OrpheusLaunchRouter.action(from: url) {
                prepareLaunchAction(action)
            }
        }
    }

    @ViewBuilder
    private var responseDisplay: some View {
        if !viewModel.lastResponse.isEmpty {
            ScrollViewReader { proxy in
                ScrollView {
                    Text(viewModel.lastResponse)
                        .font(.body)
                        .multilineTextAlignment(.leading)
                        .id("response-end")
                }
                .onChange(of: viewModel.lastResponse) { _, _ in
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo("response-end", anchor: .bottom)
                    }
                }
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

    private var mainActionButton: some View {
        VStack(spacing: 4) {
            ZStack {
                Circle()
                    .fill(mainButtonColor)
                    .frame(width: isTallScreen ? 52 : 46, height: isTallScreen ? 52 : 46)
                if viewModel.isRecordingOnWatch {
                    Circle()
                        .trim(from: 0, to: viewModel.recordingProgress)
                        .stroke(Color.white.opacity(0.9), style: StrokeStyle(lineWidth: 3, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .frame(width: isTallScreen ? 58 : 52, height: isTallScreen ? 58 : 52)
                }
                Image(systemName: mainButtonIcon)
                    .font(.system(size: isTallScreen ? 24 : 22, weight: .semibold))
                    .foregroundColor(.white)
            }
            .contentShape(Circle())
            .gesture(pressOrTapGesture)

            if viewModel.isRecordingOnWatch {
                Text(viewModel.recordingDurationLabel)
                    .font(.caption2.monospacedDigit())
                    .foregroundColor(.secondary)
            }
        }
    }

    private var pressOrTapGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .onChanged { _ in
                guard !holdGestureActive else { return }
                holdGestureActive = true
                holdRecordingStarted = false
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    guard holdGestureActive, !viewModel.isRecordingOnWatch, viewModel.daemonState == .idle else {
                        return
                    }
                    holdRecordingStarted = true
                    viewModel.startListening()
                }
            }
            .onEnded { _ in
                guard holdGestureActive else { return }
                holdGestureActive = false
                if holdRecordingStarted, viewModel.isRecordingOnWatch {
                    viewModel.stopListening()
                } else if !holdRecordingStarted {
                    handleMainAction()
                }
                holdRecordingStarted = false
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

    private func consumeQueuedLaunchAction() {
        guard let action = OrpheusLaunchRouter.consumePendingAction() else { return }
        prepareLaunchAction(action)
    }

    private func prepareLaunchAction(_ action: OrpheusLaunchAction) {
        pendingLaunchAction = action
        pendingLaunchAttempts = 0
        attemptPendingLaunchAction()
    }

    private func attemptPendingLaunchAction() {
        guard let action = pendingLaunchAction else { return }

        switch action {
        case .listen:
            guard !viewModel.isRecordingOnWatch else {
                pendingLaunchAction = nil
                return
            }

            if viewModel.isConnected || viewModel.relayAvailable || watchSession.isReachable {
                pendingLaunchAction = nil
                viewModel.startListening()
                return
            }

            if pendingLaunchAttempts < 8 {
                pendingLaunchAttempts += 1
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
                    attemptPendingLaunchAction()
                }
                return
            }

            pendingLaunchAction = nil
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
    @Binding var speakReplies: Bool
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
                Section("Audio") {
                    Toggle("Speak Replies", isOn: $speakReplies)
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
                        UserDefaults.standard.set(speakReplies, forKey: "orpheus_watch_speak_replies")
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
    @Published var recordingElapsed: TimeInterval = 0

    private var timerCancellable: AnyCancellable?
    private var recordingTimerCancellable: AnyCancellable?
    private let client = WatchAPIClient.shared
    private let audioRecorder = WatchAudioRecorder()
    private let haptics = HapticsEngine()
    private var lastState: DaemonState = .idle
    private var intensityTarget: Double = 0
    private var recordingStartedAt: Date?
    private let maxRecordingDuration: TimeInterval = 30

    func connect(to host: String) {
        // Clear previous subscriptions on reconnection to prevent accumulation
        cancellables.removeAll()
        timerCancellable?.cancel()
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

    func setSpeakReplies(_ enabled: Bool) {
        client.speakReplies = enabled
    }

    var connectionLabel: String {
        if isConnected { return "Direct" }
        if relayAvailable || WatchSessionManager.shared.isReachable { return "iPhone Relay" }
        return "Disconnected"
    }

    var recordingProgress: Double {
        min(max(recordingElapsed / maxRecordingDuration, 0), 1)
    }

    var recordingDurationLabel: String {
        "\(Int(recordingElapsed.rounded()))s"
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
            if newState == .responding {
                haptics.responseReady()
            }
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
        recordingElapsed = 0
        recordingStartedAt = Date()
        handleStateChange(.listening)
        haptics.feedback(for: .listening)
        startRecordingTimer()

        Task {
            do {
                try await audioRecorder.start()
            } catch {
                isRecordingOnWatch = false
                stopRecordingTimer()
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
            stopRecordingTimer()
            handleStateChange(.transcribing)
            haptics.sent()
            client.sendAudio(recording)
        } catch {
            isRecordingOnWatch = false
            stopRecordingTimer()
            handleStateChange(client.daemonState)
            connectionError = error.localizedDescription
        }
    }

    func cancel() {
        if isRecordingOnWatch {
            audioRecorder.cancel()
            isRecordingOnWatch = false
            stopRecordingTimer()
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

    private func startRecordingTimer() {
        recordingTimerCancellable?.cancel()
        recordingTimerCancellable = Timer.publish(every: 0.25, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                guard let self, let startedAt = self.recordingStartedAt else { return }
                self.recordingElapsed = Date().timeIntervalSince(startedAt)
                if self.recordingElapsed >= self.maxRecordingDuration {
                    self.stopListening()
                }
            }
    }

    private func stopRecordingTimer() {
        recordingTimerCancellable?.cancel()
        recordingTimerCancellable = nil
        recordingStartedAt = nil
    }
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

    func sent() {
        WKInterfaceDevice.current().play(.click)
    }

    func responseReady() {
        WKInterfaceDevice.current().play(.success)
    }
}

// MARK: - WatchConnectivity Manager

final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionManager()
    @Published var isReachable = false
    @Published var receivedHost: String?
    @Published var receivedPairingToken: String?
    @Published var relayEnvelopeData: Data?
    @Published var pendingRelayCount = 0

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
        process(message: message)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        process(message: applicationContext)
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        process(message: userInfo)
    }

    private func process(message: [String: Any]) {
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
        guard WCSession.isSupported() else { return false }
        do {
            let envelope = WatchSocketMessage(
                id: UUID().uuidString,
                timestamp: Date().timeIntervalSince1970,
                payload: command
            )
            let data = try JSONEncoder().encode(envelope)
            if WCSession.default.isReachable {
                WCSession.default.sendMessage(["commandData": data], replyHandler: nil) { [weak self] _ in
                    DispatchQueue.main.async {
                        self?.pendingRelayCount += 1
                    }
                }
            } else {
                WCSession.default.transferUserInfo(["commandData": data])
                pendingRelayCount += 1
            }
            return true
        } catch {
            return false
        }
    }
}
