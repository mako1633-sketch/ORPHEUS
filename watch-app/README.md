# ORPHEUS Watch Companion

Apple Watch companion for ORPHEUS — voice-first, wrist-accessible AI control.

## Architecture

```
watchOS app ←→ iOS companion ←→ Mac ORPHEUS server (port 8472)
         (WatchConnectivity)       (WebSocket / HTTP)
```

In this proof-of-concept, the watchOS app connects **directly** to the Mac server
over the local network. The iOS companion app provides a status dashboard and
will take over the relay role in a future iteration.

## Setup

### 1. Start ORPHEUS with the watch server

The watch server auto-starts when you launch ORPHEUS. It listens on port **8472**.

### 2. Find your Mac's IP address

```bash
ipconfig getifaddr en0   # Wi-Fi
```

### 3. Open the watchOS project in Xcode

```bash
open watch-app/OrpheusWatch/OrpheusWatch.xcodeproj
```

### 4. Configure signing

Select the **OrpheusWatchWatchOS** target → Signing & Capabilities → Choose your
Apple ID team.

### 5. Build and run

- Set the scheme to **OrpheusWatchWatchOS**
- Build to your paired Apple Watch
- Enter your Mac's IP in the watch settings (gear icon)

## Features (PoC)

- **Tap 🎙** to start/stop voice recording (like the Mac spacebar)
- **Tap ✕** to cancel while ORPHEUS is working
- **Live status** — see if ORPHEUS is idle, listening, responding, etc.
- **Streaming response** — text appears as it generates

## Future

- Haptic feedback for long-running tasks
- Complications for watch faces
- Siri Shortcuts integration ("Hey Siri, ask Orpheus...")
- iOS relay mode (watch → iPhone → Mac, for when not on same Wi-Fi)
