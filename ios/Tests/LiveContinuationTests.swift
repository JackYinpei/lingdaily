import Foundation
import XCTest
@testable import PracticeCore

final class LiveContinuationTests: XCTestCase {
    private var scenario: PracticeScenario {
        .init(id: "continuation", title: "Test", subtitle: "Test", category: "Test", symbol: "mic", partner: "Alex",
              partnerRole: "Colleague", setting: "Synthetic", steps: (0..<3).map {
            .init(id: "\($0)", goal: "Goal \($0)", prompt: "Prompt", translation: "译文", hint: "提示",
                  keywords: "test", expression: "Test", meaning: "测试")
        })
    }
    private func completion(_ id: String, index: Int) -> LiveToolCall {
        .init(id: id, name: "mark_task_complete", arguments: ["taskIndex": index])
    }
    func testMuteInvalidatesBatchAlreadyDrainedFromCaptureEvenAfterUnmute() {
        var gate = LiveInputGate()
        XCTAssertFalse(gate.accepts(gate.generation))
        gate.open(); let oldBatch = gate.generation
        XCTAssertTrue(gate.accepts(oldBatch))
        gate.close(); XCTAssertFalse(gate.accepts(oldBatch))
        gate.open(); XCTAssertFalse(gate.accepts(oldBatch))
        XCTAssertTrue(gate.accepts(gate.generation))
    }
    func testHardwareRestartRetainsScheduledAndUndispatchedAudioAndRejectsOldCompletions() throws {
        var playback = LivePlaybackBuffer(maxBytes: 12)
        let audio = [Data([1, 0]), Data([2, 0]), Data([3, 0])]
        let epoch = try XCTUnwrap(playback.reserve(bytes: 2))
        playback.enqueue(audio[0], generation: epoch)
        let old = try XCTUnwrap(playback.next(outputReady: true))
        _ = playback.reserve(bytes: 2); playback.enqueue(audio[1], generation: epoch)
        _ = playback.reserve(bytes: 2) // Dispatch work reserved before the restart.
        playback.requeueScheduled()
        XCTAssertFalse(playback.complete(bytes: 2, generation: old.1, schedulingGeneration: old.2))
        playback.enqueue(audio[2], generation: epoch)
        XCTAssertEqual(playback.reservedBytes, 6)
        for expected in audio {
            let fresh = try XCTUnwrap(playback.next(outputReady: true))
            XCTAssertEqual(fresh.0, expected)
            XCTAssertTrue(playback.complete(bytes: 2, generation: fresh.1, schedulingGeneration: fresh.2))
        }
        XCTAssertEqual(playback.reservedBytes, 0)
        _ = playback.reserve(bytes: 2); playback.enqueue(audio[0], generation: epoch)
        playback.requeueScheduled(); playback.invalidate()
        XCTAssertNil(playback.next(outputReady: true))
    }
    func testEmptyFinalMarkerSealsExistingInputAndNextUtteranceCanPrecedeInterruption() throws {
        let events = try LiveCodec.parse(Data("{\"serverContent\":{\"inputTranscription\":{\"finished\":true}}}".utf8))
        guard case .transcription(.user, let text, let finished) = events.first else { return XCTFail("Missing final marker") }
        var reducer = LiveTranscriptReducer()
        let first = try reducer.update(role: .user, text: "Thursday, please.", finished: false)
        let final = try reducer.update(role: .user, text: text, finished: finished)
        XCTAssertEqual(first.id, final.id); XCTAssertEqual(final.text, first.text); XCTAssertTrue(final.finalized)
        let next = try reducer.update(role: .user, text: "Actually", finished: false)
        XCTAssertNotEqual(next.id, first.id)
        reducer.finishPartner(); reducer.finishTurn()
        let rest = try reducer.update(role: .user, text: " Friday.", finished: true)
        XCTAssertEqual(rest.id, next.id); XCTAssertEqual(rest.text, "Actually Friday.")
    }
    func testInputFinalAfterNormalModelTurnCompleteStaysInTheSameBubble() throws {
        var reducer = LiveTranscriptReducer()
        let first = try reducer.update(role: .user, text: "I need", finished: false)
        _ = try reducer.update(role: .partner, text: "Okay.", finished: true)
        reducer.finishTurn()
        let final = try reducer.update(role: .user, text: " more time.", finished: true)
        XCTAssertEqual(final.id, first.id); XCTAssertEqual(final.text, "I need more time.")
    }
    func testMissingFinalFlagsDoNotMergeTwoDifferentLearnerTurns() throws {
        var reducer = LiveTranscriptReducer()
        let first = try reducer.update(role: .user, text: "Thursday, please.", finished: false)
        reducer.finishTurn()
        let second = try reducer.update(role: .user, text: "Thanks.", finished: false)
        XCTAssertNotEqual(first.id, second.id); XCTAssertEqual(second.text, "Thanks.")
        let final = try reducer.update(role: .user, text: "", finished: true)
        XCTAssertEqual(final.id, second.id)
        let next = try reducer.update(role: .user, text: "Actually Friday.", finished: true)
        XCTAssertNotEqual(next.id, second.id); XCTAssertEqual(next.text, "Actually Friday.")
    }
    func testTaskToolBeforeTranscriptionWaitsAndCannotQueueFutureTasks() {
        var session = PracticeSession(scenario: scenario, useAI: true); session.beginLive()
        var tools = LivePendingTools()
        _ = tools.apply(completion("future", index: 1), to: &session)
        XCTAssertEqual(tools.count, 0)
        _ = tools.apply(completion("current", index: 0), to: &session)
        XCTAssertEqual(tools.count, 1); XCTAssertEqual(session.stepIndex, 0)
        _ = session.liveTranscript(id: UUID(), role: .user, text: "Could we move it to Thursday?")
        tools.flush(to: &session)
        XCTAssertEqual(tools.count, 0); XCTAssertEqual(session.stepIndex, 1)
        tools.flush(to: &session); XCTAssertEqual(session.live?.completedTasks, [0])
    }
    func testCancellationRemovesQueuedCorrectionsAndTaskEffects() {
        var session = PracticeSession(scenario: scenario, useAI: true); session.beginLive()
        var tools = LivePendingTools()
        _ = tools.apply(completion("complete", index: 0), to: &session)
        _ = tools.apply(.init(id: "correction", name: "record_language_correction", arguments: [
            "original": "I go yesterday", "corrected": "I went yesterday", "explanation": "用过去时", "category": "grammar"
        ]), to: &session)
        tools.cancel(["complete", "correction"])
        let id = UUID(); _ = session.liveTranscript(id: id, role: .user, text: "I go yesterday")
        tools.flush(to: &session)
        XCTAssertEqual(session.stepIndex, 0); XCTAssertNil(session.feedback(for: id)); XCTAssertEqual(tools.count, 0)
    }
    func testQueuedToolsStayBoundedAndLastTaskWaitsForItsUserTranscript() {
        var session = PracticeSession(scenario: scenario, useAI: true); session.beginLive()
        var tools = LivePendingTools()
        for i in 0..<100 { _ = tools.apply(completion("call-\(i)", index: 0), to: &session) }
        XCTAssertEqual(tools.count, 20)
        _ = session.liveTranscript(id: UUID(), role: .user, text: "Explain the delay.")
        tools.flush(to: &session); XCTAssertEqual(session.stepIndex, 1)
        _ = session.liveTranscript(id: UUID(), role: .user, text: "Propose Thursday.")
        _ = tools.apply(completion("second", index: 1), to: &session)
        _ = tools.apply(completion("last", index: 2), to: &session)
        XCTAssertNotEqual(session.phase, .completed)
        _ = session.liveTranscript(id: UUID(), role: .user, text: "Confirm Thursday.")
        tools.flush(to: &session); XCTAssertEqual(session.phase, .completed)
        XCTAssertEqual(session.live?.completedTasks, [0, 1, 2])
    }
}
