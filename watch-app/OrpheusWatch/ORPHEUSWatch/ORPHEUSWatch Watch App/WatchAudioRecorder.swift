//
//  WatchAudioRecorder.swift
//  ORPHEUSWatch Watch App
//
//  Native watchOS microphone capture for sending voice turns to the Mac server.
//

import AVFoundation
import Foundation

struct WatchAudioRecording {
    let data: Data
    let duration: TimeInterval
    let mimeType: String
}

@MainActor
final class WatchAudioRecorder: NSObject, AVAudioRecorderDelegate {
    private var recorder: AVAudioRecorder?
    private var recordingURL: URL?
    private var startedAt: Date?

    var isRecording: Bool {
        recorder?.isRecording ?? false
    }

    func start() async throws {
        guard !isRecording else { return }

        let granted = await requestPermission()
        guard granted else {
            throw WatchAudioRecorderError.microphoneDenied
        }

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.playAndRecord, mode: .spokenAudio)
        try session.setActive(true)

        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("orpheus-watch-\(UUID().uuidString)")
            .appendingPathExtension("m4a")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16_000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.delegate = self
        recorder.isMeteringEnabled = true
        recorder.prepareToRecord()
        guard recorder.record() else {
            throw WatchAudioRecorderError.startFailed
        }

        self.recorder = recorder
        self.recordingURL = url
        self.startedAt = Date()
    }

    func stop() throws -> WatchAudioRecording {
        guard let recorder, let url = recordingURL else {
            throw WatchAudioRecorderError.notRecording
        }

        let duration = startedAt.map { Date().timeIntervalSince($0) } ?? recorder.currentTime
        recorder.stop()
        self.recorder = nil
        self.recordingURL = nil
        self.startedAt = nil

        let data = try Data(contentsOf: url)
        try? FileManager.default.removeItem(at: url)
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        return WatchAudioRecording(data: data, duration: duration, mimeType: "audio/mp4")
    }

    func cancel() {
        let url = recordingURL
        recorder?.stop()
        recorder?.deleteRecording()
        recorder = nil
        recordingURL = nil
        startedAt = nil
        if let url {
            try? FileManager.default.removeItem(at: url)
        }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func requestPermission() async -> Bool {
        return await withCheckedContinuation { continuation in
            AVAudioApplication.requestRecordPermission { granted in
                continuation.resume(returning: granted)
            }
        }
    }
}

enum WatchAudioRecorderError: LocalizedError {
    case microphoneDenied
    case startFailed
    case notRecording

    var errorDescription: String? {
        switch self {
        case .microphoneDenied:
            return "Microphone access is disabled."
        case .startFailed:
            return "Could not start recording."
        case .notRecording:
            return "No active recording."
        }
    }
}
