//
//  PairingCode.swift
//  ORPHEUSWatch
//
//  Parses pasteable Mac setup codes for the iPhone bridge.
//

import Foundation

struct PairingCode {
    let host: String
    let token: String

    static func parse(_ input: String) -> PairingCode? {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if let data = trimmed.data(using: .utf8),
           let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let host = object["host"] as? String {
            return PairingCode(host: host, token: object["token"] as? String ?? "")
        }

        if let url = URL(string: trimmed), url.scheme == "orpheus" {
            let components = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let host = components?.queryItems?.first(where: { $0.name == "host" })?.value
            let token = components?.queryItems?.first(where: { $0.name == "token" })?.value ?? ""
            if let host, !host.isEmpty {
                return PairingCode(host: host, token: token)
            }
        }

        let separators = CharacterSet(charactersIn: "|, \n\t")
        let parts = trimmed
            .components(separatedBy: separators)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        guard let host = parts.first else { return nil }
        return PairingCode(host: host, token: parts.dropFirst().first ?? "")
    }
}
