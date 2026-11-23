import Foundation

/// What the learner picked on the first-run page: why they practise English and which speaking
/// moments they find hard. Kept on this device only. Ids match app/lib/ios/interests.js and the
/// catalog's `tags`; the home page puts matching scenarios first and 换一批 sends them along.
struct LearnerInterest: Identifiable, Equatable {
    let id: String
    let label: String
    let detail: String
    let symbol: String

    /// 「你练英语，主要为了什么？」
    static let goals: [LearnerInterest] = [
        .init(id: "travel", label: "出国旅行", detail: "酒店、机场、点餐、问路", symbol: "airplane"),
        .init(id: "campus", label: "留学校园", detail: "同学、老师、小组作业", symbol: "graduationcap"),
        .init(id: "work", label: "职场沟通", detail: "开会、提意见、争取时间", symbol: "briefcase"),
        .init(id: "interview", label: "求职面试", detail: "介绍经历、接住追问", symbol: "person.crop.rectangle"),
        .init(id: "social", label: "交朋友", detail: "邻居、聚会、约人出去玩", symbol: "person.2"),
        .init(id: "living", label: "海外生活", detail: "房东、快递、看病、办事", symbol: "house"),
    ]

    /// 「开口时，你最怕哪种场面？」
    static let fears: [LearnerInterest] = [
        .init(id: "fast", label: "对方说太快，听不过来", detail: "", symbol: "hare"),
        .init(id: "pushback", label: "被人怼了，不知道怎么回", detail: "", symbol: "exclamationmark.bubble"),
        .init(id: "smalltalk", label: "冷场，接不上话", detail: "", symbol: "ellipsis.bubble"),
        .init(id: "asking", label: "不好意思拒绝或提要求", detail: "", symbol: "hand.raised"),
    ]

    static let allIDs = Set((goals + fears).map(\.id))
}

/// The learner's picks and whether the first-run page has been answered (or skipped).
/// Stored as one comma-joined string so views can observe it with `@AppStorage`.
enum LearnerInterests {
    static let key = "learnerInterests"
    static let askedKey = "learnerInterestsAsked"

    /// Known ids from a stored value, in order, without repeats.
    static func picks(from raw: String) -> [String] {
        var seen = Set<String>()
        return raw.split(separator: ",").map(String.init).filter { LearnerInterest.allIDs.contains($0) && seen.insert($0).inserted }
    }

    static func raw(from picks: [String]) -> String { self.picks(from: picks.joined(separator: ",")).joined(separator: ",") }

    static func picks(defaults: UserDefaults = .standard) -> [String] { picks(from: defaults.string(forKey: key) ?? "") }

    static func save(_ picks: [String], defaults: UserDefaults = .standard) {
        defaults.set(raw(from: picks), forKey: key)
        defaults.set(true, forKey: askedKey)
    }

    /// Scenarios matching more picks first; ties and unmatched ones keep the catalog order.
    static func ranked(_ scenarios: [PracticeScenario], extras: [String: ScenarioExtras], picks: [String]) -> [PracticeScenario] {
        guard !picks.isEmpty else { return scenarios }
        let wanted = Set(picks)
        return scenarios.enumerated().sorted { left, right in
            let l = score(left.element, extras: extras, wanted: wanted)
            let r = score(right.element, extras: extras, wanted: wanted)
            return l != r ? l > r : left.offset < right.offset
        }.map(\.element)
    }

    /// Up to `limit` scenario ids that match at least one pick, best first, for the 「适合你」 mark.
    static func recommended(_ scenarios: [PracticeScenario], extras: [String: ScenarioExtras], picks: [String], limit: Int = 3) -> Set<String> {
        let wanted = Set(picks)
        return Set(ranked(scenarios, extras: extras, picks: picks)
            .filter { score($0, extras: extras, wanted: wanted) > 0 }.prefix(limit).map(\.id))
    }

    private static func score(_ scenario: PracticeScenario, extras: [String: ScenarioExtras], wanted: Set<String>) -> Int {
        (extras[scenario.id]?.tags ?? []).filter(wanted.contains).count
    }
}

/// Another person who can play a catalog scenario's partner (「换个人」); the first is the default.
struct PartnerCharacter: Codable, Equatable, Hashable {
    let partner: String
    let label: String
    let persona: String
}

/// Catalog fields that are not part of a rehearsal's scenario snapshot, so they never reach sync.
struct ScenarioExtras: Codable, Equatable {
    let id: String
    var tags: [String] = []
    var cast: [PartnerCharacter] = []

    private enum CodingKeys: String, CodingKey { case id, tags, cast }

    init(id: String, tags: [String] = [], cast: [PartnerCharacter] = []) {
        self.id = id
        self.tags = tags
        self.cast = cast
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        tags = (try? container.decodeIfPresent([String].self, forKey: .tags)) ?? []
        // A malformed person is dropped rather than losing the scenario; one person is no choice.
        let people = (try? container.decodeIfPresent([PartnerCharacter].self, forKey: .cast)) ?? []
        let valid = people.filter { person in
            let partner = person.partner.trimmingCharacters(in: .whitespacesAndNewlines)
            return !partner.isEmpty && partner.count <= 40 && !person.label.isEmpty && person.label.count <= 12
                && !person.persona.isEmpty && person.persona.count <= PracticeScenario.personaLimit
        }
        cast = valid.count > 1 ? valid : []
    }
}

extension PracticeScenario {
    /// The same scenario played by another person, for one rehearsal; the saved scenario is unchanged.
    /// Settings and lines that name the partner (「房东 Morgan」) name the new person instead.
    func played(by person: PartnerCharacter) -> PracticeScenario {
        let old = partner
        let new = person.partner
        let rename = { (text: String) in old.isEmpty || old == new ? text : text.replacingOccurrences(of: old, with: new) }
        return PracticeScenario(
            id: id, title: title, subtitle: subtitle, category: category, symbol: symbol,
            partner: new, partnerRole: partnerRole, setting: rename(setting),
            steps: steps.map { step in
                PracticeStep(id: step.id, goal: step.goal, prompt: rename(step.prompt), translation: rename(step.translation),
                             hint: rename(step.hint), keywords: step.keywords, expression: rename(step.expression), meaning: rename(step.meaning))
            },
            persona: Self.cleanPersona(person.persona))
    }
}
