import Foundation
import XCTest
@testable import PracticeCore

final class LiveKickoffTests: XCTestCase {
    private let scenario = PracticeScenario(id: "deadline", title: "把延期说清楚", subtitle: "", category: "职场", symbol: "calendar",
        partner: "Alex", partnerRole: "同事", setting: "周三下午。",
        steps: (0..<3).map { PracticeStep(id: "s\($0)", goal: "目标", prompt: "P?", translation: "译", hint: "", keywords: "", expression: "", meaning: "") })

    func testFreshRehearsalAsksThePartnerToOpen() {
        let kickoff = LiveKickoff.text(for: PracticeSession(scenario: scenario, useAI: true))
        XCTAssertEqual(kickoff, LiveKickoff.fresh(scenario))
        XCTAssertTrue(kickoff?.contains("You are Alex (同事); I am the learner") == true)
    }

    func testUnansweredPartnerLineSendsNothingSoItIsNotRepeated() {
        var session = PracticeSession(scenario: scenario) // opens with the partner's prompt
        XCTAssertNil(LiveKickoff.text(for: session))
        XCTAssertTrue(session.submit("I need two more days."))
        XCTAssertEqual(LiveKickoff.text(for: session), LiveKickoff.replyToLearner(scenario))
    }

    func testTranslationIsStoredOnlyOnPartnerLines() {
        var session = PracticeSession(scenario: scenario)
        XCTAssertTrue(session.submit("I need two more days."))
        let partner = session.messages[0], learner = session.messages[1]
        let later = Date().addingTimeInterval(60)
        XCTAssertTrue(session.applyTranslation(" 周五还能按时完成吗？ ", to: partner.id, now: later))
        XCTAssertEqual(session.messages[0].translation, "周五还能按时完成吗？")
        XCTAssertEqual(session.updatedAt, later, "A new translation must be synced")
        XCTAssertFalse(session.applyTranslation("我还需要两天。", to: learner.id))
        XCTAssertFalse(session.applyTranslation("  ", to: partner.id))
    }
}
