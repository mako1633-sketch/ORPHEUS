//
//  DaemonAvatarView.swift
//  ORPHEUSWatch Watch App
//
//  Created by Matt on 5/17/26.
//

import SwiftUI
import Combine

/// Native SwiftUI reproduction of the ORPHEUS daemon avatar rig.
/// Optimized for the 40-46mm Watch screen — 30fps to conserve battery.
struct DaemonAvatarView: View {
    let state: DaemonState
    let intensity: Double
    let isConnected: Bool

    @State private var phase: Double = 0
    @State private var spawnProgress: Double = 0

    // MARK: - Glitch State
    @State private var glitchTimer: Double = 0
    @State private var glitchActive: Bool = false
    @State private var glitchDuration: Double = 0
    @State private var glitchInterval: Double = 3.0
    @State private var glitchOffsetX: Double = 0
    @State private var glitchOffsetY: Double = 0
    @State private var glitchFragmentScale: Double = 1.0
    @State private var glitchRingFlicker: Double = 1.0

    // MARK: - Idle Micro-Glitch
    @State private var microGlitchTimer: Double = 0
    @State private var microGlitchCooldown: Double = 3.0 + Double.random(in: 0...5)
    @State private var microGlitchActive: Bool = false
    @State private var microGlitchDuration: Double = 0

    // MARK: - Typing Pulse
    @State private var typingPulsePhase: Double = 0

    private let timer = Timer.publish(every: 1.0 / 30.0, on: .main, in: .common).autoconnect()

    private var theme: AvatarTheme { AvatarTheme.forState(state, connected: isConnected) }

    private var speedMultiplier: Double {
        1.0 + intensity * 2.0 + (state == .listening ? 1.5 : 0)
    }

    // MARK: - Breathing Helpers
    private var breathe: Double {
        sin(phase) * 0.5 + sin(phase * 1.31 + 0.7) * 0.5
    }
    private var breatheSlow: Double {
        sin(phase * 0.7) * 0.6 + sin(phase * 0.53 + 1.2) * 0.4
    }

    // MARK: - Typing Pulse
    private var isTyping: Bool { state == .typing }
    private var typingPulse: Double {
        guard isTyping else { return 0 }
        return max(0, sin(typingPulsePhase))
    }

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ambientGlow
                ringLayer
                fragmentLayer(in: geo)
                typingFlashLayer
                coreLayer
                eyeLayer
                particleLayer
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .onReceive(timer) { _ in
            let dt = 1.0 / 30.0
            phase += dt * 2.0 * speedMultiplier
            if spawnProgress < 1.0 {
                spawnProgress = min(1.0, spawnProgress + dt * 1.5)
            }
            if isTyping {
                typingPulsePhase += dt * 12.0
            } else {
                typingPulsePhase = 0
            }
            updateGlitch(dt: dt)
            updateMicroGlitch(dt: dt)
        }
        .onAppear { spawnProgress = 0 }
        .opacity(isConnected ? 1.0 : 0.3)
    }

    // MARK: - Glitch Logic

    private func updateGlitch(dt: Double) {
        guard isConnected else {
            glitchActive = false
            resetGlitch()
            return
        }

        let effectiveIntensity = max(0.1, intensity)
        let baseInterval = 3.0 / effectiveIntensity

        if !glitchActive {
            glitchTimer += dt
            if glitchTimer > glitchInterval {
                triggerGlitch(intensity: effectiveIntensity)
            }
        } else {
            glitchDuration -= dt
            if glitchDuration <= 0 {
                glitchActive = false
                resetGlitch()
                glitchTimer = 0
                glitchInterval = baseInterval * (0.5 + Double.random(in: 0...1.0))
            }
        }
    }

    private func triggerGlitch(intensity: Double) {
        glitchActive = true
        glitchDuration = 0.05 + Double.random(in: 0...0.1) + intensity * 0.05
        let displaceMult = intensity * 0.5
        glitchOffsetX = (Double.random(in: -1...1) - 0.5) * 6.0 * displaceMult
        glitchOffsetY = (Double.random(in: -1...1) - 0.5) * 6.0 * displaceMult
        glitchFragmentScale = 1.0 + (Double.random(in: -1...1) - 0.5) * intensity * 0.3
        glitchRingFlicker = 1.0 - intensity * 0.2 + Double.random(in: 0...(intensity * 0.4))
    }

    private func resetGlitch() {
        glitchOffsetX = 0
        glitchOffsetY = 0
        glitchFragmentScale = 1.0
        glitchRingFlicker = 1.0
    }

    // MARK: - Idle Micro-Glitch

    private func updateMicroGlitch(dt: Double) {
        guard isConnected, !glitchActive else { return }

        if !microGlitchActive {
            microGlitchTimer += dt
            if microGlitchTimer > microGlitchCooldown {
                microGlitchActive = true
                microGlitchDuration = 0.02 + Double.random(in: 0...0.04)
                microGlitchTimer = 0
            }
        } else {
            microGlitchDuration -= dt
            if microGlitchDuration <= 0 {
                microGlitchActive = false
                microGlitchCooldown = 3.0 + Double.random(in: 0...5)
            }
        }
    }

    private var microGlitchOffset: (Double, Double) {
        guard microGlitchActive else { return (0, 0) }
        return (
            (Double.random(in: -1...1) - 0.5) * 1.5,
            (Double.random(in: -1...1) - 0.5) * 1.5
        )
    }

    // MARK: - Layers

    private var ambientGlow: some View {
        Circle()
            .fill(theme.glowColor.opacity(0.08 + spawnProgress * 0.12 + (isTyping ? typingPulse * 0.08 : 0)))
            .frame(width: 70, height: 70)
            .blur(radius: 8)
            .scaleEffect(1.0 + breatheSlow * 0.08 * spawnProgress + (isTyping ? typingPulse * 0.06 : 0))
    }

    private var typingFlashLayer: some View {
        guard isTyping else { return AnyView(EmptyView()) }
        return AnyView(
            Circle()
                .fill(Color.white.opacity(0.25 * typingPulse * spawnProgress))
                .frame(width: 34 + typingPulse * 6, height: 34 + typingPulse * 6)
                .blur(radius: 4)
                .offset(
                    x: (sin(phase * 0.3 + 1.0) * 1.5 * spawnProgress) + glitchOffsetX + microGlitchOffset.0,
                    y: (cos(phase * 0.4 + 2.0) * 1.5 * spawnProgress) + glitchOffsetY + microGlitchOffset.1
                )
        )
    }

    private var coreLayer: some View {
        let pulseGlow = isTyping ? typingPulse * 0.5 : 0
        let baseFill = theme.primaryColor.opacity(0.5 + spawnProgress * 0.3)
        let typingTint = Color.white.opacity(pulseGlow)

        return ZStack {
            Circle()
                .fill(baseFill)
                .overlay(Circle().fill(typingTint).blendMode(.screen))
                .frame(width: 28, height: 28)
                .shadow(
                    color: isTyping
                        ? Color.cyan.opacity(0.6 + pulseGlow * 0.4)
                        : theme.glowColor.opacity(0.6),
                    radius: 6 + intensity * 4 + (isTyping ? typingPulse * 3 : 0)
                )

            Circle()
                .stroke(
                    baseFill.opacity(0.3 + spawnProgress * 0.3),
                    lineWidth: 1
                )
                .frame(
                    width: 32 + breathe * 2.5 * spawnProgress,
                    height: 32 + breathe * 2.5 * spawnProgress
                )
        }
        .offset(
            x: (sin(phase * 0.3 + 1.0) * 1.5 * spawnProgress) + glitchOffsetX + microGlitchOffset.0,
            y: (cos(phase * 0.4 + 2.0) * 1.5 * spawnProgress) + glitchOffsetY + microGlitchOffset.1
        )
    }

    private var eyeLayer: some View {
        let eyeX = sin(phase * 0.5) * 3.0 * spawnProgress
        let eyeY = cos(phase * 0.3 + 1.0) * 2.0 * spawnProgress
        let blink = abs(sin(phase * 0.8)) > 0.95 ? 0.1 : 1.0

        return ZStack {
            Circle()
                .stroke(theme.eyeColor.opacity(0.9), lineWidth: 1.5)
                .frame(width: 10, height: 10)
            Circle()
                .fill(theme.eyeColor)
                .frame(width: 4 * blink, height: 4 * blink)
        }
        .offset(
            x: eyeX + glitchOffsetX * 0.5 + microGlitchOffset.0 * 0.5,
            y: eyeY + glitchOffsetY * 0.5 + microGlitchOffset.1 * 0.5
        )
        .opacity(spawnProgress)
    }

    private var ringLayer: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { i in
                AvatarRing(
                    index: i, phase: phase, theme: theme,
                    intensity: intensity, spawnProgress: spawnProgress,
                    flicker: glitchActive ? glitchRingFlicker : 1.0
                )
            }
        }
    }

    private func fragmentLayer(in geo: GeometryProxy) -> some View {
        let cx = geo.size.width / 2
        let cy = geo.size.height / 2
        return ZStack {
            ForEach(0..<6, id: \.self) { i in
                AvatarFragment(
                    index: i, phase: phase, theme: theme,
                    intensity: intensity, spawnProgress: spawnProgress,
                    cx: cx, cy: cy,
                    scale: glitchFragmentScale * (microGlitchActive ? 1.02 : 1.0)
                )
            }
        }
    }

    private var particleLayer: some View {
        ZStack {
            ForEach(0..<10, id: \.self) { i in
                AvatarParticle(index: i, phase: phase, theme: theme, spawnProgress: spawnProgress)
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
    let flicker: Double

    private var radius: CGFloat { CGFloat(22 + index * 12) }
    private var rotation: Angle { .radians(phase * (0.3 + Double(index) * 0.15) + Double(index) * .pi / 3) }
    private var wobble: Double { sin(phase * 0.5 + Double(index)) * 0.08 * spawnProgress }

    var body: some View {
        Ellipse()
            .stroke(
                theme.primaryColor.opacity(
                    min(1.0, (0.25 + Double(index) * 0.1 + intensity * 0.15) * flicker)
                ),
                style: StrokeStyle(lineWidth: 1, dash: [4, index == 1 ? 2 : 6])
            )
            .frame(
                width: radius * 2 * (1 + CGFloat(wobble)),
                height: radius * 2 * (1 - CGFloat(wobble) * 0.5)
            )
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
    let cx: CGFloat
    let cy: CGFloat
    let scale: Double

    private var orbitAngle: Double { phase * 0.4 + (Double(index) / 6.0) * .pi * 2 }
    private var bob: CGFloat { CGFloat(sin(phase * (1.0 + Double(index) * 0.3)) * 3.0) }
    private var size: CGFloat { CGFloat(3 + Double(index % 3) * 1.5) * CGFloat(scale) }
    private var orbitRadius: CGFloat { 32 }

    var body: some View {
        let x = cos(orbitAngle) * Double(orbitRadius)
        let y = sin(orbitAngle) * Double(orbitRadius) * 0.6 + Double(bob)

        return Group {
            switch index % 4 {
            case 0:
                Triangle()
                    .fill(theme.primaryColor.opacity(0.6 + intensity * 0.3))
                    .frame(width: size, height: size)
            case 1:
                Diamond()
                    .fill(theme.primaryColor.opacity(0.6 + intensity * 0.3))
                    .frame(width: size, height: size)
            case 2:
                Rectangle()
                    .fill(theme.primaryColor.opacity(0.6 + intensity * 0.3))
                    .frame(width: size, height: size * 0.6)
            default:
                Circle()
                    .stroke(theme.primaryColor.opacity(0.6 + intensity * 0.3), lineWidth: 0.8)
                    .frame(width: size, height: size)
            }
        }
        .offset(x: cx + CGFloat(x) - cx, y: cy + CGFloat(y) - cy)
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

    private var r: Double { 18 + Double(index % 5) * 8 }
    private var theta: Double { phase * 0.15 + (Double(index) / 10.0) * .pi * 2 }
    private var phi: Double { acos(Double(index % 3) / 3.0 * 2 - 1) }
    private var brightness: Double { 0.3 + 0.4 * sin(phase * 0.8 + Double(index) * 2.0) }

    var body: some View {
        let x = r * sin(phi) * cos(theta)
        let y = r * sin(phi) * sin(theta) * 0.5

        Circle()
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
                primaryColor: Color(white: 0.27),
                glowColor: Color(white: 0.13),
                eyeColor: Color(white: 0.40)
            )
        }
        switch state {
        case .idle:
            return AvatarTheme(primaryColor: .gray, glowColor: .cyan, eyeColor: .red)
        case .listening:
            return AvatarTheme(primaryColor: .red, glowColor: .pink, eyeColor: .white)
        case .transcribing:
            return AvatarTheme(primaryColor: .orange, glowColor: .yellow, eyeColor: .white)
        case .responding:
            return AvatarTheme(primaryColor: .blue, glowColor: .cyan, eyeColor: .white)
        case .speaking:
            return AvatarTheme(primaryColor: .purple, glowColor: .pink, eyeColor: .white)
        case .typing:
            return AvatarTheme(primaryColor: .cyan, glowColor: .cyan, eyeColor: .white)
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
