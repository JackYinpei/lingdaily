import Foundation
import XCTest
@testable import PracticeCore

final class PartnerAttitudeTests: XCTestCase {
    private func scenario(persona: String? = nil) -> PracticeScenario {
        PracticeScenario(id: "nearmiss", title: "骑车差点被撞", subtitle: "对方违规还嘴硬", category: "日常", symbol: "bicycle",
            partner: "Blake", partnerRole: "违规掉头的司机", setting: "对向的车跨过黄实线掉头，差点撞到你。",
            steps: (0..<3).map { PracticeStep(id: "s\($0)", goal: "目标", prompt: "P?", translation: "译", hint: "提示",
                                              keywords: "k", expression: "E", meaning: "意") },
            persona: persona)
    }

    private func json<T: Encodable>(_ value: T) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(value)) as? [String: Any])
    }

    func testScenariosWithoutPersonaStillDecodeAndRoundTrip() throws {
        let old = try JSONEncoder().encode(scenario())
        XCTAssertFalse(String(decoding: old, as: UTF8.self).contains("persona"), "nil is omitted for older servers")
        XCTAssertNil(try JSONDecoder().decode(PracticeScenario.self, from: old).persona)
        let withPersona = scenario(persona: "嘴硬，反怪你骑太快")
        XCTAssertEqual(try JSONDecoder().decode(PracticeScenario.self, from: JSONEncoder().encode(withPersona)), withPersona)
    }

    func testNaturalAttitudeIsNeverSentAndOthersAreSentEverywhere() throws {
        let natural = PracticeSession(scenario: scenario(persona: "嘴硬"), useAI: true)
        XCTAssertNil(natural.attitude)
        let request = try json(XCTUnwrap(natural.pendingAIRequest))
        XCTAssertNil(request["attitude"])
        XCTAssertEqual((request["scenario"] as? [String: Any])?["persona"] as? String, "嘴硬")

        let tough = PracticeSession(scenario: scenario(persona: "嘴硬"), useAI: true, attitude: .tough)
        XCTAssertEqual(tough.partnerAttitude, .tough)
        XCTAssertEqual(try json(XCTUnwrap(tough.pendingAIRequest))["attitude"] as? String, "tough")
        let live = try json(LiveTokenRequest(session: tough))
        XCTAssertEqual(live["attitude"] as? String, "tough")
        XCTAssertEqual((live["scenario"] as? [String: Any])?["persona"] as? String, "嘴硬")
        // A scripted session opens with the partner's line, so a suggestion can be asked for.
        let scripted = PracticeSession(scenario: scenario(), attitude: .tough)
        XCTAssertEqual(try json(XCTUnwrap(LiveSuggestionRequest(session: scripted)))["attitude"] as? String, "tough")
    }

    func testAttitudeSurvivesTheArchiveAndUnknownValuesFallBack() throws {
        let friendly = PracticeSession(scenario: scenario(), useAI: true, attitude: .friendly)
        let decoded = try JSONDecoder().decode(PracticeSession.self, from: JSONEncoder().encode(friendly))
        XCTAssertEqual(decoded.partnerAttitude, .friendly)
        var raw = try json(friendly)
        raw["attitude"] = "furious"
        let future = try JSONDecoder().decode(PracticeSession.self, from: JSONSerialization.data(withJSONObject: raw))
        XCTAssertEqual(future.partnerAttitude, .natural)
        XCTAssertNil(future.requestAttitude, "A value this app does not know is not sent")
    }

    func testEditedPersonaIsTrimmedBoundedAndOnlyForThisRehearsal() {
        let original = scenario(persona: "嘴硬")
        XCTAssertEqual(original.withPersona("  热情，乐意帮忙  ").persona, "热情，乐意帮忙")
        XCTAssertNil(original.withPersona("   ").persona)
        XCTAssertEqual(original.withPersona(String(repeating: "长", count: 300)).persona?.count, PracticeScenario.personaLimit)
        XCTAssertEqual(original.persona, "嘴硬")
    }

    func testGeneratedScenarioKeepsItsPersona() throws {
        let data = Data("""
        {"requestId":"\(UUID().uuidString)","model":"m","scenario":{"title":"押金被乱扣","subtitle":"一分不让","category":"日常",
         "partner":"Cameron","partnerRole":"前房东","setting":"房东要扣押金。","persona":" 想多扣钱，不轻易松口 ",
         "steps":[{"goal":"质疑","prompt":"P","translation":"T","hint":"H","keywords":"K","expression":"E","meaning":"M"},
                  {"goal":"证据","prompt":"P","translation":"T","hint":"H","keywords":"K","expression":"E","meaning":"M"},
                  {"goal":"坚持","prompt":"P","translation":"T","hint":"H","keywords":"K","expression":"E","meaning":"M"}]}}
        """.utf8)
        let response = try JSONDecoder().decode(AIScenarioResponse.self, from: data)
        XCTAssertEqual(response.makeScenario()?.persona, "想多扣钱，不轻易松口")
    }

    func testKickoffNoLongerForcesAGreeting() {
        let kickoff = LiveKickoff.fresh(scenario())
        XCTAssertFalse(kickoff.contains("greet me and ask"))
        XCTAssertTrue(kickoff.contains("greet me only if you would"))
    }
}
