import Foundation
import AVFoundation
import XCTest
@testable import PracticeCore

private final class LiveSoakCapture {
    private let worker = DispatchQueue(label: "lingdaily.test.mic")
    private var timer: DispatchSourceTimer?
    private var engine: AVAudioEngine?
    private var stopped = false, tapInstalled = false
    private(set) var pipeline: LiveMicrophonePipeline!
    private var buffer: AVAudioPCMBuffer?
    private var speech: [Float] = []
    private var tick = 0
    private(set) var processingFailed = false
    let realMicrophone: Bool

    init(realMicrophone: Bool, audioFile: String?) throws {
        self.realMicrophone = realMicrophone
        if realMicrophone {
            guard AVCaptureDevice.authorizationStatus(for: .audio) == .authorized else {
                throw XCTSkip("Mac microphone permission is not granted to this test host; no microphone audio was tested")
            }
            let engine = AVAudioEngine(); self.engine = engine
            pipeline = try LiveMicrophonePipeline(format: engine.inputNode.outputFormat(forBus: 0))
        } else {
            guard let audioFile else { throw XCTSkip("Set LINGDAILY_LIVE_AUDIO_FILE to a synthesized speech file") }
            let file = try AVAudioFile(forReading: URL(fileURLWithPath: audioFile))
            let converter = try LivePCMConverter(format: file.processingFormat)
            let chunk = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 4096))
            while file.framePosition < file.length {
                try file.read(into: chunk, frameCount: 4096)
                speech.append(contentsOf: try LivePCMFramer.decode(converter.convert(chunk)))
                guard speech.count <= 16_000 * 30 else { throw LiveProtocolError.overloaded }
            }
            let format = try XCTUnwrap(AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1))
            pipeline = try LiveMicrophonePipeline(format: format)
            buffer = try XCTUnwrap(AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800))
        }
    }
    func start() throws {
        if let engine {
            let pipeline = pipeline!
            engine.inputNode.installTap(onBus: 0, bufferSize: 1024, format: pipeline.format) { buffer, _ in pipeline.capture(buffer) }
            tapInstalled = true
            engine.prepare(); try engine.start()
        }
        let timer = DispatchSource.makeTimerSource(queue: worker)
        timer.schedule(deadline: .now(), repeating: .milliseconds(realMicrophone ? 20 : 100))
        timer.setEventHandler { [weak self] in
            guard let self else { return }
            if let buffer = self.buffer {
                buffer.frameLength = 4800
                // Ten seconds of silence for the greeting; repeat synthetic
                // speech every 30s. This drives VAD, input STT and barge-in.
                let position = self.tick * 1600
                let cycle = (position - 160_000) % (16_000 * 30)
                for index in 0..<4800 {
                    let speechIndex = cycle + index / 3
                    buffer.floatChannelData![0][index] = position >= 160_000 && speechIndex >= 0 && speechIndex < self.speech.count
                        ? self.speech[speechIndex] : 0
                }
                self.pipeline.capture(buffer); self.tick += 1
            }
            do { try self.pipeline.process() } catch { self.processingFailed = true }
        }
        self.timer = timer; timer.resume()
    }
    func stop() {
        worker.sync {
            guard !stopped else { return }; stopped = true
            timer?.cancel(); timer = nil
            if let engine {
                if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
                engine.stop()
            }
            pipeline.stop()
        }
    }
    func failed() -> Bool { worker.sync { processingFailed } }
}

final class LiveAudioSoakTests: XCTestCase {
    @MainActor
    func testContinuousMicrophoneOrSyntheticPCM() async throws {
        let env = ProcessInfo.processInfo.environment
        guard env["LINGDAILY_LIVE_TEST"] == "1", env["LINGDAILY_LIVE_AUDIO_SOAK"] == "1",
              let path = env["LINGDAILY_AI_TEST_CONFIG"] else {
            throw XCTSkip("Explicit LIVE_TEST + LIVE_AUDIO_SOAK + pairing config required")
        }
        let real = env["LINGDAILY_LIVE_MIC_TEST"] == "1"
        // Check permission BEFORE calling the token route or consuming quota.
        let source = try LiveSoakCapture(realMicrophone: real, audioFile: env["LINGDAILY_LIVE_AUDIO_FILE"])
        let duration = max(10, min(300, Double(env["LINGDAILY_LIVE_SOAK_SECONDS"] ?? "180") ?? 180))
        let config = try JSONDecoder().decode(AIConnectionConfiguration.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let scenario = PracticeScenario(id: "audio-soak", title: "Synthetic work rehearsal", subtitle: "Test", category: "Test",
            symbol: "mic", partner: "Alex", partnerRole: "Colleague", setting: "A fictional conversation about moving a deadline to Thursday",
            steps: (0..<3).map { .init(id: "\($0)", goal: ["Explain delay", "Propose Thursday", "Confirm"][ $0 ], prompt: "Test",
                                     translation: "测试", hint: "测试", keywords: "test", expression: "Test", meaning: "测试") })
        let token = try await PracticeAPIClient(configuration: config).liveToken(for: PracticeSession(scenario: scenario, useAI: true))
        let client = LiveWebSocketClient()
        var continuation: AsyncStream<LiveEvent>.Continuation!
        let stream = AsyncStream<LiveEvent>(bufferingPolicy: .bufferingNewest(256)) { continuation = $0 }
        let events = continuation!
        var disconnected = false, setup = false
        var inputs = 0, finalizedInputs = 0, outputs = 0, audioBytes = 0, audioAfterInput = 0, interruptions = 0
        var subtitles = LiveTranscriptReducer()
        var captured = PracticeSession(scenario: scenario, useAI: true)
        captured.beginLive()
        let deadline = Task {
            try? await Task.sleep(nanoseconds: UInt64((duration + 25) * 1_000_000_000))
            if !Task.isCancelled { events.finish() }
        }
        var finish: Task<Void, Never>?
        defer { deadline.cancel(); finish?.cancel(); source.stop(); events.finish() }
        try await client.connect(token, generation: 1, handler: { event, _ in events.yield(event) }, failure: { _, _ in
            disconnected = true; events.finish()
        })
        var started: Date?
        for await event in stream {
            switch event {
            case .setupComplete:
                setup = true; started = Date()
                try await client.sendText("Please begin our rehearsal at the current task.", generation: 1)
                try source.start() // No capture before setupComplete.
                await client.startUpload(generation: 1, nextFrame: { source.pipeline.takeFrame() })
                finish = Task {
                    try? await Task.sleep(nanoseconds: UInt64(duration * 1_000_000_000))
                    if !Task.isCancelled { events.finish() }
                }
            case .transcription(.user, let text, let finished):
                if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { inputs += 1 }
                if finished { finalizedInputs += 1 }
                let segment = try subtitles.update(role: .user, text: text, finished: finished)
                if !segment.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    XCTAssertTrue(captured.liveTranscript(id: segment.id, role: .user, text: segment.text))
                }
            case .transcription(.partner, let text, let finished):
                outputs += 1
                let segment = try subtitles.update(role: .partner, text: text, finished: finished)
                if !segment.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    XCTAssertTrue(captured.liveTranscript(id: segment.id, role: .partner, text: segment.text))
                }
            case .audio(let pcm):
                audioBytes += pcm.count
                if inputs > 0 { audioAfterInput += pcm.count }
            case .interrupted: interruptions += 1; subtitles.finishPartner()
            case .turnComplete: subtitles.finishTurn()
            default: break
            }
        }
        source.stop()
        let statistics = source.pipeline.statistics()
        let upload = await client.uploadStatistics()
        let failure = await client.failureDiagnostics()
        await client.close()
        let elapsed = started.map { Date().timeIntervalSince($0) } ?? 0
        XCTAssertTrue(setup); XCTAssertFalse(disconnected); XCTAssertFalse(source.failed())
        XCTAssertGreaterThanOrEqual(elapsed, duration - 1)
        XCTAssertGreaterThan(upload.sentFrames, Int(duration * 45))
        XCTAssertEqual(statistics.droppedNativeFrames, 0)
        XCTAssertEqual(statistics.droppedPCMFrames, 0); XCTAssertEqual(upload.droppedFrames, 0)
        XCTAssertGreaterThan(audioBytes, 0)
        XCTAssertGreaterThan(audioAfterInput, 0, "Greeting alone cannot prove AUDIO-to-AUDIO responses")
        XCTAssertGreaterThan(inputs, 0, "Speak English into the microphone during the real-mic test")
        XCTAssertGreaterThan(captured.userTurns, 0)
        let restored = try JSONDecoder().decode(PracticeSession.self, from: JSONEncoder().encode(captured))
        XCTAssertEqual(restored.messages, captured.messages)
        let characters = captured.messages.filter { $0.role == .user }.reduce(0) { $0 + $1.text.count }
        print("Live audio soak: source=\(real ? "real microphone" : "synthetic PCM"), seconds=\(Int(elapsed)), nativeFrames=\(statistics.nativeFrames), convertedFrames=\(statistics.convertedFrames), sentFrames=\(upload.sentFrames), droppedPCM=\(statistics.droppedPCMFrames), droppedNetwork=\(upload.droppedFrames), inputSegments=\(inputs), inputCharacters=\(characters), finalizedInputs=\(finalizedInputs), outputSegments=\(outputs), interrupted=\(interruptions), audioBytes=\(audioBytes), audioAfterInput=\(audioAfterInput), failureStage=\(failure?.stage ?? "none"), closeCode=\(failure?.closeCode ?? 0), transportCode=\(failure?.transportCode ?? 0)")
    }
}
