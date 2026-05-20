//
//  WatchModels.swift
//  ORPHEUSWatch Watch App
//
//  Created by Matt on 5/17/26.
//

import Foundation

// MARK: - Daemon State

enum DaemonState: String, Codable {
    case idle, listening, transcribing, responding, speaking, typing
}

enum WatchConnectionRoute: String {
    case direct
    case relay
    case disconnected
}

// MARK: - Commands (Watch → Mac)

enum WatchCommand: Codable {
    case query(text: String)
    case audio(audioBase64: String, mimeType: String, duration: Double)
    case cancel
    case status
    case history
    case speak(text: String)
    case listen

    enum CodingKeys: String, CodingKey {
        case type, text, audioBase64, mimeType, duration
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .query(let text):
            try container.encode("query", forKey: .type)
            try container.encode(text, forKey: .text)
        case .audio(let audioBase64, let mimeType, let duration):
            try container.encode("audio", forKey: .type)
            try container.encode(audioBase64, forKey: .audioBase64)
            try container.encode(mimeType, forKey: .mimeType)
            try container.encode(duration, forKey: .duration)
        case .cancel:
            try container.encode("cancel", forKey: .type)
        case .status:
            try container.encode("status", forKey: .type)
        case .history:
            try container.encode("history", forKey: .type)
        case .speak(let text):
            try container.encode("speak", forKey: .type)
            try container.encode(text, forKey: .text)
        case .listen:
            try container.encode("listen", forKey: .type)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "query":
            self = .query(text: try container.decode(String.self, forKey: .text))
        case "audio":
            self = .audio(
                audioBase64: try container.decode(String.self, forKey: .audioBase64),
                mimeType: try container.decode(String.self, forKey: .mimeType),
                duration: try container.decode(Double.self, forKey: .duration)
            )
        case "cancel":  self = .cancel
        case "status":  self = .status
        case "history": self = .history
        case "speak":
            self = .speak(text: try container.decode(String.self, forKey: .text))
        case "listen":  self = .listen
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "Unknown command"
            )
        }
    }
}

// MARK: - Responses (Mac → Watch)

enum WatchResponse: Codable {
    case status(state: DaemonState, transcription: String?, response: String?, usage: TokenUsage?, connectedAt: Double)
    case query(fragment: String, done: Bool, error: String?)
    case history(items: [HistoryItem])
    case error(message: String)

    enum CodingKeys: String, CodingKey {
        case type, state, transcription, response, usage, connectedAt
        case fragment, done, error
        case items
        case message
    }

    struct HistoryItem: Codable {
        let role: String
        let content: String
        let timestamp: Double
    }

    struct TokenUsage: Codable {
        let promptTokens: Int
        let completionTokens: Int
        let totalTokens: Int
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .status(let s, let t, let r, let u, let c):
            try container.encode("status", forKey: .type)
            try container.encode(s, forKey: .state)
            try container.encode(t, forKey: .transcription)
            try container.encode(r, forKey: .response)
            try container.encode(u, forKey: .usage)
            try container.encode(c, forKey: .connectedAt)
        case .query(let f, let d, let e):
            try container.encode("query", forKey: .type)
            try container.encode(f, forKey: .fragment)
            try container.encode(d, forKey: .done)
            try container.encode(e, forKey: .error)
        case .history(let items):
            try container.encode("history", forKey: .type)
            try container.encode(items, forKey: .items)
        case .error(let msg):
            try container.encode("error", forKey: .type)
            try container.encode(msg, forKey: .message)
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let t = try container.decode(String.self, forKey: .type)
        switch t {
        case "status":
            self = .status(
                state: try container.decode(DaemonState.self, forKey: .state),
                transcription: try container.decodeIfPresent(String.self, forKey: .transcription),
                response: try container.decodeIfPresent(String.self, forKey: .response),
                usage: try container.decodeIfPresent(TokenUsage.self, forKey: .usage),
                connectedAt: try container.decode(Double.self, forKey: .connectedAt)
            )
        case "query":
            self = .query(
                fragment: try container.decode(String.self, forKey: .fragment),
                done: try container.decode(Bool.self, forKey: .done),
                error: try container.decodeIfPresent(String.self, forKey: .error)
            )
        case "history":
            self = .history(items: try container.decode([HistoryItem].self, forKey: .items))
        case "error":
            self = .error(message: try container.decode(String.self, forKey: .message))
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .type, in: container, debugDescription: "Unknown response"
            )
        }
    }
}

// MARK: - WebSocket Envelope

struct WatchSocketMessage<Payload: Codable>: Codable {
    let id: String
    let timestamp: Double
    let payload: Payload
}
