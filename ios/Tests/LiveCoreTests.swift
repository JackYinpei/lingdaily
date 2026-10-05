import Foundation
import XCTest
import AVFoundation
@testable import PracticeCore

final class LiveCoreTests: XCTestCase {
    func testConnectionFailureUsesSafeChineseDiagnostics() {
        typealias Failure = LiveWebSocketClient.FailureDiagnostics
        XCTAssertTrue(Failure(stage: "setupTimeout", closeCode: 0, transportCode: nil).message.contains("超时"))
        XCTAssertTrue(Failure(stage: "receive", closeCode: 0, transportCode: NSURLErrorNetworkConnectionLost).message.contains("网络"))
        XCTAssertTrue(Failure(stage: "receive", closeCode: 1011, transportCode: nil).message.contains("1011"))
        XCTAssertTrue(Failure(stage: "protocol", closeCode: 0, transportCode: nil).message.contains("无法处理"))
        XCTAssertFalse(Failure(stage: "receive", closeCode: 0, transportCode: nil).message.contains("http"))
    }
    private func object(_ json: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(json.utf8)) as? [String: Any])
    }
    private var scenario: PracticeScenario {
        .init(id: "live-test", title: "Test", subtitle: "Test", category: "Test", symbol: "mic",
              partner: "Alex", partnerRole: "Colleague", setting: "Synthetic rehearsal",
              steps: (0..<3).map { .init(id: "\($0)", goal: "Goal \($0)", prompt: "Prompt", translation: "译文",
                                       hint: "提示", keywords: "word", expression: "Example", meaning: "含义") })
    }
    func testSetupDoesNotSendClientSystemInstruction() throws {
        let setup = try object(LiveCodec.setup(model: "test-model"))["setup"] as? [String: Any]
        XCTAssertEqual(setup?["model"] as? String, "models/test-model")
        XCTAssertEqual(setup?.count, 1)
        let audio = try object(LiveCodec.audio(Data([0, 1])))
        let input = audio["realtimeInput"] as? [String: Any]
        let payload = input?["audio"] as? [String: String]
        XCTAssertEqual(payload?["mimeType"], "audio/pcm;rate=16000")
        XCTAssertEqual(Data(base64Encoded: payload?["data"] ?? ""), Data([0, 1]))
        XCTAssertThrowsError(try LiveCodec.audio(Data([1])))
        XCTAssertThrowsError(try LiveCodec.audio(Data(repeating: 0, count: 3202)))
        XCTAssertNotNil(try object(LiveCodec.audioEnd())["realtimeInput"])
    }
    func testAllEventsAndAudioPartsAreParsedInOrder() throws {
        let events = try LiveCodec.parse(Data("""
        {"setupComplete":{},"serverContent":{"inputTranscription":{"text":"Hello","finished":true},
        "outputTranscription":{"text":"Hi"},"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AAA="}},
        {"inlineData":{"mimeType":"audio/pcm;rate=24000","data":"AQA="}}]},"turnComplete":true},
        "toolCall":{"functionCalls":[{"id":"t1","name":"mark_task_complete","args":{"taskIndex":0}}]}}
        """.utf8))
        XCTAssertEqual(events.count, 7)
        guard case .setupComplete = events[0], case .transcription(.user, "Hello", true) = events[1],
              case .transcription(.partner, "Hi", false) = events[2], case .audio(let first) = events[3],
              case .audio(let second) = events[4], case .turnComplete = events[5], case .tool(let tool) = events[6] else {
            return XCTFail("Missing or reordered event")
        }
        XCTAssertEqual(first, Data([0, 0])); XCTAssertEqual(second, Data([1, 0]))
        XCTAssertNotNil(tool.validated())
    }
    func testInterruptedEnvelopeNeverQueuesItsOldAudio() throws {
        let events = try LiveCodec.parse(Data("""
        {"serverContent":{"interrupted":true,"modelTurn":{"parts":[{"inlineData":{"mimeType":"audio/pcm","data":"AAA="}}]},"turnComplete":true}}
        """.utf8))
        XCTAssertEqual(events.count, 2)
        guard case .interrupted = events[0], case .turnComplete = events[1] else { return XCTFail("Wrong order") }
        XCTAssertThrowsError(try LiveCodec.parse(Data("{\"error\":{\"message\":\"synthetic upstream failure\"}}".utf8)))
        let cancellation = try LiveCodec.parse(Data("{\"toolCallCancellation\":{\"ids\":[\"t1\"]},\"goAway\":{}}".utf8))
        XCTAssertEqual(cancellation.count, 2)
    }
    func testToolWhitelistLengthTypesAndAcknowledgement() throws {
        func call(_ name: String, _ args: [String: Any]) -> LiveToolCall { .init(id: "tool", name: name, arguments: args) }
        XCTAssertNil(call("execute_code", [:]).validated())
        XCTAssertNil(call("mark_task_complete", ["taskIndex": true]).validated())
        XCTAssertNil(call("mark_task_complete", ["taskIndex": 0.5]).validated())
        XCTAssertNil(call("mark_task_complete", ["taskIndex": 3]).validated())
        XCTAssertNil(call("mark_task_complete", ["taskIndex": 0, "extra": "no"]).validated())
        XCTAssertNotNil(call("mark_task_complete", ["taskIndex": 0]).validated())
        XCTAssertNotNil(call("record_language_correction", ["original": "I go yesterday", "corrected": "I went yesterday.",
                                                           "explanation": "昨天用过去时。", "category": "grammar"]).validated())
        XCTAssertNil(call("record_language_correction", ["original": String(repeating: "x", count: 2001)]).validated())
        let item: [String: Any] = ["text": "went", "type": "word", "meaning": "去的过去式"]
        XCTAssertNotNil(call("record_unfamiliar_learning_items", ["items": [item, item]]).validated())
        XCTAssertNil(call("record_unfamiliar_learning_items", ["items": Array(repeating: item, count: 21)]).validated())
        XCTAssertNil(call("record_unfamiliar_learning_items", ["items": [["text": "x", "type": "code", "meaning": "x"]]]).validated())
        let ack = try object(LiveCodec.toolResponse(call("mark_task_complete", ["taskIndex": 0]), accepted: true))
        XCTAssertNotNil(ack["toolResponse"])
        XCTAssertTrue(try LiveCodec.toolResponse(call("unknown", [:]), accepted: false).contains("rejected"))
    }
    func testConnectionAndPlaybackGenerationRejectLateWork() {
        var generations = LiveGenerations()
        generations.reconnect()
        let first = generations.connection, playback = generations.playback
        XCTAssertTrue(generations.accepts(connection: first, playback: playback))
        generations.interrupt()
        XCTAssertTrue(generations.accepts(connection: first))
        XCTAssertFalse(generations.accepts(connection: first, playback: playback))
        generations.reconnect()
        XCTAssertFalse(generations.accepts(connection: first))
        XCTAssertFalse(generations.accepts(connection: first, playback: generations.playback))
    }
    func testStreamingSubtitlesUseStableIDsAndSealFinalText() throws {
        var reducer = LiveTranscriptReducer()
        let a = try reducer.update(role: .user, text: "I need", finished: false)
        let b = try reducer.update(role: .user, text: "I need more time.", finished: true)
        XCTAssertEqual(a.id, b.id); XCTAssertEqual(b.text, "I need more time.")
        XCTAssertEqual(try reducer.update(role: .user, text: "I need", finished: true).text, b.text)
        let partner = try reducer.update(role: .partner, text: "Sure", finished: false)
        reducer.finishPartner()
        XCTAssertNotEqual(try reducer.update(role: .user, text: "New sentence", finished: true).id, a.id)
        XCTAssertNotEqual(try reducer.update(role: .partner, text: "Okay", finished: true).id, partner.id)
        reducer.finishTurn()
        XCTAssertNotEqual(try reducer.update(role: .user, text: "Thanks", finished: true).id, a.id)
    }
    func testPCMEndiannessClippingFrameLengthAndReset() throws {
        let bytes = LivePCMFramer.encode([0, 1, -1, 2, .nan])
        XCTAssertEqual(Array(bytes.prefix(6)), [0, 0, 255, 127, 1, 128])
        XCTAssertEqual(try LivePCMFramer.decode(bytes).count, 5)
        XCTAssertThrowsError(try LivePCMFramer.decode(Data([1])))
        var framer = LivePCMFramer()
        XCTAssertEqual(try framer.append(Data(repeating: 0, count: 320)).count, 0)
        XCTAssertEqual(try framer.append(Data(repeating: 0, count: 960)).map(\.count), [640, 640])
        _ = try framer.append(Data(repeating: 0, count: 320)); framer.reset()
        XCTAssertEqual(try framer.append(Data(repeating: 0, count: 320)).count, 0)
        XCTAssertThrowsError(try framer.append(Data(repeating: 0, count: 32_002)))
    }
    func testActualNativeConverterResamplesStereo48KAnd44KTo16K() throws {
        for rate in [48000.0, 44100.0] {
            let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: rate, channels: 2))
            let converter = try LivePCMConverter(format: format)
            let count = Int(rate * 0.02)
            let input = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)))
            input.frameLength = AVAudioFrameCount(count)
            for channel in 0..<2 { for index in 0..<count { input.floatChannelData![channel][index] = 0.2 } }
            var data = Data()
            for _ in 0..<5 { data.append(try converter.convert(input)) }
            XCTAssertEqual(data.count, 3200) // 100ms, mono PCM16 at 16kHz.
            let converted = try LivePCMFramer.decode(data)
            XCTAssertEqual(converted[320], 0.2, accuracy: 0.03)
            XCTAssertLessThan(converted.map { abs($0) }.max() ?? 1, 0.3)
            var framer = LivePCMFramer()
            XCTAssertEqual(try framer.append(data).map(\.count), Array(repeating: 640, count: 5))
        }
    }
    func testLivePersistsFeedbackByUserIDProgressAndOldArchiveCompatibility() throws {
        var session = PracticeSession(scenario: scenario, useAI: true)
        session.beginLive(model: "synthetic-model")
        XCTAssertNil(session.pendingAIRequest)
        XCTAssertFalse(session.liveComplete(taskIndex: 0))
        let id = UUID()
        XCTAssertTrue(session.liveTranscript(id: id, role: .user, text: "I go yesterday"))
        XCTAssertTrue(session.liveTranscript(id: id, role: .user, text: "I go yesterday."))
        XCTAssertEqual(session.userTurns, 1)
        XCTAssertFalse(session.liveComplete(taskIndex: 2))
        let feedback = AIFeedback(revised: "I went yesterday.", meaning: "", note: "用过去时。")
        XCTAssertFalse(session.liveCorrection(original: "A different sentence", feedback: feedback))
        XCTAssertTrue(session.liveCorrection(original: "I go yesterday.", feedback: feedback))
        XCTAssertEqual(session.feedback(for: id), feedback)
        XCTAssertTrue(session.liveComplete(taskIndex: 0))
        XCTAssertFalse(session.liveComplete(taskIndex: 0))
        XCTAssertEqual(session.stepIndex, 1)
        session.endLive()
        var archive = PracticeArchive(); archive.upsert(session)
        archive.collect([.init(text: "went", type: "word", meaning: "去的过去式")], source: "Test")
        let data = try JSONEncoder().encode(archive)
        XCTAssertEqual(try JSONDecoder().decode(PracticeArchive.self, from: data), archive)
        var old = try object(String(decoding: data, as: UTF8.self))
        var sessions = try XCTUnwrap(old["sessions"] as? [[String: Any]])
        sessions[0].removeValue(forKey: "live"); old["sessions"] = sessions
        let decoded = try JSONDecoder().decode(PracticeArchive.self, from: JSONSerialization.data(withJSONObject: old))
        XCTAssertNil(decoded.sessions.first?.live); XCTAssertEqual(decoded.sessions.first?.userTurns, 1)
        XCTAssertEqual(decoded.schemaVersion, 2)
    }
    func testFirstPlaybackWaitsForOutputAndInterruptionInvalidatesEveryQueuedReservation() throws {
        var buffer = LivePlaybackBuffer(maxBytes: 8, maxChunks: 2)
        let first = try XCTUnwrap(buffer.reserve(bytes: 4))
        XCTAssertTrue(buffer.enqueue(Data([1, 0, 2, 0]), generation: first))
        XCTAssertNil(buffer.next(outputReady: false))
        XCTAssertEqual(buffer.next(outputReady: true)?.0, Data([1, 0, 2, 0]))
        let second = try XCTUnwrap(buffer.reserve(bytes: 4))
        XCTAssertNil(buffer.reserve(bytes: 2))
        buffer.invalidate()
        XCTAssertFalse(buffer.enqueue(Data([3, 0, 4, 0]), generation: second))
        XCTAssertNil(buffer.next(outputReady: true))
        let fresh = try XCTUnwrap(buffer.reserve(bytes: 2))
        buffer.complete(bytes: 4, generation: first) // Old completion cannot alter new audio accounting.
        XCTAssertEqual(buffer.reservedBytes, 2)
        XCTAssertTrue(buffer.enqueue(Data([5, 0]), generation: fresh))
        XCTAssertEqual(buffer.next(outputReady: true)?.0, Data([5, 0]))
        buffer.complete(bytes: 2, generation: fresh)
        XCTAssertEqual(buffer.reservedBytes, 0)
    }

    func testClientRejectsUntrustedWebSocketDestination() {
        let expiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(60))
        XCTAssertThrowsError(try LiveToken(token: "synthetic", model: "test", wsURL: "wss://evil.test", expiresAt: expiry).connectionURL())
        let formatter = ISO8601DateFormatter(); formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        XCTAssertNoThrow(try LiveToken(token: "synthetic", model: "test", wsURL: LiveToken.endpoint,
                                      expiresAt: formatter.string(from: Date().addingTimeInterval(60))).connectionURL())
        XCTAssertThrowsError(try LiveToken(token: "synthetic", model: "test", wsURL: LiveToken.endpoint, expiresAt: "2000-01-01T00:00:00Z").connectionURL())
    }
    func testClientAllowsOnlyExactRelayEndpointsAndEncodesCredentialSeparately() throws {
        let expiry = ISO8601DateFormatter().string(from: Date().addingTimeInterval(60))
        for endpoint in [LiveToken.relayEndpoint, LiveToken.legacyRelayEndpoint] {
            let url = try LiveToken(token: "synthetic/value+&", model: "test", wsURL: endpoint, expiresAt: expiry).connectionURL()
            let parts = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
            XCTAssertEqual(parts.queryItems, [URLQueryItem(name: "access_token", value: "synthetic/value+&")])
            XCTAssertEqual(parts.scheme, "wss")
        }
        for endpoint in [LiveToken.relayEndpoint + "?extra=1", LiveToken.relayEndpoint + "#fragment",
                         LiveToken.relayEndpoint.replacingOccurrences(of: "wss:", with: "ws:"),
                         LiveToken.relayEndpoint.replacingOccurrences(of: "yasobi.xyz", with: "yasobi.xyz.evil.test"),
                         LiveToken.relayEndpoint.replacingOccurrences(of: "wss://", with: "wss://user@"),
                         LiveToken.relayEndpoint.replacingOccurrences(of: "/ws/", with: ":8443/ws/")] {
            XCTAssertThrowsError(try LiveToken(token: "synthetic", model: "test", wsURL: endpoint, expiresAt: expiry).connectionURL())
        }
    }
}
