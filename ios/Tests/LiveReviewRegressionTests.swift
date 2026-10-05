import Foundation
import AVFoundation
import XCTest
@testable import PracticeCore

final class LiveReviewRegressionTests: XCTestCase {
    func testGreetingSurvivesCaptureGraphRestartIncludingDeferredAudio() throws {
        var buffer = LivePlaybackBuffer()
        let first = Data(repeating: 1, count: 2000), tail = Data(repeating: 2, count: 2000)
        let epoch = try XCTUnwrap(buffer.reserve(bytes: first.count))
        buffer.enqueue(first, generation: epoch)
        let old = try XCTUnwrap(buffer.next(outputReady: true))
        XCTAssertNotNil(buffer.reserve(bytes: tail.count)) // Dispatch has not run yet.
        buffer.requeueScheduled() // Install capture tap and restart engine.
        XCTAssertFalse(buffer.complete(bytes: first.count, generation: epoch, schedulingGeneration: old.2))
        buffer.enqueue(tail, generation: epoch)
        let replayed = try XCTUnwrap(buffer.next(outputReady: true))
        let last = try XCTUnwrap(buffer.next(outputReady: true))
        XCTAssertEqual(replayed.0, first); XCTAssertEqual(last.0, tail)
        XCTAssertEqual(buffer.reservedBytes, 4000)
        XCTAssertTrue(buffer.complete(bytes: first.count, generation: epoch, schedulingGeneration: replayed.2))
        XCTAssertTrue(buffer.complete(bytes: tail.count, generation: epoch, schedulingGeneration: last.2))
        XCTAssertEqual(buffer.reservedBytes, 0)
    }
    private var scenario: PracticeScenario {
        .init(id: "review", title: "Test", subtitle: "Test", category: "Test", symbol: "mic", partner: "Alex",
              partnerRole: "Colleague", setting: "Synthetic", steps: (0..<3).map {
                  .init(id: "\($0)", goal: "Task \($0)", prompt: "Prompt", translation: "译文", hint: "提示",
                        keywords: "test", expression: "Test", meaning: "测试")
              })
    }
    func testBatchDrainsBacklogEvenWhenWakeupsOnlyRun36TimesPerSecond() {
        var buffer = LiveInputBuffer()
        var produced = 0, sent = 0
        // Three minutes at 50 frames/s with the measured 36 wakeups/s.
        for tick in 1...(180 * 36) {
            let due = tick * 50 / 36
            while produced < due { buffer.append([Data(repeating: 0, count: 640)]); produced += 1 }
            sent += LiveUploadBatch.take(nextFrame: { buffer.take() }).count
            XCTAssertEqual(buffer.count, 0)
        }
        XCTAssertEqual(produced, 9000); XCTAssertEqual(sent, 9000); XCTAssertEqual(buffer.droppedFrames, 0)
    }
    func testInputAndNetworkPressureStayBoundedWithoutDisconnecting() throws {
        var buffer = LiveInputBuffer(capacity: 3)
        buffer.append((0..<6).map { Data([UInt8($0), 0]) })
        XCTAssertEqual(buffer.droppedFrames, 3); XCTAssertEqual(buffer.count, 3)
        XCTAssertEqual(buffer.take(), Data([3, 0]))
        var outgoing = LiveOutgoingBuffer(capacity: 3)
        try outgoing.append("ack", priority: true)
        for i in 0..<100 { try outgoing.append("pcm\(i)", audio: true) }
        XCTAssertEqual(outgoing.count, 3); XCTAssertEqual(outgoing.droppedAudioFrames, 98)
        XCTAssertEqual(outgoing.take()?.message, "ack")
        outgoing.clearAudio(); XCTAssertTrue(outgoing.isEmpty)
    }
    func test4800NativeFramesAreSplitAndConvertedWithoutLoss() throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
        let converter = try LivePCMConverter(format: format)
        var remaining = 4800, lengths: [Int] = [], pcm = Data()
        while remaining > 0 {
            let count = LiveCaptureChunker.length(remaining: remaining)
            lengths.append(count); remaining -= count
            let chunk = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)))
            chunk.frameLength = AVAudioFrameCount(count)
            for i in 0..<count { chunk.floatChannelData![0][i] = 0.1 }
            pcm.append(try converter.convert(chunk))
        }
        XCTAssertEqual(lengths, [4096, 704]); XCTAssertEqual(pcm.count, 3200)
        var framer = LivePCMFramer(); XCTAssertEqual(try framer.append(pcm).count, 5)
    }
    func testInternalAndNewDeviceRoutesDoNotHangUp() {
        XCTAssertEqual(LiveAudioRoutePolicy.action(reason: 3), .ignore)
        XCTAssertEqual(LiveAudioRoutePolicy.action(reason: 1), .reconfigure)
        XCTAssertEqual(LiveAudioRoutePolicy.action(reason: 8), .reconfigure)
        XCTAssertEqual(LiveAudioRoutePolicy.action(reason: 2), .stop)
        XCTAssertEqual(LiveAudioRoutePolicy.action(reason: 7), .stop)
    }
    func testProductionCapturePipelineSplitsLargeBuffersAndRecoversFromMuteAndPressure() throws {
        let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2))
        let native = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800))
        native.frameLength = 4800
        for channel in 0..<2 {
            for i in 0..<4800 { native.floatChannelData![channel][i] = 0.2 }
        }
        let pipeline = try LiveMicrophonePipeline(format: format)
        pipeline.capture(native); XCTAssertFalse(try pipeline.process())
        let batch = LiveUploadBatch.take(nextFrame: { pipeline.takeFrame() })
        XCTAssertEqual(batch.count, 5); XCTAssertTrue(batch.allSatisfy { $0.count == 640 })
        let samples = try LivePCMFramer.decode(batch.last!)
        XCTAssertEqual(samples.last!, 0.2, accuracy: 0.01)
        pipeline.capture(native); try pipeline.process()
        pipeline.setMuted(true); pipeline.capture(native); try pipeline.process()
        XCTAssertNil(pipeline.takeFrame())
        pipeline.setMuted(false)
        // Exhaust the native pool without processing; pressure must not kill capture.
        for _ in 0..<8 { pipeline.capture(native) }
        XCTAssertTrue(try pipeline.process())
        XCTAssertGreaterThan(pipeline.statistics().droppedNativeFrames, 0)
        _ = LiveUploadBatch.take(nextFrame: { pipeline.takeFrame() })
        pipeline.capture(native); try pipeline.process()
        XCTAssertEqual(LiveUploadBatch.take(nextFrame: { pipeline.takeFrame() }).count, 5)
        pipeline.stop(); pipeline.capture(native); try pipeline.process()
        XCTAssertNil(pipeline.takeFrame())
    }
    func testPlaybackOverflowAndEmptyChunkDoNotPoisonLaterPlayback() throws {
        var buffer = LivePlaybackBuffer(maxBytes: 480_000)
        XCTAssertNil(buffer.reserve(bytes: 0))
        let epoch = try XCTUnwrap(buffer.reserve(bytes: 480_000))
        buffer.enqueue(Data(repeating: 0, count: 480_000), generation: epoch)
        XCTAssertNil(buffer.reserve(bytes: 24_000)) // Caller drops this chunk, keeps the call alive.
        XCTAssertEqual(buffer.generation, epoch)
        XCTAssertEqual(buffer.next(outputReady: true)?.0.count, 480_000)
        buffer.complete(bytes: 480_000, generation: epoch)
        XCTAssertNotNil(buffer.reserve(bytes: 24_000))
    }
    func testRepeatedWordsAndBargeInSurviveInterruptedTurnComplete() throws {
        var reducer = LiveTranscriptReducer()
        _ = try reducer.update(role: .partner, text: "Let me explain", finished: false)
        let user = try reducer.update(role: .user, text: " very", finished: false)
        reducer.finishPartner()
        reducer.finishTurn() // End of the cancelled partner response, not of this user sentence.
        let next = try reducer.update(role: .user, text: " very important", finished: false)
        XCTAssertEqual(next.id, user.id); XCTAssertEqual(next.text, " very very important")
        let final = try reducer.update(role: .user, text: ".", finished: true)
        XCTAssertEqual(final.id, user.id); XCTAssertEqual(final.text, " very very important.")
        reducer.finishTurn()
        XCTAssertNotEqual(try reducer.update(role: .user, text: "Thanks", finished: false).id, user.id)
    }
    func testCorrectionMatchesPunctuationQuoteInsideSentenceAndMinorSTTChanges() {
        var session = PracticeSession(scenario: scenario, useAI: true); session.beginLive()
        let id = UUID()
        _ = session.liveTranscript(id: id, role: .user, text: "Well, I go yesterday. Could we move the deadline to Thursday?")
        let feedback = AIFeedback(revised: "I went yesterday.", meaning: "", note: "用过去时。")
        XCTAssertTrue(session.liveCorrection(original: "I go yesterday", feedback: feedback))
        XCTAssertEqual(session.feedback(for: id), feedback)
        XCTAssertTrue(session.liveCorrection(original: "Could we move deadline to Thursday", feedback: feedback))
        XCTAssertFalse(session.liveCorrection(original: "Completely unrelated content", feedback: feedback))
    }
    func testWhitespaceNeverBecomesARequestAndLegacyBlankHistoryCanResume() throws {
        var session = PracticeSession(scenario: scenario, useAI: true); session.beginLive()
        XCTAssertFalse(session.liveTranscript(id: UUID(), role: .user, text: " \n "))
        XCTAssertTrue(LiveTokenRequest(session: session).messages.isEmpty)
        session.prepareText(); XCTAssertEqual(session.pendingAIRequest?.action, .start)
        // Simulate a blank message already archived by the original implementation.
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(session)) as? [String: Any])
        object["messages"] = [["id": UUID().uuidString, "role": "user", "kind": "answer", "text": " ",
                               "stepIndex": 0, "createdAt": 0]]
        var old = try JSONDecoder().decode(PracticeSession.self, from: JSONSerialization.data(withJSONObject: object))
        XCTAssertTrue(LiveTokenRequest(session: old).messages.isEmpty)
        old.prepareText()
        XCTAssertTrue(old.messages.isEmpty); XCTAssertEqual(old.pendingAIRequest?.action, .start)
    }
    func testTextAfterLiveTaskCompletionAdvancesInsteadOfAnsweringOldTask() {
        var session = PracticeSession(scenario: scenario, useAI: true); session.beginLive()
        _ = session.liveTranscript(id: UUID(), role: .user, text: "We need Thursday.")
        XCTAssertTrue(session.liveComplete(taskIndex: 0))
        session.prepareText()
        let request = session.pendingAIRequest
        XCTAssertEqual(request?.action, .advance); XCTAssertEqual(request?.stepIndex, 1)
        XCTAssertEqual(request?.messages.last?.stepIndex, 0); XCTAssertEqual(session.phase, .speaking)
    }
}
