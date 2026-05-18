import SwiftUI
import Combine

/// Native SwiftUI reproduction of the ORPHEUS daemon avatar rig.
/// Optimized for the 40mm Watch screen — 60fps, battery-conscious.
struct DaemonAvatarView: View {
    let state: DaemonState
    let intensity: Double
    let isConnected: Bool

    @State private var phase: Double = 0
    @State private var spawnProgress: Double = 0

    // Animation timer — 30fps on watch to conserve battery
    private let timer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    // MARK: - Theme Colors

    private var theme: AvatarTheme {
        AvatarTheme.forState(state, connected: isConnected)
    }

    private var speedMultiplier: Double {
        1.0 + intensity * 2.0 + (state == .listening ? 1.5 : 0)
    }

    var body: some View {
        ZStack {
            // Background ambient glow
            ambientGlow

            // Orbiting rings
            ringLayer

            // Floating fragments
            fragmentLayer

            // Core + glow mesh
            coreLayer

            // Eye
            eyeLayer

            // Particles
            particleLayer
        }
        .frame(width: 80, height: 80)
        .onReceive(timer) { _ in
            let dt = 1.0 / 30.0
            phase += dt * 2.0 * speedMultiplier
            if spawnProgress < 1.0 {
                spawnProgress = min(1.0, spawnProgress + dt * 1.5)
            }
        }
        .onAppear {
            spawnProgress = 0
        }
        .opacity(isConnected ? 1.0 : 0.3)
    }

    // MARK: - Ambient Glow

    private var ambientGlow: some View {
        Circle()
            .fill(theme.glowColor.opacity(0.08 + spawnProgress * 0.12))
            .frame(width: 70, height: 70)
            .blur(radius: 8)
            .scaleEffect(1.0 + sin(phase * 0.7) * 0.08 * spawnProgress)
    }

    // MARK: - Core

    private var coreLayer: some View {
        ZStack {
            // Inner core
            Circle()
                .fill(theme.primaryColor.opacity(0.5 + spawnProgress * 0.3))
                .frame(width: 28, height: 28)
                .shadow(color: theme.glowColor.opacity(0.6), radius: 6 + intensity * 4)

            // Wireframe glow (outer mesh)
            Circle()
                .stroke(theme.primaryColor.opacity(0.3 + spawnProgress * 0.3), lineWidth: 1)
                .frame(width: 32 + sin(phase) * 2 * spawnProgress, height: 32 + sin(phase) * 2 * spawnProgress)
        }
        .offset(
            x: sin(phase * 0.3 + 1.0) * 1.5 * spawnProgress,
            y: cos(phase * 0.4 + 2.0) * 1.5 * spawnProgress
        )
    }

    // MARK: - Eye

    private var eyeLayer: some View {
        let eyeX = sin(phase * 0.5) * 3.0 * spawnProgress
        let eyeY = cos(phase * 0.3 + 1.0) * 2.0 * spawnProgress
        let blink = abs(sin(phase * 0.8)) > 0.95 ? 0.1 : 1.0

        return ZStack {
            // Eye ring
            Circle()
                .stroke(theme.eyeColor.opacity(0.9), lineWidth: 1.5)
                .frame(width: 10, height: 10)

            // Pupil
            Circle()
                .fill(theme.eyeColor)
                .frame(width: 4 * blink, height: 4 * blink)
        }
        .offset(x: eyeX, y: eyeY)
        .opacity(spawnProgress)
    }

    // MARK: - Rings

    private var ringLayer: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { i in
                AvatarRing(
                    index: i,
                    phase: phase,
                    theme: theme,
                    intensity: intensity,
                    spawnProgress: spawnProgress
                )
            }
        }
    }

    // MARK: - Fragments

    private var fragmentLayer: some View {
        ZStack {
            ForEach(0..<6, id: \.self) { i in
                AvatarFragment(
                    index: i,
                    phase: phase,
                    theme: theme,
                    intensity: intensity,
                    spawnProgress: spawnProgress
                )
            }
        }
    }

    // MARK: - Particles

    private var particleLayer: some View {
        ZStack {
            ForEach(0..<15, id: \.self) { i in
                AvatarParticle(
                    index: i,
                    phase: phase,
                    theme: theme,
                    spawnProgress: spawnProgress
                )
            }
        }
    }
}

// MARK: - Avatar Ring

struct AvatarRing: View {
    let index: Int
    let phase: Double
    let theme: AvatarTheme
    let intensity: Double
    let spawnProgress: Double

    private var radius: CGFloat {
        CGFloat(22 + index * 12)
    }

    private var rotation: Angle {
        .radians(phase * (0.3 + Double(index) * 0.15) + Double(index) * .pi / 3)
    }

    private var wobble: Double {
        sin(phase * 0.5 + Double(index)) * 0.08 * spawnProgress
    }

    var body: some View {
        Ellipse()
            .stroke(
                theme.primaryColor.opacity(0.25 + Double(index) * 0.1 + intensity * 0.15),
                style: StrokeStyle(lineWidth: 1, dash: [4, index == 1 ? 2 : 6])
            )
            .frame(width: radius * 2 * (1 + CGFloat(wobble)), height: radius * 2 * (1 - CGFloat(wobble) * 0.5))
            .rotationEffect(rotation)
            .scaleEffect(spawnProgress)
            .opacity(spawnProgress)
    }
}

// MARK: - Avatar Fragment

struct AvatarFragment: View {
    let index: Int
    let phase: Double
    let theme: AvatarTheme
    let intensity: Double
    let spawnProgress: Double

    private var orbitRadius: CGFloat { 38 }
    private var orbitAngle: Double {
        phase * 0.4 + (Double(index) / 6.0) * .pi * 2
    }

    private var bob: CGFloat {
        CGFloat(sin(phase * (1.0 + Double(index) * 0.3)) * 3.0)
    }

    private var size: CGFloat {
        CGFloat(3 + (index % 3) * 1.5)
    }

    var body: some View {
        let x = cos(orbitAngle) * Double(orbitRadius)
        let y = sin(orbitAngle) * Double(orbitRadius) * 0.6 + Double(bob)

        return Group {
            if index % 4 == 0 {
                // Tetrahedron-ish (triangle)
                Triangle()
                    .fill(theme.primaryColor.opacity(0.6 + intensity * 0.3))
                    .frame(width: size, height: size)
            } else if index % 4 == 1 {
                // Octahedron-ish (diamond)
                Diamond()
                    .fill(theme.primaryColor.opacity(0.6 + intensity * 0.3))
                    .frame(width: size, height: size)
            } else if index % 4 == 2 {
                // Box-ish (rectangle)
                Rectangle()
                    .fill(theme.primaryColor.opacity(0.6 + intensity * 0.3))
                    .frame(width: size, height: size * 0.6)
            } else {
                // Icosahedron-ish (circle with stroke)
                Circle()
                    .stroke(theme.primaryColor.opacity(0.6 + intensity * 0.3), lineWidth: 0.8)
                    .frame(width: size, height: size)
            }
        }
        .offset(x: CGFloat(x), y: CGFloat(y))
        .rotationEffect(.radians(phase * 0.6 + Double(index)))
        .opacity(spawnProgress * (0.7 + intensity * 0.3))
    }
}

// MARK: - Avatar Particle

struct AvatarParticle: View {
    let index: Int
    let phase: Double
    let theme: AvatarTheme
    let spawnProgress: Double

    private var r: Double {
        18 + Double(index % 5) * 8
    }

    private var theta: Double {
        phase * 0.15 + (Double(index) / 15.0) * .pi * 2
    }

    private var phi: Double {
        acos(Double(index % 3) / 3.0 * 2 - 1)
    }

    private var brightness: Double {
        0.3 + 0.4 * sin(phase * 0.8 + Double(index) * 2.0)
    }

    var body: some View {
        let x = r * sin(phi) * cos(theta)
        let y = r * sin(phi) * sin(theta) * 0.5 // Flatten for 2D

        return Circle()
            .fill(theme.glowColor.opacity(brightness * spawnProgress))
            .frame(width: 1.5, height: 1.5)
            .offset(x: CGFloat(x), y: CGFloat(y))
    }
}

// MARK: - Theme

struct AvatarTheme {
    let primaryColor: Color
    let glowColor: Color
    let eyeColor: Color

    static func forState(_ state: DaemonState, connected: Bool) -> AvatarTheme {
        if !connected {
            return AvatarTheme(
                primaryColor: Color(hex: 0x444444),
                glowColor: Color(hex: 0x222222),
                eyeColor: Color(hex: 0x666666)
            )
        }

        switch state {
        case .idle:
            return AvatarTheme(
                primaryColor: Color(hex: 0x9ca3af),
                glowColor: Color(hex: 0x67e8f9),
                eyeColor: Color(hex: 0xff0000)
            )
        case .listening:
            return AvatarTheme(
                primaryColor: Color(hex: 0xff3333),
                glowColor: Color(hex: 0xff6666),
                eyeColor: Color(hex: 0xffffff)
            )
        case .transcribing:
            return AvatarTheme(
                primaryColor: Color(hex: 0xff8800),
                glowColor: Color(hex: 0xffaa33),
                eyeColor: Color(hex: 0xffffff)
            )
        case .responding:
            return AvatarTheme(
                primaryColor: Color(hex: 0x4488ff),
                glowColor: Color(hex: 0x67e8f9),
                eyeColor: Color(hex: 0xffffff)
            )
        case .speaking:
            return AvatarTheme(
                primaryColor: Color(hex: 0x8844ff),
                glowColor: Color(hex: 0xaa66ff),
                eyeColor: Color(hex: 0xffffff)
            )
        case .typing:
            return AvatarTheme(
                primaryColor: Color(hex: 0x00ffff),
                glowColor: Color(hex: 0x67e8f9),
                eyeColor: Color(hex: 0xffffff)
            )
        }
    }
}

// MARK: - Shape Helpers

struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

struct Diamond: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.midY))
        path.closeSubpath()
        return path
    }
}

// MARK: - Color Extension

extension Color {
    init(hex: Int) {
        let r = Double((hex >> 16) & 0xFF) / 255.0
        let g = Double((hex >> 8) & 0xFF) / 255.0
        let b = Double(hex & 0xFF) / 255.0
        self.init(red: r, green: g, blue: b)
    }
}
