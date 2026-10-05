import SwiftUI

// Paper, ink, and one accent. Principles and usage rules: docs/ios/02-design-system.md.
// Ink = actions and the learner's own words; accent = state (progress, selected, saved).
enum Brand {
    static let page = adaptive(0xF6F2EA, 0x151412)
    static let surface = adaptive(0xFFFDF8, 0x211F1B)
    static let ink = adaptive(0x1E1C19, 0xF2EEE6)
    static let onInk = adaptive(0xFFFDF8, 0x151412)
    static let secondary = adaptive(0x6F6A62, 0xA39D93)
    /// Secondary text on scenario tones; `secondary` alone is too faint there (≥ 4.5:1 kept).
    static let inkOnTone = ink.opacity(0.72)
    static let line = adaptive(0xE6DFD3, 0x35322C)
    static let accent = adaptive(0xC2451E, 0xF08A64)

    /// Each scenario owns one muted tone, used for its card and its partner's avatar.
    /// Learner-created scenarios reuse the same four tones, picked by a stable hash of their id.
    static func tone(_ scenarioID: String) -> Color {
        let tones = [adaptive(0xDCE6D3, 0x28332A), adaptive(0xD6E2EE, 0x232E38),
                     adaptive(0xF0E2B6, 0x37301F), adaptive(0xF1D8CA, 0x3A2A23)]
        switch scenarioID {
        case "deadline": return tones[0]
        case "hotel": return tones[1]
        case "introduction": return tones[2]
        case "coffee": return tones[3]
        default: return tones[scenarioID.unicodeScalars.reduce(0) { $0 + Int($1.value) } % tones.count]
        }
    }

    /// English learning content reads like a book; UI chrome stays in the system face.
    static func english(_ style: Font.TextStyle = .body) -> Font { .system(style, design: .serif) }

    static func adaptive(_ light: UInt, _ dark: UInt) -> Color {
        Color(UIColor { traits in UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light) })
    }
}

extension UIColor {
    convenience init(hex: UInt) {
        self.init(red: CGFloat((hex >> 16) & 255) / 255,
                  green: CGFloat((hex >> 8) & 255) / 255,
                  blue: CGFloat(hex & 255) / 255, alpha: 1)
    }
}

struct PageBackground: View {
    var body: some View { Brand.page.ignoresSafeArea() }
}

/// The only button style: filled ink for the main action, outlined for the alternative.
struct SolidButtonStyle: ButtonStyle {
    var secondary = false
    @Environment(\.isEnabled) private var enabled
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .foregroundColor(secondary ? Brand.ink : Brand.onInk)
            .background(secondary ? Color.clear : Brand.ink)
            .overlay(Capsule().stroke(secondary ? Brand.line : .clear, lineWidth: 1.5))
            .clipShape(Capsule())
            .opacity(enabled ? (configuration.isPressed ? 0.7 : 1) : 0.35)
    }
}

/// A conversation partner is a person, not a feature icon: initial on the scenario tone.
struct Avatar: View {
    let scenario: PracticeScenario
    var size: CGFloat = 40
    var body: some View {
        Text(String(scenario.partner.prefix(1)))
            .font(.system(size: size * 0.44, weight: .semibold, design: .serif))
            .foregroundColor(Brand.ink)
            .frame(width: size, height: size)
            .background(Brand.tone(scenario.id))
            .overlay(Circle().stroke(Brand.ink.opacity(0.08)))
            .clipShape(Circle())
            .accessibilityHidden(true)
    }
}

struct PageTitle: View {
    let title: String
    var subtitle: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.largeTitle.bold()).foregroundColor(Brand.ink)
            if let subtitle {
                Text(subtitle).font(.subheadline).foregroundColor(Brand.secondary)
            }
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct EmptyState: View {
    let title: String
    let message: String
    var body: some View {
        VStack(spacing: 8) {
            Text(title).font(.headline).foregroundColor(Brand.ink)
            Text(message).font(.subheadline).foregroundColor(Brand.secondary)
                .multilineTextAlignment(.center).lineSpacing(4)
        }.frame(maxWidth: .infinity).padding(.vertical, 56).padding(.horizontal, 24)
    }
}

struct StorageBanner: View {
    @EnvironmentObject private var store: PracticeStore
    var body: some View {
        if let error = store.storageError {
            HStack(spacing: 12) {
                Text(error).font(.caption).foregroundColor(Brand.ink)
                Spacer(minLength: 0)
                Button("重试") { store.retrySave() }.font(.caption.bold()).foregroundColor(Brand.accent)
            }.padding(.horizontal, 20).padding(.vertical, 10)
                .frame(maxWidth: .infinity).background(Brand.surface)
                .overlay(alignment: .bottom) { Brand.line.frame(height: 1) }
        }
    }
}

extension View {
    func surfaceCard(padding: CGFloat = 18) -> some View {
        self.padding(padding).background(Brand.surface)
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Brand.line, lineWidth: 1))
    }

    /// Readable column on iPad; full width on iPhone.
    func readableColumn() -> some View {
        frame(maxWidth: 620).frame(maxWidth: .infinity)
    }
}
