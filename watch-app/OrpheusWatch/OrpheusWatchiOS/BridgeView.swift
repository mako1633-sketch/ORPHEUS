import SwiftUI
import WatchConnectivity

/// iOS companion app that bridges the Apple Watch to the ORPHEUS Mac server.
/// In the PoC, the watch connects directly. This app provides a status dashboard.
struct BridgeView: View {
    @StateObject private var session = iOSWatchSession.shared
    @StateObject private var client = WatchAPIClient.shared
    @State private var hostText = ""

    var body: some View {
        NavigationStack {
            List {
                Section("Connection") {
                    HStack {
                        Text("Mac Server")
                        Spacer()
                        Circle()
                            .fill(client.isConnected ? Color.green : Color.red)
                            .frame(width: 12, height: 12)
                        Text(client.isConnected ? "Connected" : "Disconnected")
                            .foregroundColor(.secondary)
                    }

                    HStack {
                        Text("Apple Watch")
                        Spacer()
                        Circle()
                            .fill(session.isReachable ? Color.green : Color.red)
                            .frame(width: 12, height: 12)
                        Text(session.isReachable ? "Reachable" : "Not reachable")
                            .foregroundColor(.secondary)
                    }
                }

                Section("Mac Address") {
                    TextField("IP or hostname", text: $hostText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit {
                            UserDefaults.standard.set(hostText, forKey: "orpheus_host")
                            client.connect(to: hostText)
                        }
                }

                Section("Status") {
                    HStack {
                        Text("Daemon State")
                        Spacer()
                        Text(client.daemonState.rawValue.uppercased())
                            .font(.caption.bold())
                            .foregroundColor(.accentColor)
                    }

                    if !client.lastTranscription.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Last Query")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(client.lastTranscription)
                                .font(.body)
                        }
                    }

                    if !client.lastResponse.isEmpty {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Last Response")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text(client.lastResponse)
                                .font(.body)
                                .lineLimit(5)
                        }
                    }
                }

                if let error = client.connectionError {
                    Section {
                        Text(error)
                            .foregroundColor(.red)
                            .font(.caption)
                    }
                }
            }
            .navigationTitle("ORPHEUS Bridge")
            .onAppear {
                session.activate()
                if let savedHost = UserDefaults.standard.string(forKey: "orpheus_host"), !savedHost.isEmpty {
                    hostText = savedHost
                    client.connect(to: savedHost)
                }
            }
        }
    }
}

final class iOSWatchSession: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = iOSWatchSession()
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

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {}
}
