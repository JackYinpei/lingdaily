import Foundation
import XCTest
@testable import PracticeCore

final class AIPracticeTests: XCTestCase {
    private var scenario: PracticeScenario {
        PracticeScenario(id: "deadline", title: "Deadline rehearsal", subtitle: "Ask for time", category: "Work",
            symbol: "calendar", partner: "Alex", partnerRole: "Colleague", setting: "Discuss a project deadline.",
            steps: (0..<3).map { index in
                PracticeStep(id: "\(index)", goal: ["Explain progress", "Agree on a date", "Confirm the plan"][index],
                    prompt: "OLD SCRIPT SHOULD NOT APPEAR", translation: "旧演示", hint: "old", keywords: "old", expression: "old", meaning: "旧")
            })
    }

    private func response(for session: PracticeSession, answer: Bool = false) throws -> AIPracticeResponse {
        let id = try XCTUnwrap(session.pendingAIRequest?.requestId)
        return AIPracticeResponse(requestId: id, model: "test-model", data: AIPracticeTurn(
            reply: "A real model reply", translation: "来自模型的回复", hint: "说说你的计划", keywords: "plan, Thursday",
            suggestedReply: "Could we move it to Thursday?", suggestedMeaning: "能改到周四吗？",
            feedback: answer ? AIFeedback(revised: "I need until Thursday.", meaning: "我需要到周四。", note: "把具体日期说清楚。") : nil))
    }

    func testAIMustReplyBeforeInputOrTaskAdvances() throws {
        var session = PracticeSession(scenario: scenario, useAI: true)
        XCTAssertTrue(session.messages.isEmpty)
        XCTAssertFalse(session.submit("Too early"))
        XCTAssertTrue(session.applyAIResponse(try response(for: session)))
        XCTAssertEqual(session.messages.count, 1)
        XCTAssertFalse(session.messages[0].text.contains("OLD SCRIPT"))
        XCTAssertTrue(session.submit("I need Thursday"))
        XCTAssertEqual(session.pendingAIRequest?.action, .answer)
        session.beginRetry()
        session.advance()
        XCTAssertEqual(session.phase, .review)
        XCTAssertEqual(session.stepIndex, 0)
        XCTAssertFalse(session.submit("Double tap"))
        XCTAssertTrue(session.applyAIResponse(try response(for: session, answer: true)))
        XCTAssertEqual(session.currentFeedback?.revised, "I need until Thursday.")
        session.advance()
        XCTAssertEqual(session.pendingAIRequest?.action, .advance)
        XCTAssertEqual(session.messages.last?.kind, .response)
        XCTAssertTrue(session.applyAIResponse(try response(for: session)))
        XCTAssertEqual(session.messages.last?.kind, .prompt)
        XCTAssertEqual(session.stepIndex, 1)
    }

    func testLateOrDuplicateReplyCannotOverwriteState() throws {
        var session = PracticeSession(scenario: scenario, useAI: true)
        let opening = try response(for: session)
        XCTAssertTrue(session.applyAIResponse(opening))
        XCTAssertFalse(session.applyAIResponse(opening))
        session.submit("I need time")
        let count = session.messages.count
        XCTAssertFalse(session.applyAIResponse(opening))
        XCTAssertEqual(session.messages.count, count)
        XCTAssertNotNil(session.pendingAIRequest)
    }

    func testRetryHasIndependentFeedbackAndKeepsOriginal() throws {
        var session = PracticeSession(scenario: scenario, useAI: true)
        session.applyAIResponse(try response(for: session))
        session.submit("I need Thursday")
        session.applyAIResponse(try response(for: session, answer: true))
        session.beginRetry()
        session.submit("Would Thursday work for you?")
        XCTAssertNil(session.currentFeedback)
        session.applyAIResponse(try response(for: session, answer: true))
        XCTAssertEqual(session.originalAnswer, "I need Thursday")
        XCTAssertEqual(session.retryCount, 1)
        XCTAssertEqual(session.ai?.feedbacks.count, 2)
        XCTAssertEqual(Set(session.ai?.feedbacks.map(\.id) ?? []).count, 2)
        for message in session.messages {
            XCTAssertEqual(session.feedback(for: message.id) != nil, message.role == .user)
        }
        XCTAssertEqual(session.takeaways.count, 1)
    }

    func testPendingRequestIdentitySurvivesArchiveRoundTrip() throws {
        var session = PracticeSession(scenario: scenario, useAI: true)
        session.applyAIResponse(try response(for: session))
        session.submit("An answer awaiting AI")
        var archive = PracticeArchive()
        archive.upsert(session)
        let loaded = try JSONDecoder().decode(PracticeArchive.self, from: JSONEncoder().encode(archive))
        XCTAssertEqual(loaded.sessions.first?.pendingAIRequest?.requestId, session.pendingAIRequest?.requestId)
        XCTAssertEqual(loaded.sessions.first?.messages.last?.text, "An answer awaiting AI")
        XCTAssertTrue(loaded.sessions[0].isValid)
    }

    func testAICompletionCollectsGeneratedExpressionsForAllThreeTasks() throws {
        var session = PracticeSession(scenario: scenario, useAI: true)
        for index in 0..<3 {
            XCTAssertTrue(session.applyAIResponse(try response(for: session)))
            XCTAssertTrue(session.submit("My answer for task \(index)"))
            XCTAssertTrue(session.applyAIResponse(try response(for: session, answer: true)))
            session.advance()
        }
        XCTAssertEqual(session.phase, .completed)
        XCTAssertNil(session.pendingAIRequest)
        XCTAssertEqual(session.userTurns, 3)
        XCTAssertEqual(session.takeaways.count, 3)
        XCTAssertTrue(session.takeaways.allSatisfy { $0.expression == "I need until Thursday." })
        XCTAssertTrue(session.messages.allSatisfy { !$0.text.contains("OLD SCRIPT") })
    }

    func testVersionOneArchiveMigratesWithoutErasingLegacyRecords() throws {
        var session = PracticeSession(scenario: scenario)
        session.submit("Old prototype answer")
        var archive = PracticeArchive()
        archive.upsert(session)
        archive.schemaVersion = 1
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let file = ArchiveFile(url: directory.appendingPathComponent("archive.json"))
        let legacy = try JSONEncoder().encode(archive)
        try legacy.write(to: file.url)
        let migrated = try file.load()
        XCTAssertEqual(migrated.schemaVersion, 2)
        XCTAssertEqual(migrated.sessions.first?.originalAnswer, "Old prototype answer")
        XCTAssertFalse(migrated.sessions[0].isAI)
        XCTAssertEqual(try Data(contentsOf: file.url), legacy) // Loading never overwrites.
    }

    func testArchiveWithoutScenariosKeyStillLoads() throws {
        var archive = PracticeArchive()
        archive.scenarios = [scenario]
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(archive)) as? [String: Any])
        object.removeValue(forKey: "scenarios") // 0.2 archives predate learner-created scenarios.
        let decoded = try JSONDecoder().decode(PracticeArchive.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(decoded.scenarios, [])
        XCTAssertEqual(try JSONDecoder().decode(PracticeArchive.self, from: JSONEncoder().encode(archive)).scenarios, [scenario])
    }

    func testCollectAddsOnlyNewItemsAndKeepsManualSaves() {
        var archive = PracticeArchive()
        archive.toggleExpression(text: "Push it to Thursday", meaning: "推到周四", source: "Manual")
        archive.collect([AILearningItem(text: "push it to thursday", type: "phrase", meaning: "重复"),
                         AILearningItem(text: "deadline", type: "word", meaning: "截止日期"),
                         AILearningItem(text: "Could we…?", type: "grammar", meaning: "委婉请求")], source: "Deadline")
        XCTAssertEqual(archive.expressions.map(\.text), ["deadline", "Could we…?", "Push it to Thursday"])
        XCTAssertEqual(archive.expressions.map(\.kind), ["word", "grammar", nil])
        archive.collect([AILearningItem(text: "Deadline", type: "word", meaning: "again")], source: "Deadline")
        XCTAssertEqual(archive.expressions.count, 3)
    }

    func testFeedbackItemsAreValidated() {
        func turn(_ items: [AILearningItem]) -> AIPracticeTurn {
            AIPracticeTurn(reply: "Sure.", translation: "好的。", hint: "提示", keywords: "k", suggestedReply: "s",
                suggestedMeaning: "意思", feedback: AIFeedback(revised: "r", meaning: "m", note: "n", items: items))
        }
        let good = AILearningItem(text: "deadline", type: "word", meaning: "截止日期")
        XCTAssertTrue(turn([good]).isValid(for: .answer))
        XCTAssertFalse(turn([AILearningItem(text: "x", type: "idiom", meaning: "y")]).isValid(for: .answer))
        XCTAssertFalse(turn(Array(repeating: good, count: 4)).isValid(for: .answer))
    }

    func testGeneratedScenarioNeedsExactlyThreeSteps() {
        let step = AIScenarioResponse.Step(goal: "说明", prompt: "Hi?", translation: "你好？", hint: "提示",
            keywords: "deposit", expression: "I'd like my deposit back.", meaning: "我想要回押金。")
        func response(_ steps: Int) -> AIScenarioResponse {
            AIScenarioResponse(requestId: UUID(), model: "m", scenario: .init(title: "要回押金", subtitle: "退押金",
                category: "日常", partner: "Morgan", partnerRole: "房东", setting: "你要搬走了。",
                steps: Array(repeating: step, count: steps)))
        }
        XCTAssertNil(response(2).makeScenario())
        let scenario = response(3).makeScenario()
        XCTAssertEqual(scenario?.steps.count, 3)
        XCTAssertTrue(scenario?.id.hasPrefix("custom-") ?? false)
        XCTAssertEqual(Set(scenario?.steps.map(\.id) ?? []).count, 3)
    }

    // Explicit opt-in: uses synthetic dialogue and the user's configured Gemini
    // service, with the same URLSession client and models as the iOS app.
    func testLiveGeminiConversation() async throws {
        guard let path = ProcessInfo.processInfo.environment["LINGDAILY_AI_TEST_CONFIG"] else {
            throw XCTSkip("Set LINGDAILY_AI_TEST_CONFIG only for a real model smoke test")
        }
        let config = try JSONDecoder().decode(AIConnectionConfiguration.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let api = PracticeAPIClient(configuration: config)
        var session = PracticeSession(scenario: scenario, goal: "Ask Alex to move our deadline to Thursday", context: "The supplier will send the data on Wednesday. Be friendly.", useAI: true)
        for action in 0..<4 {
            if action == 1 { XCTAssertTrue(session.submit("I need more time because the supplier data arrives Wednesday.")) }
            if action == 2 { session.beginRetry(); XCTAssertTrue(session.submit("Could we move the deadline to Thursday? The data arrives on Wednesday.")) }
            if action == 3 { session.advance() }
            let result = try await api.respond(to: XCTUnwrap(session.pendingAIRequest))
            XCTAssertTrue(session.applyAIResponse(result))
            XCTAssertTrue(session.isValid)
            print("LIVE_AI step=\(action) model=\(result.model) reply=\(result.data.reply)")
            if let feedback = result.data.feedback { print("LIVE_AI feedback=\(feedback.note) revised=\(feedback.revised)") }
            if action == 2 {
                let rewrite = try XCTUnwrap(result.data.feedback?.revised).lowercased()
                XCTAssertTrue(rewrite.contains("thursday"))
                XCTAssertTrue(rewrite.contains("wednesday"))
                XCTAssertNotEqual(result.data.feedback?.revised, result.data.reply)
            }
        }
        XCTAssertEqual(session.stepIndex, 1)
        XCTAssertEqual(session.retryCount, 1)
        XCTAssertEqual(session.ai?.feedbacks.count, 2)
        XCTAssertTrue(session.messages.allSatisfy { !$0.text.contains("OLD SCRIPT") })
    }
}
