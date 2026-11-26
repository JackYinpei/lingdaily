import Combine
import Foundation

@MainActor
final class AISettingsStore: ObservableObject {
    @Published private(set) var settings: AISettings
    var onChange: ((AISettings) -> Void)?

    init() {
        settings = AISettingsKeychain.load() ?? AISettings()
    }

    func update(_ next: AISettings) {
        var updated = next.sanitized()
        updated.updatedAt = AISettings.millisecondAligned(Date())
        AISettingsKeychain.save(updated)
        settings = updated
        onChange?(updated)
    }

    func replaceFromSync(_ remote: AISettings) {
        let sanitized = remote.sanitized()
        AISettingsKeychain.save(sanitized)
        if settings != sanitized {
            settings = sanitized
        }
    }

    func clear() {
        AISettingsKeychain.delete()
        settings = AISettings()
    }
}
