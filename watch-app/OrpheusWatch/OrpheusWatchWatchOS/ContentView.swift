import SwiftUI
import WatchConnectivity

struct ContentView: View {
    @StateObject private var watchSession = WatchSessionManager.shared
    @StateObject private var viewModel = WatchViewModel()
    @State private var showingHostInput = false
    @State private var hostText = ""

    var body: some View {
        NavigationStack {
            VStack(spacing: 8) {
                // Connection status
                HStack {
                    Circle()
                        .fill(viewModel.isConnected ? Color.green : Color.red)
                        .frame(width: 8, height: 8)
                    Text(viewModel.isConnected ? "Connected" : "Disconnected")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Spacer()
                }

                // Daemon state pill
                StatePill(state: viewModel.daemonState)

                Spacer(minLength: 4)

                // Response display (scrollable)
                if !viewModel.lastResponse.isEmpty {
                    ScrollView {
                        Text(viewModel.lastResponse)
                            .font(.body)
                            .multilineTextAlignment(.leading)
                    }
                    .frame(maxHeight: 80)
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

                Spacer(minLength: 4)

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
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundColor(.white)
                        .frame(width: 56, height: 56)
                        .background(mainButtonColor)
                        .clipShape(Circle())
                }
                .buttonStyle(PlainButtonStyle())
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
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
            HostInputView(host: $hostText, onSave: {
                viewModel.connect(to: hostText)
                showingHostInput = false
            })
        }
        .onAppear {
            watchSession.activate()
            // Try to load saved host from UserDefaults
            if let savedHost = UserDefaults.standard.string(forKey: "orpheus_host"), !savedHost.isEmpty {
                hostText = savedHost
                viewModel.connect(to: savedHost)
            }
        }
    }

    private var mainButtonIcon: String {
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
        switch viewModel.daemonState {
        case .listening:
            viewModel.stopListening()
        case .transcribing, .responding, .speaking:
            viewModel.cancel()
        default:
            viewModel.startListening()
        }
    }
}

// MARK: - Subviews

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

struct HostInputView: View {
    @Binding var host: String
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
                Section {
                    Text("Enter your Mac's IP address (e.g. 192.168.1.42)")
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
                        onSave()
                    }
                }
            }
        }
    }
}

// MARK: - View Model

final class WatchViewModel: ObservableObject {
    @Published var isConnected = false
    @Published var daemonState: DaemonState = .idle
    @Published var lastTranscription = ""
    @Published var lastResponse = ""
    @Published var connectionError: String?

    private var cancellables = Set<AnyCancellable>()
    private let client = WatchAPIClient.shared

    func connect(to host: String) {
        client.connect(to: host)
        client.$isConnected
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.isConnected = $0 }
            .store(in: &cancellables)
        client.$daemonState
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.daemonState = $0 }
            .store(in: &cancellables)
        client.$lastTranscription
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.lastTranscription = $0 }
            .store(in: &cancellables)
        client.$lastResponse
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.lastResponse = $0 }
            .store(in: &cancellables)
        client.$connectionError
            .receive(on: DispatchQueue.main)
            .sink { [weak self] in self?.connectionError = $0 }
            .store(in: &cancellables)
    }

    func startListening() {
        lastTranscription = ""
        lastResponse = ""
        client.toggleListening()
    }

    func stopListening() {
        client.toggleListening()
    }

    func cancel() {
        client.cancel()
    }
}

// MARK: - WatchConnectivity Manager (placeholder for now)

final class WatchSessionManager: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchSessionManager()
    @Published var isReachable = false

    private override init() {
        super.init()
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
        }
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        DispatchQueue.main.async { [weak self] in
            self?.isReachable = session.isReachable
        }
    }

    #if os(iOS)
    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {}
    #endif
}
