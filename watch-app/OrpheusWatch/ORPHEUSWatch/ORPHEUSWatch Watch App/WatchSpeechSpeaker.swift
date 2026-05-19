//
//  WatchSpeechSpeaker.swift
//  ORPHEUSWatch Watch App
//
//  Local watchOS speech playback for short ORPHEUS responses.
//

import AVFoundation

@MainActor
final class WatchSpeechSpeaker: NSObject, AVSpeechSynthesizerDelegate {
    static let shared = WatchSpeechSpeaker()

    private let synthesizer = AVSpeechSynthesizer()

    private override init() {
        super.init()
        synthesizer.delegate = self
    }

    func speak(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }

        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }

        let utterance = AVSpeechUtterance(string: String(trimmed.prefix(700)))
        utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
        utterance.pitchMultiplier = 0.95
        synthesizer.speak(utterance)
    }

    func stop() {
        if synthesizer.isSpeaking {
            synthesizer.stopSpeaking(at: .immediate)
        }
    }
}
