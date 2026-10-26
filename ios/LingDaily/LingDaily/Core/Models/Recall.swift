import Foundation

/// Did the learner say this expression? Word-level, ignoring case, punctuation and
/// simple endings (-s, -ed, -ing). It judges recall from a transcript, never pronunciation.
enum RecallMatcher {
    static func stem(_ word: String) -> String {
        var value = word
        if value.count > 4, value.hasSuffix("ies") { value.removeLast(3); value += "y" }
        else {
            for suffix in ["ing", "ed", "es", "s"] where value.count > suffix.count + 2 && value.hasSuffix(suffix) {
                value.removeLast(suffix.count)
                break
            }
        }
        if value.count > 3, value.hasSuffix("e") { value.removeLast() }
        return value
    }

    static func matches(target: String, heard: String) -> Bool {
        let want = LiveCorrectionMatcher.words(target).map(stem)
        let got = LiveCorrectionMatcher.words(heard).map(stem)
        guard !want.isEmpty, got.count >= min(want.count, 6) else { return false }
        if want.count <= 6 {
            // A word or short phrase has to appear, in order.
            return (0...(got.count - want.count)).contains { Array(got[$0..<($0 + want.count)]) == want }
        }
        // A whole sentence: most of its words, since speech-to-text rewrites a few.
        let expected = Set(want)
        return Double(expected.intersection(Set(got)).count) >= Double(expected.count) * 0.8
    }
}

/// "三个词回来找你": picks a few 词库 words for the partner to bring back in a new rehearsal.
enum ReviewPicker {
    static let enabledKey = "reviewWordsInPractice"

    /// Recent words and phrases not yet used in a rehearsal: ones met in this scenario first,
    /// then the least-targeted, so the same three do not come back every time.
    /// Sentences and grammar are left out.
    static func pick(from archive: PracticeArchive, for scenario: PracticeScenario? = nil, limit: Int = 3) -> [ReviewTarget] {
        let used = Set(archive.sessions.flatMap(\.reusedReviewItems).map { SavedExpression.key($0.text) })
        var targeted: [String: Int] = [:]
        for item in archive.sessions.flatMap({ $0.reviewItems ?? [] }) { targeted[SavedExpression.key(item.text), default: 0] += 1 }
        return archive.expressions.enumerated()
            .filter { _, item in
                (item.kind == "word" || item.kind == "phrase") && item.text.count <= 40
                    && !item.meaning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !used.contains(item.id)
            }
            .sorted { left, right in
                let rank = { (item: (offset: Int, element: SavedExpression)) in
                    (item.element.source == scenario?.title ? 0 : 1, targeted[item.element.id] ?? 0, item.offset)
                }
                return rank(left) < rank(right)
            }
            .prefix(limit)
            .map { ReviewTarget(text: $0.element.text, meaning: $0.element.meaning) }
    }
}

/// When each 词库 item was last reviewed on this device and how it went. Not synced.
struct ReviewLog: Codable, Equatable {
    struct Entry: Codable, Equatable {
        var lastReviewedAt: Date
        var attempts: Int
        var recalled: Int
    }
    var entries: [String: Entry] = [:]

    mutating func record(_ key: String, recalled: Bool, now: Date = Date()) {
        var entry = entries[key] ?? Entry(lastReviewedAt: now, attempts: 0, recalled: 0)
        entry.lastReviewedAt = now
        entry.attempts += 1
        if recalled { entry.recalled += 1 }
        entries[key] = entry
    }

    /// Items never reviewed come first (newest first), then the ones reviewed longest ago.
    func deck(from expressions: [SavedExpression], limit: Int = 10) -> [SavedExpression] {
        let candidates = expressions.filter { !$0.meaning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        let fresh = candidates.filter { entries[$0.id] == nil }
        let seen = candidates.compactMap { item in entries[item.id].map { (item, $0.lastReviewedAt) } }
            .sorted { $0.1 < $1.1 }.map(\.0)
        return Array((fresh + seen).prefix(limit))
    }
}

/// Facts only: how many of the last few days the learner spoke, and how many times.
enum PracticeStats {
    static func recent(_ sessions: [PracticeSession], days: Int = 7, now: Date = Date(),
                       calendar: Calendar = .current) -> (activeDays: Int, turns: Int) {
        guard let start = calendar.date(byAdding: .day, value: -(days - 1), to: calendar.startOfDay(for: now)) else { return (0, 0) }
        let spoken = sessions.flatMap(\.messages).filter { $0.role == .user && $0.createdAt >= start && $0.createdAt <= now }
        return (Set(spoken.map { calendar.startOfDay(for: $0.createdAt) }).count, spoken.count)
    }

    static func spokeToday(_ sessions: [PracticeSession], now: Date = Date(), calendar: Calendar = .current) -> Bool {
        recent(sessions, days: 1, now: now, calendar: calendar).turns > 0
    }
}

/// One line per task on the summary: the coached rewrite when there is one, else the learner's own words.
struct SummaryLine: Identifiable, Equatable {
    let id: Int
    let goal: String
    let text: String
    let meaning: String
    let isOwnWords: Bool
}

extension PracticeSession {
    var summaryLines: [SummaryLine] {
        scenario.steps.indices.compactMap { index in
            let goal = scenario.steps[index].goal
            guard let ai else {
                let step = scenario.steps[index]
                return SummaryLine(id: index, goal: goal, text: step.expression, meaning: step.meaning, isOwnWords: false)
            }
            if let record = ai.feedbacks.last(where: { $0.stepIndex == index }) {
                return SummaryLine(id: index, goal: goal, text: record.feedback.revised, meaning: record.feedback.meaning, isOwnWords: false)
            }
            // No note on this task (Live only coaches what needs it): keep what the learner said.
            let said = messages.filter { $0.role == .user && $0.stepIndex == index }
                .map { $0.text.trimmingCharacters(in: .whitespacesAndNewlines) }.max { $0.count < $1.count }
            guard let said, !said.isEmpty else { return nil }
            return SummaryLine(id: index, goal: goal, text: String(said.prefix(300)), meaning: "", isOwnWords: true)
        }
    }
}

extension PracticeArchive {
    /// The rehearsal a 词库 item came from: the one whose notes or words contain it,
    /// else the closest in time with the same source.
    func session(for expression: SavedExpression) -> PracticeSession? {
        let key = expression.id
        if let exact = sessions.first(where: { session in
            session.collectedItems.contains { SavedExpression.key($0.text) == key }
                || (session.ai?.feedbacks.contains { SavedExpression.key($0.feedback.revised) == key } ?? false)
        }) { return exact }
        let sameSource = sessions.filter { $0.scenario.title == expression.source }
        return sameSource.first { $0.messages.contains { $0.text.lowercased().contains(key) } }
            ?? sameSource.min { abs($0.updatedAt.timeIntervalSince(expression.createdAt)) < abs($1.updatedAt.timeIntervalSince(expression.createdAt)) }
    }
}
