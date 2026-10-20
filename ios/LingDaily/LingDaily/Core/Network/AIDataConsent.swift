import Foundation

/// Device-local, versioned permission; never inferred from microphone permission or login.
enum AIDataConsent {
    static let version = "2026-10-20"
    static let key = "aiDataConsentVersion"
    static let dateKey = "aiDataConsentDate"
    static let requested = Notification.Name("LingDailyAIDataConsentRequested")

    static func isGranted(defaults: UserDefaults = .standard) -> Bool {
        defaults.string(forKey: key) == version
    }

    static func grant(defaults: UserDefaults = .standard) {
        defaults.set(Date(), forKey: dateKey)
        defaults.set(version, forKey: key)
    }

    static func revoke(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: key)
        defaults.removeObject(forKey: dateKey)
    }
}
