//
//  OrpheusLaunchAction.swift
//  ORPHEUSWatch Watch App
//
//  Routes Siri shortcut and complication launches into native app actions.
//

import Foundation

enum OrpheusLaunchAction: String {
    case listen
}

enum OrpheusLaunchRouter {
    static let listenURL = URL(string: "orpheuswatch://listen")!

    private static let pendingActionKey = "orpheus_pending_launch_action"
    private static let sharedDefaults = UserDefaults(suiteName: "group.com.yourcompany.OrpheusWatch")

    static func queue(_ action: OrpheusLaunchAction) {
        UserDefaults.standard.set(action.rawValue, forKey: pendingActionKey)
        sharedDefaults?.set(action.rawValue, forKey: pendingActionKey)
    }

    static func consumePendingAction() -> OrpheusLaunchAction? {
        let rawValue = UserDefaults.standard.string(forKey: pendingActionKey)
            ?? sharedDefaults?.string(forKey: pendingActionKey)
        UserDefaults.standard.removeObject(forKey: pendingActionKey)
        sharedDefaults?.removeObject(forKey: pendingActionKey)
        guard let rawValue else { return nil }
        return OrpheusLaunchAction(rawValue: rawValue)
    }

    static func action(from url: URL) -> OrpheusLaunchAction? {
        guard url.scheme == "orpheuswatch" else { return nil }

        if url.host == OrpheusLaunchAction.listen.rawValue {
            return .listen
        }

        let path = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        return OrpheusLaunchAction(rawValue: path)
    }
}
