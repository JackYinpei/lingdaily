import Foundation
import XCTest
@testable import PracticeCore

final class SentenceReviewTests: XCTestCase {
    private func conversation() -> PracticeSession {
        let steps = (0..<3).map { PracticeStep(id: "\($0)", goal: "任务 \($0)", prompt: "Hello", translation: "你好",
            hint: "提示", keywords: "test", expression: "Test", meaning: "测试") }
        let scenario = PracticeScenario(id: "synthetic", title: "Synthetic", subtitle: "", category: "日常", symbol: "", partner: "Alex",
            partnerRole: "Friend", setting: "Synthetic adult conversation", steps: steps)
        var session = PracticeSession(scenario: scenario, useAI: true)
        session.beginLive()
        for text in ["我直行。", "Yeah, you didn't see me. And you almost hit me.", "Yeah, I'm scared very much.", "Okay. Good."] {
            _ = session.liveTranscript(id: UUID(), role: .partner, text: "Synthetic partner line")
            _ = session.liveTranscript(id: UUID(), role: .user, text: text)
        }
        _ = session.liveComplete(taskIndex: 2)
        return session
    }

    func testEveryLearnerTurnSurvivesEvenWithinOneTaskAndWithAnExistingCorrection() throws {
        var session = conversation()
        let messages = session.learnerMessages
        XCTAssertTrue(session.liveCorrection(original: messages[2].text,
            feedback: .init(revised: "I was really scared.", meaning: "我真的很害怕。", note: "表达受惊")))
        XCTAssertEqual(session.summaryLines.map(\.id), messages.map(\.id))
        XCTAssertEqual(session.summaryLines.map(\.original), messages.map(\.text))
        XCTAssertEqual(session.summaryLines[2].text, "I was really scared.")
        XCTAssertEqual(session.summaryLines.last?.text, "Okay. Good.")
        let long = String(repeating: "Very important. ", count: 100)
        _ = session.liveTranscript(id: UUID(), role: .user, text: long)
        XCTAssertEqual(session.summaryLines.last?.original, long, "No 300-character or six-line truncation")
    }

    func testBatchesPersistAlreadyReviewedNaturalSentencesAndSkipThemOnReopen() throws {
        var session = conversation()
        let request = try XCTUnwrap(session.nextSentenceReview)
        XCTAssertEqual(request.messages.count, 4)
        let response = SentenceReviewResponse(requestId: request.requestId, items: request.messages.map {
            .init(messageId: $0.messageId, revised: "", meaning: "", note: "")
        })
        XCTAssertTrue(session.applySentenceReviews(try XCTUnwrap(response.records(for: request))))
        let restored = try JSONDecoder().decode(PracticeSession.self, from: JSONEncoder().encode(session))
        XCTAssertNil(restored.nextSentenceReview)
        XCTAssertEqual(restored.summaryLines.map(\.original), session.learnerMessages.map(\.text))
        var legacy = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(session)) as? [String: Any])
        legacy.removeValue(forKey: "sentenceReviews")
        XCTAssertNotNil(try JSONDecoder().decode(PracticeSession.self, from: JSONSerialization.data(withJSONObject: legacy)).nextSentenceReview)
    }

    func testStaleAndForeignResultsCannotAttachToAnotherOrChangedMessage() throws {
        var session = conversation()
        let old = session
        let message = session.learnerMessages[0]
        let review = SentenceReviewRecord(id: message.id, original: message.text, revised: "I was driving straight.", meaning: "我在直行。", note: "保留意思")
        XCTAssertTrue(session.applySentenceReviews([review]))
        var backgroundSave = old
        backgroundSave.mergeSentenceReviews(from: session)
        XCTAssertEqual(backgroundSave.sentenceReviews, session.sentenceReviews)
        _ = session.liveTranscript(id: message.id, role: .user, text: "Different final transcript")
        XCTAssertNil(session.sentenceReview(for: session.learnerMessages[0]))
        XCTAssertFalse(session.applySentenceReviews([review]))
        XCTAssertFalse(session.applySentenceReviews([.init(id: UUID(), original: "Other account", revised: "", meaning: "", note: "")]))
    }

    func testMissingDuplicateAndMismatchedResponseIDsAreRejected() throws {
        let request = try XCTUnwrap(conversation().nextSentenceReview)
        let item = SentenceReviewResponse.Item(messageId: request.messages[0].messageId, revised: "", meaning: "", note: "")
        XCTAssertNil(SentenceReviewResponse(requestId: request.requestId, items: [item]).records(for: request))
        XCTAssertNil(SentenceReviewResponse(requestId: request.requestId, items: Array(repeating: item, count: 4)).records(for: request))
        XCTAssertNil(SentenceReviewResponse(requestId: UUID(), items: []).records(for: request))
    }

    func testSuccessiveBatchesKeepAllRepeatsAndCloudCodingKeepsSuggestions() throws {
        var session = conversation()
        for _ in 0..<5 { _ = session.liveTranscript(id: UUID(), role: .user, text: "Yes.") }
        var sizes: [Int] = []
        while let request = session.nextSentenceReview {
            sizes.append(request.messages.count)
            let response = SentenceReviewResponse(requestId: request.requestId, items: request.messages.map {
                .init(messageId: $0.messageId, revised: "", meaning: "", note: "")
            })
            XCTAssertTrue(session.applySentenceReviews(try XCTUnwrap(response.records(for: request))))
        }
        XCTAssertEqual(sizes, [4, 4, 1])
        XCTAssertEqual(session.summaryLines.count, 9)
        XCTAssertEqual(session.summaryLines.suffix(5).map(\.original), Array(repeating: "Yes.", count: 5))
        let cloud = try CloudSyncCoding.decoder.decode(PracticeSession.self, from: CloudSyncCoding.encoder.encode(session))
        XCTAssertEqual(cloud.sentenceReviews, session.sentenceReviews)
        XCTAssertNil(cloud.nextSentenceReview)
    }
}
