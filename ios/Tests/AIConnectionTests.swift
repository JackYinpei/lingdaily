import Foundation
import XCTest
@testable import PracticeCore

extension AISettings {
    /// Opt-in real-model tests read a local `AISettings` JSON file (never committed), e.g.
    /// `{"textProvider":"gemini","voiceProvider":"gemini","gemini":{"apiKey":"…","textModel":"…","liveModel":"…"}}`.
    static func testConfiguration(at path: String) throws -> AISettings {
        try CloudSyncCoding.decoder.decode(AISettings.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
    }
}

/// Bring-your-own-key connections: the app reaches Google Gemini or OpenAI (or a proxy the learner
/// configured) directly, never through the LingDaily server, and does nothing without a key.
final class AIConnectionTests: XCTestCase {
    private final class Recorder: @unchecked Sendable {
        private let lock = NSLock()
        private var stored: [URLRequest] = []
        var requests: [URLRequest] { lock.lock(); defer { lock.unlock() }; return stored }
        func record(_ request: URLRequest) { lock.lock(); stored.append(request); lock.unlock() }
    }

    private func scenario() -> PracticeScenario {
        PracticeScenario(id: "deadline", title: "申请延期", subtitle: "和经理谈", category: "职场", symbol: "clock",
            partner: "Alex", partnerRole: "经理", setting: "你想把项目截止日期推迟两天。",
            steps: (0..<3).map { PracticeStep(id: "s\($0)", goal: "目标", prompt: "P?", translation: "译", hint: "提示",
                                              keywords: "k", expression: "E", meaning: "意") })
    }

    private func json(_ string: String) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: Data(string.utf8)) as? [String: Any])
    }

    private func body(_ request: URLRequest) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: XCTUnwrap(request.httpBody)) as? [String: Any])
    }

    private func reply(_ object: [String: Any], status: Int = 200, for request: URLRequest) throws -> (Data, HTTPURLResponse) {
        (try JSONSerialization.data(withJSONObject: object),
         HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
    }

    func testNormalizesOfficialAndProxyBaseURLsAndBlocksPublicCleartext() throws {
        XCTAssertEqual(try AIEndpointNormalizer.cleanGeminiBaseURL(""), "https://generativelanguage.googleapis.com")
        XCTAssertEqual(try AIEndpointNormalizer.cleanGeminiBaseURL("my-proxy.example.com/v1beta/"), "https://my-proxy.example.com")
        XCTAssertEqual(try AIEndpointNormalizer.cleanGeminiBaseURL("https://my-proxy.example.com/custom/v1alpha"), "https://my-proxy.example.com/custom")
        XCTAssertEqual(try AIEndpointNormalizer.cleanGeminiBaseURL("http://192.168.1.20:8080/"), "http://192.168.1.20:8080")
        XCTAssertEqual(try AIEndpointNormalizer.geminiGenerateContentURL(baseURL: "my-proxy.example.com/v1beta/", model: "models/gemini-2.5-flash").absoluteString,
                       "https://my-proxy.example.com/v1beta/models/gemini-2.5-flash:generateContent")

        XCTAssertEqual(try AIEndpointNormalizer.cleanOpenAIV1BaseURL(""), "https://api.openai.com/v1")
        XCTAssertEqual(try AIEndpointNormalizer.cleanOpenAIV1BaseURL("https://api.openai.com/v1/"), "https://api.openai.com/v1")
        XCTAssertEqual(try AIEndpointNormalizer.cleanOpenAIV1BaseURL("proxy.example.com/openai"), "https://proxy.example.com/openai/v1")
        XCTAssertEqual(try AIEndpointNormalizer.cleanOpenAIV1BaseURL("https://proxy.example.com/openai/v1/chat/completions"),
                       "https://proxy.example.com/openai/v1")
        XCTAssertEqual(try AIEndpointNormalizer.openAIChatCompletionsURL(baseURL: "proxy.example.com").absoluteString,
                       "https://proxy.example.com/v1/chat/completions")

        for bad in ["http://public-proxy.example.com", "http://172.32.0.1:8080", "https://user:pass@proxy.example.com",
                    "https://proxy.example.com?x=1", "https://proxy.example.com#frag"] {
            XCTAssertThrowsError(try AIEndpointNormalizer.cleanOpenAIV1BaseURL(bad), bad)
            XCTAssertThrowsError(try AIEndpointNormalizer.cleanGeminiBaseURL(bad), bad)
        }
    }

    func testNothingIsSentWithoutAKeyAndModel() async {
        let recorder = Recorder()
        let unconfigured = AISettings(gemini: .init(apiKey: "key-only"), openai: .init(textModel: "gpt-4o-mini"))
        XCTAssertNil(unconfigured.resolvedText)
        XCTAssertNil(unconfigured.resolvedVoice)
        let api = PracticeAPIClient(accountSession: { nil }, aiSettings: { unconfigured }, aiTransport: { request in
            recorder.record(request)
            throw URLError(.notConnectedToInternet)
        })
        do {
            _ = try await api.translate("Hello")
            XCTFail("An unconfigured app must not call any model")
        } catch {
            guard case .notConfigured = error as? PracticeNetworkError else { return XCTFail("\(error)") }
        }
        XCTAssertThrowsError(try api.liveConnection(for: PracticeSession(scenario: scenario(), useAI: true)))
        XCTAssertTrue(recorder.requests.isEmpty)
    }

    func testGeminiTextGoesDirectlyWithTheKeyInAHeader() async throws {
        let recorder = Recorder()
        let settings = AISettings(textProvider: .gemini,
                                  gemini: .init(apiKey: " AIza-secret ", baseURL: "https://lingdailyapi-jp.yasobi.xyz", textModel: "gemini-2.5-flash"))
        let api = PracticeAPIClient(accountSession: { nil }, aiSettings: { settings }, aiTransport: { [self] request in
            recorder.record(request)
            return try reply(["candidates": [["finishReason": "STOP", "content": ["parts": [
                ["thought": true, "text": "thinking that must be ignored"],
                ["text": "```json\n{\"translation\":\"你好。\"}\n```"],
            ]]]]], for: request)
        })
        let translation = try await api.translate("Hello")
        XCTAssertEqual(translation, "你好。")
        let request = try XCTUnwrap(recorder.requests.first)
        XCTAssertEqual(recorder.requests.count, 1)
        XCTAssertEqual(request.url?.absoluteString,
                       "https://lingdailyapi-jp.yasobi.xyz/v1beta/models/gemini-2.5-flash:generateContent")
        XCTAssertEqual(request.value(forHTTPHeaderField: "x-goog-api-key"), "AIza-secret")
        XCTAssertFalse(request.url!.absoluteString.contains("secret"), "The key never goes into an HTTP URL")
        let config = try XCTUnwrap(try body(request)["generationConfig"] as? [String: Any])
        XCTAssertEqual(config["responseMimeType"] as? String, "application/json")
        XCTAssertEqual((config["thinkingConfig"] as? [String: Any])?["thinkingBudget"] as? Int, 0)
    }

    func testFallsBackToTheOtherProviderAndOmitsTemperatureForReasoningModels() async throws {
        let recorder = Recorder()
        let settings = AISettings(textProvider: .gemini, openai: .init(apiKey: "sk-test", textModel: "gpt-5-mini"))
        XCTAssertEqual(settings.resolvedText?.provider, .openai)
        let api = PracticeAPIClient(accountSession: { nil }, aiSettings: { settings }, aiTransport: { [self] request in
            recorder.record(request)
            return try reply(["choices": [["finish_reason": "stop", "message": ["content": "{\"translation\":\"早上好。\"}"]]]], for: request)
        })
        let translation = try await api.translate("Good morning")
        XCTAssertEqual(translation, "早上好。")
        let request = try XCTUnwrap(recorder.requests.first)
        XCTAssertEqual(request.url?.absoluteString, "https://api.openai.com/v1/chat/completions")
        XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer sk-test")
        let sent = try body(request)
        XCTAssertEqual(sent["model"] as? String, "gpt-5-mini")
        XCTAssertNil(sent["temperature"], "Reasoning models reject a custom temperature")
        XCTAssertEqual((sent["response_format"] as? [String: Any])?["type"] as? String, "json_object")

        let standard = try body(DirectAICodec.openAIChatRequest(baseURL: "", apiKey: "k", model: "gpt-4o-mini", systemInstruction: "s",
                                                                schema: DirectAIPrompts.translationResponseSchema, payloadJSON: "{}", temperature: 0.4))
        XCTAssertEqual(standard["temperature"] as? Double, 0.4)
    }

    func testHTTPErrorsBecomeReadableMessagesWithoutRetrying() async {
        let recorder = Recorder()
        let settings = AISettings(gemini: .init(apiKey: "bad", textModel: "gemini-2.5-flash"))
        let api = PracticeAPIClient(accountSession: { nil }, aiSettings: { settings }, aiTransport: { [self] request in
            recorder.record(request)
            // What Gemini really returns for a wrong key: 400, not 401.
            return try reply(["error": ["code": 400, "message": "API key not valid. Please pass a valid API key.", "status": "INVALID_ARGUMENT",
                                        "details": [["reason": "API_KEY_INVALID"]]]], status: 400, for: request)
        })
        do {
            _ = try await api.translate("Hello")
            XCTFail("A rejected key must fail")
        } catch {
            XCTAssertTrue(error.localizedDescription.contains("API Key"), error.localizedDescription)
        }
        XCTAssertEqual(recorder.requests.count, 1)
    }

    func testModelListsAreDeduplicatedAndPreferChatModels() throws {
        let gemini = try JSONSerialization.data(withJSONObject: ["models": [
            ["name": "models/gemini-2.5-pro"], ["name": "models/gemini-2.5-flash"], ["name": "models/gemini-2.5-flash"], ["name": "models/embedding-001"],
        ]])
        XCTAssertEqual(try DirectAICodec.parseModelsResponse(provider: .gemini, data: gemini, statusCode: 200),
                       ["gemini-2.5-flash", "gemini-2.5-pro", "embedding-001"])
        let openai = try JSONSerialization.data(withJSONObject: ["data": [["id": "gpt-realtime"], ["id": "gpt-4o-mini"], ["id": "dall-e-3"]]])
        XCTAssertEqual(try DirectAICodec.parseModelsResponse(provider: .openai, data: openai, statusCode: 200),
                       ["gpt-4o-mini", "gpt-realtime", "dall-e-3"])
        XCTAssertThrowsError(try DirectAICodec.parseModelsResponse(provider: .openai, data: Data("{}".utf8), statusCode: 401))
    }

    func testGeminiLiveConnectsDirectlyOrThroughTheConfiguredProxy() throws {
        let session = PracticeSession(scenario: scenario(), useAI: true)
        let official = try LiveConnectionSpec.make(provider: .gemini, config: .init(apiKey: "AIza-k", liveModel: "models/gemini-live-test"), session: session)
        XCTAssertEqual(official.wsURL.absoluteString,
                       "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=AIza-k")
        XCTAssertTrue(official.headers.isEmpty)
        let setup = try XCTUnwrap(try json(official.setupMessage)["setup"] as? [String: Any])
        XCTAssertEqual(setup["model"] as? String, "models/gemini-live-test")
        XCTAssertEqual((setup["tools"] as? [[String: Any]])?.isEmpty, false)

        let proxied = try LiveConnectionSpec.make(provider: .gemini,
            config: .init(apiKey: "AIza-k", baseURL: "https://lingdailyapi-jp.yasobi.xyz/", liveModel: "gemini-live-test"), session: session)
        XCTAssertEqual(proxied.wsURL.scheme, "wss")
        XCTAssertEqual(proxied.wsURL.host, "lingdailyapi-jp.yasobi.xyz")
    }

    func testOpenAIRealtimeUsesTheGAInterface() throws {
        let session = PracticeSession(scenario: scenario(), useAI: true)
        let spec = try LiveConnectionSpec.make(provider: .openai, config: .init(apiKey: "sk-live", liveModel: "gpt-realtime"),
                                               session: session, pauseMs: LivePause.standard)
        XCTAssertEqual(spec.wsURL.absoluteString, "wss://api.openai.com/v1/realtime?model=gpt-realtime")
        XCTAssertEqual(spec.headers, ["Authorization": "Bearer sk-live"], "The beta OpenAI-Beta header was shut down on 2026-05-12")

        let update = try json(spec.setupMessage)
        XCTAssertEqual(update["type"] as? String, "session.update")
        let config = try XCTUnwrap(update["session"] as? [String: Any])
        XCTAssertEqual(config["type"] as? String, "realtime")
        XCTAssertEqual(config["output_modalities"] as? [String], ["audio"])
        for beta in ["modalities", "voice", "input_audio_format", "output_audio_format", "input_audio_transcription", "turn_detection"] {
            XCTAssertNil(config[beta], "Beta field \(beta) must not be sent")
        }
        let audio = try XCTUnwrap(config["audio"] as? [String: Any])
        let input = try XCTUnwrap(audio["input"] as? [String: Any])
        let output = try XCTUnwrap(audio["output"] as? [String: Any])
        for format in [input["format"], output["format"]] {
            XCTAssertEqual((format as? [String: Any])?["type"] as? String, "audio/pcm")
            XCTAssertEqual((format as? [String: Any])?["rate"] as? Int, 24000)
        }
        XCTAssertEqual((input["transcription"] as? [String: Any])?["model"] as? String, LiveCodec.openAITranscriptionModel)
        XCTAssertEqual((input["turn_detection"] as? [String: Any])?["type"] as? String, "server_vad")
        XCTAssertTrue(LiveInstructions.openAIAllVoices.contains(output["voice"] as? String ?? ""))
        XCTAssertEqual((config["tools"] as? [[String: Any]])?.count, 3)

        let kickoff = try LiveCodec.textMessages("Hello!", provider: .openai).map(json)
        XCTAssertEqual(kickoff.map { $0["type"] as? String }, ["conversation.item.create", "response.create"])
        XCTAssertEqual((kickoff[1]["response"] as? [String: Any])?["output_modalities"] as? [String], ["audio"])
    }

    func testOpenAIRealtimeEventsBecomeLiveEvents() throws {
        func parse(_ raw: String) throws -> [LiveEvent] { try LiveCodec.parse(Data(raw.utf8), provider: .openai) }
        guard case .setupComplete = try parse(#"{"type":"session.updated"}"#).first else { return XCTFail("setup") }
        guard case .audio(let pcm) = try parse(#"{"type":"response.output_audio.delta","delta":"AQA="}"#).first else { return XCTFail("audio") }
        XCTAssertEqual(pcm, Data([1, 0]))
        guard case .transcription(.partner, "Hi", finished: false) = try parse(#"{"type":"response.output_audio_transcript.delta","delta":"Hi"}"#).first
        else { return XCTFail("partner transcript") }
        guard case .tool(let call) = try parse(#"{"type":"response.function_call_arguments.done","call_id":"c1","name":"record_language_correction","arguments":"{\"original\":\"a\"}"}"#).first
        else { return XCTFail("tool") }
        XCTAssertEqual(call.id, "c1")
        XCTAssertTrue(try parse(#"{"type":"error","error":{"code":"conversation_already_has_active_response","message":"busy"}}"#).isEmpty)
        XCTAssertThrowsError(try parse(#"{"type":"error","error":{"message":"Invalid model"}}"#))
    }

    func testSettingsDecodeFromOlderPayloadsAndCompareByContent() throws {
        let old = try CloudSyncCoding.decoder.decode(AISettings.self, from: Data(#"{"gemini":{"apiKey":"k"}}"#.utf8))
        XCTAssertEqual(old.textProvider, .gemini)
        XCTAssertEqual(old.openai, AIProviderConfiguration())
        let a = AISettings(updatedAt: Date(), gemini: .init(apiKey: " k ", textModel: "m"))
        let b = AISettings(updatedAt: Date(timeIntervalSince1970: 1), gemini: .init(apiKey: "k", textModel: "m"))
        XCTAssertTrue(a.hasSameContent(as: b))
    }

    func testBundledCatalogHasEveryBuiltInScenarioOffline() throws {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../LingDaily/LingDaily/Resources/ScenarioCatalog.json").standardizedFileURL
        let catalog = try JSONDecoder().decode(ScenarioCatalogResponse.self, from: Data(contentsOf: url))
        XCTAssertEqual(catalog.validScenarios.count, 25)
        XCTAssertEqual(catalog.validExtras.count, 25)
        XCTAssertTrue(catalog.validExtras.values.allSatisfy { !$0.tags.isEmpty && $0.cast.count >= 2 })
    }

    func testSyncNeedsASignedInSession() async {
        let api = PracticeAPIClient(accountSession: { nil }, aiSettings: { AISettings() })
        do {
            _ = try await api.sync(SyncChanges(sessions: .init(upsert: [], delete: [])))
            XCTFail("Signed-out sync must not reach the network")
        } catch {
            XCTAssertEqual(error as? PracticeNetworkError, .signedOut)
        }
    }

    func testSignInResponseBecomesUsableSession() throws {
        let json = #"{"sessionToken":"header.payload.signature","expiresAt":"2099-01-01T00:00:00.000Z","account":{"id":"11111111-2222-4333-8444-555555555555","email":"x@privaterelay.appleid.com","isPrivateEmail":true}}"#
        let response = try JSONDecoder().decode(AccountSignInResponse.self, from: Data(json.utf8))
        let session = try XCTUnwrap(response.session(appleUserID: "001.apple"))
        XCTAssertTrue(session.isUsable())
        XCTAssertEqual(session.displayEmail, "Apple 隐藏邮箱")
        XCTAssertEqual(session.appleUserID, "001.apple")
        let bad = #"{"sessionToken":"has space","expiresAt":"2099-01-01T00:00:00.000Z","account":{"id":"u","email":"x@example.com","isPrivateEmail":false}}"#
        XCTAssertNil(try JSONDecoder().decode(AccountSignInResponse.self, from: Data(bad.utf8)).session(appleUserID: "a"))
    }
}
