import Foundation

/// Features whose model the learner can pick in 「我的」. The server publishes
/// the allowed choices and ignores anything else, so this is only a preference.
enum AIModelFeature: String, CaseIterable, Identifiable {
    case practice, suggest, translate, live
    var id: String { rawValue }
    var title: String {
        switch self {
        case .practice: return "文字对话"
        case .suggest: return "卡住时的建议"
        case .translate: return "单句翻译"
        case .live: return "语音通话"
        }
    }
}

enum AIModelPreference {
    static func key(_ feature: AIModelFeature) -> String { "aiModel.\(feature.rawValue)" }

    /// nil means "use the server default".
    static func model(for feature: AIModelFeature, defaults: UserDefaults = .standard) -> String? {
        guard let value = defaults.string(forKey: key(feature)), !value.isEmpty, value.count <= 100 else { return nil }
        return value
    }
}

/// The server's allowed models per feature (`GET /api/ios/models`).
struct AIModelCatalog: Decodable, Equatable {
    struct Choice: Decodable, Hashable { let id, note: String }
    struct Feature: Decodable, Equatable { let `default`: String; let choices: [Choice] }
    let practice, suggest, translate, live: Feature

    func feature(_ feature: AIModelFeature) -> Feature {
        switch feature {
        case .practice: return practice
        case .suggest: return suggest
        case .translate: return translate
        case .live: return live
        }
    }
}
