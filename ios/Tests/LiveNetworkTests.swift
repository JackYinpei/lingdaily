import Foundation
import XCTest
@testable import PracticeCore

final class LiveNetworkTests: XCTestCase {
    /// Explicit opt-in only; synthetic text, no learner recording or private data.
    @MainActor
    func testRealConstrainedLiveWithSharedSwiftClient() async throws {
        guard ProcessInfo.processInfo.environment["LINGDAILY_LIVE_TEST"] == "1",
              let path = ProcessInfo.processInfo.environment["LINGDAILY_AI_TEST_CONFIG"] else {
            throw XCTSkip("Set LINGDAILY_LIVE_TEST=1 and LINGDAILY_AI_TEST_CONFIG to use Gemini quota")
        }
        let config = try JSONDecoder().decode(AIConnectionConfiguration.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
        let scenario = PracticeScenario(id: "synthetic", title: "Synthetic deadline rehearsal", subtitle: "Test", category: "Test",
            symbol: "mic", partner: "Alex", partnerRole: "Colleague", setting: "A fictional work conversation",
            steps: (0..<3).map { index in
                .init(id: "\(index)", goal: ["Explain delay", "Propose Thursday", "Confirm agreement"][index], prompt: "Test",
                      translation: "测试", hint: "测试", keywords: "test", expression: "Test", meaning: "测试")
            })
        let token = try await PracticeAPIClient(configuration: config).liveToken(for: PracticeSession(scenario: scenario, useAI: true))
        let client = LiveWebSocketClient()
        var continuation: AsyncStream<LiveEvent>.Continuation!
        let stream = AsyncStream<LiveEvent> { continuation = $0 }
        let events = continuation!
        let timeout = Task {
            try? await Task.sleep(nanoseconds: 55_000_000_000)
            if !Task.isCancelled { events.finish() }
        }
        defer { timeout.cancel(); events.finish() }
        try await client.connect(token, generation: 1,
            handler: { event, _ in events.yield(event) }, failure: { _, _ in events.finish() })
        var setup = 0, audioBytes = 0, output = 0, turns = 0
        var tools = Set<String>()
        for await event in stream {
            switch event {
            case .setupComplete:
                setup += 1
                try await client.sendText("Please begin our rehearsal at the current task.", generation: 1)
            case .audio(let pcm):
                audioBytes += pcm.count
                XCTAssertEqual(pcm.count % 2, 0)
            case .transcription(.partner, _, _): output += 1
            case .tool(let call): XCTAssertNotNil(call.validated()); tools.insert(call.name)
            case .turnComplete:
                turns += 1
                if turns == 1 {
                    try await client.sendText("The supplier no give me data yesterday. I need move deadline to Thursday. I do not know how to say 供应商 in English.", generation: 1)
                }
            default: break
            }
            if turns == 2 { break }
        }
        await client.close()
        XCTAssertEqual(setup, 1); XCTAssertEqual(turns, 2)
        XCTAssertGreaterThan(audioBytes, 0); XCTAssertGreaterThan(output, 0)
        // Tool choice is model-dependent: report names, do not invent a promise
        // that every grammatically poor sentence will always invoke both tools.
        print("Live Swift smoke: setup=\(setup), audioBytes=\(audioBytes), subtitles=\(output), turns=\(turns), tools=\(tools.sorted())")
    }
}
