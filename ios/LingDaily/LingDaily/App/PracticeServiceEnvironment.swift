import SwiftUI

private struct PracticeServiceKey: EnvironmentKey {
    static let defaultValue: any PracticeServing = PracticeAPIClient()
}

extension EnvironmentValues {
    /// The AI service practice and settings views call; replace it to fake the network in previews.
    var practiceService: any PracticeServing {
        get { self[PracticeServiceKey.self] }
        set { self[PracticeServiceKey.self] = newValue }
    }
}
