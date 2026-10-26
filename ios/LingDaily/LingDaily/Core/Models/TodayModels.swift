import Foundation

/// 「今日」 from `GET /api/ios/today`: the latest daily podcast and a rehearsal about one of its stories.
struct TodayEpisode: Codable {
    struct Term: Codable, Equatable, Identifiable {
        let term, meaning, example: String
        var id: String { SavedExpression.key(term) }
        /// 词库 type for a podcast term.
        var kind: String { term.contains(" ") ? "phrase" : "word" }
    }
    let date: String
    let title: String
    let summary: String
    let audioURL: URL?
    let duration: Int?
    let vocabulary: [Term]
    let scenario: AIScenarioResponse.Draft?

    /// Streamed only over HTTPS.
    var playableURL: URL? { audioURL?.scheme == "https" ? audioURL : nil }
    /// One id per episode, so every rehearsal about it shares an identity and a colour.
    var practiceScenario: PracticeScenario? { scenario?.practiceScenario(id: "today-\(date)") }
    /// Where its terms say they came from in 词库, e.g. 每日播客 10月26日.
    var source: String {
        let parts = date.split(separator: "-").compactMap { Int($0) }
        return parts.count == 3 ? "每日播客 \(parts[1])月\(parts[2])日" : "每日播客"
    }
}

struct TodayResponse: Decodable {
    let today: TodayEpisode?
}

/// Built-in rehearsals from `GET /api/ios/scenarios`; the four bundled ones are the offline fallback.
struct ScenarioCatalogResponse: Decodable {
    let version: Int
    let scenarios: [PracticeScenario]

    /// Entries the app can practise: three filled-in steps and an id no learner or daily scenario uses.
    var validScenarios: [PracticeScenario] {
        var seen = Set<String>()
        return scenarios.filter { scenario in
            let texts = [scenario.title, scenario.subtitle, scenario.category, scenario.partner, scenario.partnerRole, scenario.setting]
                + scenario.steps.flatMap { [$0.id, $0.goal, $0.prompt, $0.translation, $0.hint, $0.keywords, $0.expression, $0.meaning] }
            return scenario.steps.count == 3
                && scenario.id.range(of: "^[a-z][a-z0-9-]{1,39}$", options: .regularExpression) != nil
                && !scenario.id.hasPrefix("custom-") && !scenario.id.hasPrefix("today-")
                && texts.allSatisfy { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && $0.count <= 400 }
                && seen.insert(scenario.id).inserted
        }
    }
}
