import Foundation
import XCTest
@testable import PracticeCore

final class RecallAndReminderTests: XCTestCase {
    private let scenario = PracticeScenario(id: "deadline", title: "把延期说清楚", subtitle: "", category: "职场", symbol: "calendar",
        partner: "Alex", partnerRole: "同事", setting: "你负责的注册页周五上线。",
        steps: (0..<3).map { PracticeStep(id: "s\($0)", goal: "目标\($0)", prompt: "How is it going?", translation: "译", hint: "",
                                          keywords: "", expression: "Reference \($0).", meaning: "参考\($0)") })

    private func liveSession(saying lines: [String], review: [ReviewTarget] = []) -> PracticeSession {
        var session = PracticeSession(scenario: scenario, useAI: true, reviewItems: review)
        session.beginLive(model: "live-model")
        for line in lines { XCTAssertTrue(session.liveTranscript(id: UUID(), role: .user, text: line)) }
        return session
    }

    func testRecallIgnoresCasePunctuationAndSimpleEndings() {
        XCTAssertTrue(RecallMatcher.matches(target: "availability", heard: "What's your Availability on Friday?"))
        XCTAssertTrue(RecallMatcher.matches(target: "move the launch", heard: "Could we moved the launch to Monday"))
        XCTAssertTrue(RecallMatcher.matches(target: "try", heard: "He tries again."))
        XCTAssertFalse(RecallMatcher.matches(target: "move the launch", heard: "the launch, move it"), "A phrase keeps its order")
        XCTAssertFalse(RecallMatcher.matches(target: "deadline", heard: ""))
        let sentence = "I need about two more days to fix and test it."
        XCTAssertTrue(RecallMatcher.matches(target: sentence, heard: "I need about two more days to fix and test it"))
        XCTAssertTrue(RecallMatcher.matches(target: sentence, heard: "I need about 2 more days to fix and test it."), "One STT change is fine")
        XCTAssertFalse(RecallMatcher.matches(target: sentence, heard: "I need more time."))
    }

    func testReviewPickerBringsBackFreshWordsNotSentencesOrUsedOnes() {
        var archive = PracticeArchive()
        archive.collect([AILearningItem(text: "on track", type: "phrase", meaning: "按计划"),
                         AILearningItem(text: "availability", type: "word", meaning: "空闲时间"),
                         AILearningItem(text: "would rather", type: "grammar", meaning: "宁愿")], source: "s")
        archive.toggleExpression(text: "Could we move it to Monday?", meaning: "能改到周一吗？", source: "s")
        XCTAssertEqual(ReviewPicker.pick(from: archive).map(\.text), ["on track", "availability"], "Newest first; no sentence or grammar")

        archive.upsert(liveSession(saying: ["We are on track."], review: [ReviewTarget(text: "on track", meaning: "按计划")]))
        XCTAssertEqual(ReviewPicker.pick(from: archive).map(\.text), ["availability"], "Used ones are not brought back")
        archive.upsert(liveSession(saying: ["Hello."], review: [ReviewTarget(text: "availability", meaning: "空闲时间")]))
        archive.collect([AILearningItem(text: "verification code", type: "phrase", meaning: "验证码")], source: "s")
        XCTAssertEqual(ReviewPicker.pick(from: archive).map(\.text), ["verification code", "availability"], "Least targeted first")
        archive.collect([AILearningItem(text: "room service", type: "phrase", meaning: "客房服务")], source: "入住出了点小状况")
        let hotel = PracticeScenario(id: "hotel", title: "入住出了点小状况", subtitle: "", category: "旅行", symbol: "", partner: "Jamie",
                                     partnerRole: "前台", setting: "", steps: scenario.steps)
        XCTAssertEqual(ReviewPicker.pick(from: archive, for: hotel).first?.text, "room service", "Words met in this scenario come first")
    }

    func testSessionCarriesLevelAndReviewItemsOnlyWhenSet() throws {
        let standard = PracticeSession(scenario: scenario, useAI: true)
        let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(XCTUnwrap(standard.pendingAIRequest))) as? [String: Any]
        XCTAssertNil(encoded?["level"], "Standard requests match older servers")
        XCTAssertNil(encoded?["reviewItems"])
        let review = [ReviewTarget(text: "availability", meaning: "空闲时间")]
        let easy = PracticeSession(scenario: scenario, useAI: true, level: .easy, reviewItems: review)
        XCTAssertEqual(easy.pendingAIRequest?.level, "easy")
        XCTAssertEqual(easy.pendingAIRequest?.reviewItems, review)
        XCTAssertEqual(LiveTokenRequest(session: easy).level, "easy")
        XCTAssertEqual(LiveTokenRequest(session: easy).reviewItems, review)
        let restored = try JSONDecoder().decode(PracticeSession.self, from: JSONEncoder().encode(easy))
        XCTAssertEqual(restored.practiceLevel, .easy)

        // An archive from 1.0 has none of the new keys; a newer level never breaks decoding.
        var json = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(easy)) as? [String: Any])
        json["level"] = "expert"
        let newer = try JSONDecoder().decode(PracticeSession.self, from: JSONSerialization.data(withJSONObject: json))
        XCTAssertEqual(newer.practiceLevel, .standard)
        json.removeValue(forKey: "level"); json.removeValue(forKey: "reviewItems")
        XCTAssertNoThrow(try JSONDecoder().decode(PracticeSession.self, from: JSONSerialization.data(withJSONObject: json)))
    }

    func testLiveCollectedWordsAndReusedReviewItemsReachTheSummary() {
        let review = [ReviewTarget(text: "availability", meaning: "空闲时间"), ReviewTarget(text: "on track", meaning: "按计划")]
        var session = liveSession(saying: ["Is there any availability on Monday?"], review: review)
        session.recordCollected([AILearningItem(text: "verification code", type: "phrase", meaning: "验证码")])
        session.recordCollected([AILearningItem(text: "Verification code", type: "phrase", meaning: "验证码")])
        XCTAssertEqual(session.collectedItems.map(\.text), ["verification code"])
        XCTAssertEqual(session.reusedReviewItems.map(\.text), ["availability"])
        XCTAssertEqual(session.summaryLines.map(\.text), ["Is there any availability on Monday?"])
        XCTAssertTrue(session.summaryLines[0].isOwnWords, "No note on this task: keep the learner's own words")
    }

    func testLiveCorrectionGetsItsChineseMeaningOnce() throws {
        var session = liveSession(saying: ["I go to office yesterday."])
        XCTAssertTrue(session.liveCorrection(original: "I go to office yesterday.",
                                             feedback: AIFeedback(revised: "I went to the office yesterday.", meaning: "", note: "过去时")))
        let id = try XCTUnwrap(session.messages.last?.id)
        XCTAssertTrue(session.applyFeedbackMeaning("我昨天去了办公室。", to: id))
        XCTAssertEqual(session.feedback(for: id)?.meaning, "我昨天去了办公室。")
        XCTAssertFalse(session.applyFeedbackMeaning("覆盖", to: id), "An existing meaning is never replaced")
        XCTAssertEqual(session.summaryLines.first?.meaning, "我昨天去了办公室。")
        XCTAssertFalse(session.summaryLines[0].isOwnWords)
    }

    func testReviewDeckPutsNewItemsFirstThenTheLongestUnreviewed() {
        var archive = PracticeArchive()
        archive.collect(["a", "b", "c"].map { AILearningItem(text: $0, type: "word", meaning: "义\($0)") }, source: "s")
        archive.toggleExpression(text: "No meaning yet", meaning: "", source: "s")
        var log = ReviewLog()
        log.record("a", recalled: true, now: Date(timeIntervalSince1970: 200))
        log.record("b", recalled: false, now: Date(timeIntervalSince1970: 100))
        XCTAssertEqual(log.deck(from: archive.expressions).map(\.id), ["c", "b", "a"])
        XCTAssertEqual(log.entries["a"], .init(lastReviewedAt: Date(timeIntervalSince1970: 200), attempts: 1, recalled: 1))
    }

    func testRecentStatsCountOnlyTheLearnersOwnTurns() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let now = Date(timeIntervalSince1970: 1_793_000_000)
        var old = PracticeSession(scenario: scenario, now: now.addingTimeInterval(-10 * 86_400))
        old.submit("Long ago.", now: now.addingTimeInterval(-10 * 86_400))
        var recent = PracticeSession(scenario: scenario, now: now.addingTimeInterval(-86_400))
        recent.submit("Yesterday.", now: now.addingTimeInterval(-86_400))
        XCTAssertEqual(PracticeStats.recent([old, recent], now: now, calendar: calendar).activeDays, 1)
        XCTAssertEqual(PracticeStats.recent([old, recent], now: now, calendar: calendar).turns, 1)
        XCTAssertFalse(PracticeStats.spokeToday([old, recent], now: now, calendar: calendar))
    }

    func testVocabularyLeadsBackToTheRehearsalItCameFrom() {
        var archive = PracticeArchive()
        var session = liveSession(saying: ["The page is almost done."])
        session.recordCollected([AILearningItem(text: "on track", type: "phrase", meaning: "按计划")])
        archive.upsert(session)
        archive.collect([AILearningItem(text: "on track", type: "phrase", meaning: "按计划")], source: scenario.title)
        XCTAssertEqual(archive.session(for: archive.expressions[0])?.id, session.id)
        XCTAssertNil(archive.session(for: SavedExpression(id: "x", text: "x", meaning: "", source: "其他", createdAt: Date())))
    }

    func testRemindersSkipPastTimesAndTodayOncePractised() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let now = try XCTUnwrap(calendar.date(from: DateComponents(year: 2026, month: 10, day: 26, hour: 21)))
        let tomorrow = try XCTUnwrap(calendar.date(byAdding: .day, value: 1, to: now))
        XCTAssertEqual(ReminderPlan.event(on: tomorrow, now: now, calendar: calendar).map(\.isSameDay), [true], "20:00 tonight has passed")
        let later = try XCTUnwrap(calendar.date(byAdding: .day, value: 3, to: now))
        let events = ReminderPlan.event(on: later, now: now, calendar: calendar)
        XCTAssertEqual(events.map { calendar.component(.hour, from: $0.date) }, [20, 8])
        XCTAssertEqual(ReminderPlan.daily(hour: 21, minute: 30, practicedToday: false, now: now, calendar: calendar).count, 7)
        let practised = ReminderPlan.daily(hour: 21, minute: 30, practicedToday: true, now: now, calendar: calendar)
        XCTAssertEqual(practised.count, 6)
        XCTAssertEqual(calendar.component(.day, from: practised[0]), 27)
        XCTAssertEqual(ReminderPlan.daily(hour: 20, minute: 0, practicedToday: false, now: now, calendar: calendar).count, 6, "20:00 today has passed")
    }

    func testTodayAndCatalogDecodeAndRejectWhatTheAppCannotPractise() throws {
        let step = #"{"goal":"说说新闻","prompt":"Did you hear about it?","translation":"你听说了吗？","hint":"先说是什么新闻。","keywords":"I heard","expression":"I heard that foldable phones got cheaper.","meaning":"我听说折叠屏降价了。"}"#
        let today = try JSONDecoder().decode(TodayResponse.self, from: Data("""
        {"today":{"date":"2026-10-26","title":"LingDaily 10/26","summary":"今天聊折叠屏。","audioURL":"https://cos.example.test/a.mp3",
        "duration":612,"vocabulary":[{"term":"foldable phone","meaning":"折叠屏手机","example":"It's a foldable phone."}],
        "scenario":{"title":"聊聊折叠屏","subtitle":"说说看法","category":"社交","partner":"Riley","partnerRole":"同事",
        "setting":"今天的 LingDaily 播客聊到折叠屏降价。","steps":[\(step),\(step),\(step)]}}}
        """.utf8)).today
        XCTAssertEqual(today?.practiceScenario?.id, "today-2026-10-26")
        XCTAssertEqual(today?.vocabulary.first?.kind, "phrase")
        XCTAssertEqual(today?.source, "每日播客 10月26日")
        XCTAssertNotNil(today?.playableURL)
        XCTAssertNil(try JSONDecoder().decode(TodayResponse.self, from: Data(#"{"today":null}"#.utf8)).today)

        func catalog(_ ids: [String], steps: Int = 3) throws -> [String] {
            let stepJSON = #"{"id":"a","goal":"g","prompt":"p","translation":"t","hint":"h","keywords":"k","expression":"e","meaning":"m"}"#
            let items = ids.map { #"{"id":"\#($0)","title":"t","subtitle":"s","category":"日常","symbol":"house","partner":"Avery","partnerRole":"邻居","setting":"情境","steps":[\#(Array(repeating: stepJSON, count: steps).joined(separator: ","))]}"# }
            return try JSONDecoder().decode(ScenarioCatalogResponse.self, from: Data(#"{"version":2,"scenarios":[\#(items.joined(separator: ","))]}"#.utf8)).validScenarios.map(\.id)
        }
        XCTAssertEqual(try catalog(["neighbor", "custom-1", "today-2026", "Bad Id", "neighbor"]), ["neighbor"])
        XCTAssertEqual(try catalog(["neighbor"], steps: 2), [])
    }
}
