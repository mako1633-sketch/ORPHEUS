# ORPHEUS Watch Companion

Apple Watch companion for ORPHEUS. Provides voice interaction, daemon status, and watch face complications.

## Features

- **Voice queries** — tap the mic icon, tap the complication, or use Siri to open ORPHEUS listening mode
- **Live state display** — idle, listening, transcribing, responding, speaking, typing
- **Haptic feedback** — state-specific taps for each transition
- **Watch face complication** — circular, rectangular, inline, and corner layouts
- **Siri Shortcuts** — "Start Orpheus", "Ask Orpheus", "Check Orpheus status"
- **Native avatar** — daemon rig recreated in SwiftUI for Series 7+ tall screens

## Architecture

```
Apple Watch     <-- WatchConnectivity -->    iOS Bridge App     <-- WiFi -->    Mac (ORPHEUS server)
    │                                                         port 8472
    └── watchOS app (voice, avatar, complications)

Widget Extension
    └── reads shared UserDefaults "group.com.yourcompany.OrpheusWatch"
    └── auto-refreshes when daemon state changes
```

## Xcode Setup

### 1. App Groups (required for complications)

Both the **Watch App** and **Widget Extension** targets need the same App Group:

1. Select `ORPHEUSWatch Watch App` target → Signing & Capabilities → **+ Capability** → **App Groups**
2. Add group: `group.com.yourcompany.OrpheusWatch`
3. Select `ORPHEUSWatch Watch Widget Extension` target → repeat the same App Group

> **Important:** If you change the bundle identifier, update the suite name in `WatchAPIClient.swift` and `OrpheusComplicationWidget.swift` to match.

### 2. Widget Extension Target

If the Widget Extension target doesn't exist in your project yet:

1. File → New → Target → **Widget Extension**
2. Name it: `ORPHEUSWatch Watch Widget Extension`
3. Uncheck "Include Configuration Intent" (we use a static widget)
4. Add these files to the new target:
   - `OrpheusComplicationWidget.swift` (timeline provider + entry + view)
   - `ComplicationWidgetBundle.swift` (`@main` widget bundle)
   - `Info.plist`

### 3. Siri Shortcuts

The `OrpheusShortcuts.swift` file uses `AppIntents` — no additional setup required on watchOS 10+. The shortcuts appear automatically once the app is installed.

For the most Siri-like flow, say **"Start ORPHEUS"**, **"Open ORPHEUS"**, or **"Talk to ORPHEUS"**. The Watch app opens and immediately starts microphone capture once the direct Mac connection or iPhone relay is ready.

Use **"Ask ORPHEUS"** when you want Siri to capture a dictated question and send it as text. Use **"Check ORPHEUS status"** for a hands-free connection/state check.

### 4. Build & Run

1. Make sure ORPHEUS is running on your Mac (`bun run orpheus`)
2. Get your Mac's IP: `ipconfig getifaddr en0`
3. Open `ORPHEUSWatch.xcodeproj` in Xcode
4. Select your Apple Watch as the target device
5. Build and install
6. On the Watch, open ORPHEUS, enter your Mac IP in Settings
7. Long-press a watch face → Edit → Complications → pick **ORPHEUS Status**
8. Tap the ORPHEUS complication to open the Watch app directly into listening mode

## File Overview

### Watch App (`ORPHEUSWatch Watch App/`)
- `ORPHEUSWatchApp.swift` — `@main` watch app entry point
- `ContentView.swift` — main UI with avatar, controls, settings
- `DaemonAvatarView.swift` — SwiftUI reproduction of the daemon rig
- `WatchAPIClient.swift` — WebSocket client, publishes to shared defaults
- `WatchModels.swift` — shared types (state, commands, responses)
- `OrpheusShortcuts.swift` — AppIntents for Siri shortcuts
- `OrpheusLaunchAction.swift` — routes Siri and complication launches into app actions

### Widget Extension (`ORPHEUSWatch Watch Widget Extension/`)
- `ComplicationWidgetBundle.swift` — `@main` widget bundle
- `OrpheusComplicationWidget.swift` — complication timeline provider + views
- `Info.plist` — standard widget extension plist

### iOS App (`ORPHEUSWatch/`)
- `ORPHEUSWatchApp.swift` — `@main` iOS app entry point
- `ContentView.swift` — forwards to BridgeView
- `BridgeView.swift` — mac IP input, WatchConnectivity bridge

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Not configured" in shortcuts | Open the Watch app, set Mac IP in Settings |
| Siri opens ORPHEUS but it does not listen | Confirm microphone permission is allowed and the Mac server or iPhone relay is reachable |
| Complication not updating | Verify App Group is identical on both targets |
| "Cannot connect" | Check Mac firewall, ensure ORPHEUS is running, same Wi-Fi |
| Avatar not showing | Series 7 or later required for full avatar (falls back to state pill) |

## watchOS Compatibility

- Minimum: watchOS 10.0
- Optimized for: watchOS 11+ (Series 7 and later)
- Tested on: Apple Watch Series 10, watchOS 26.5
