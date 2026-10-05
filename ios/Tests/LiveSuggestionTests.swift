import Foundation
import XCTest
@testable import PracticeCore

final class LiveSuggestionTests: XCTestCase {
    private let scenario = PracticeScenario(id: "deadline", title: "把延期说清楚", subtitle: "", category: "职场", symbol: "calendar",
        partner: "Alex", partnerRole: "同事", setting: "你负责的注册页周五上线。",
        steps: (0..<3).map { PracticeStep(id: "s\($0)", goal: "目标\($0)", prompt: "How is it going?", translation: "译", hint: "", keywords: "", expression: "", meaning: "") })

    func testOnlyAnUnansweredPartnerLineCountsAsWaiting() {
        XCTAssertNil(LiveStuckPolicy.awaitedLine(in: PracticeSession(scenario: scenario, useAI: true)), "Nothing said yet")
        var session = PracticeSession(scenario: scenario)
        XCTAssertEqual(LiveStuckPolicy.awaitedLine(in: session), session.messages[0].id)
        XCTAssertTrue(session.submit("We found a bug."))
        XCTAssertNil(LiveStuckPolicy.awaitedLine(in: session), "The learner already answered")
    }

    func testRequestCarriesTheSceneAndRecentConversation() throws {
        XCTAssertNil(LiveSuggestionRequest(session: PracticeSession(scenario: scenario, useAI: true)))
        let request = try XCTUnwrap(LiveSuggestionRequest(session: PracticeSession(scenario: scenario)))
        XCTAssertEqual(request.scenario.partner, "Alex")
        XCTAssertEqual(request.scenario.goals, ["目标0", "目标1", "目标2"])
        XCTAssertEqual(request.messages.map(\.text), ["How is it going?"])
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(request)) as? [String: Any]
        XCTAssertEqual(Set(json?.keys.map { $0 } ?? []), ["requestId", "scenario", "goal", "context", "stepIndex", "messages"],
                       "Matches the server's strict schema")
    }
}
