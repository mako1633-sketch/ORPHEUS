//
//  BridgeView.swift
//  ORPHEUSWatch
//
//  iOS companion that shows Watch connectivity and lets the user set the Mac IP.
//

import SwiftUI
import WatchConnectivity

struct BridgeView: View {
    @StateObject private var session = iOSWatchSession.shared
    @State private var hostText = ""

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
                }
                Section("Mac Address") {
                    TextField("IP or hostname", text: $hostText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onSubmit {
                            UserDefaults.standard.set(hostText, forKey: "orpheus_host")
                            if session.isReachable {
                                WCSession.default.sendMessage(
                                    ["host": hostText],
                                    replyHandler: nil,
                                    errorHandler: nil
                                )
                            }
                        }
                }
                Section {
                    Text("Enter your Mac's IP address and tap return. This will be sent to your Apple Watch so it can connect to ORPHEUS.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
            .navigationTitle("ORPHEUS Bridge")
            .onAppear {
                session.activate()
                if let savedHost = UserDefaults.standard.string(forKey: "orpheus_host") {
                    hostText = savedHost
                }
            }
        }
    }
}

final class iOSWatchSession: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = iOSWatchSession()
    @Published var isReachable = false

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

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) {}
}
