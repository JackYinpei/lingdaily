import Foundation

enum PracticeNetworkError: LocalizedError, Equatable {
    case notConfigured(String)
    case signedOut
    case invalidReply
    case unavailable
    case server(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured(let message): return message
        case .signedOut: return "请先在「我的」用 Apple 登录，再同步账号数据。"
        case .invalidReply: return "AI 回复格式不完整，请重试。你的内容已保留。"
        case .unavailable: return "暂时连不上接口，请检查网络或接口地址后重试。"
        case .server(let message): return message
        }
    }
}

/// Production service for optional Sign in with Apple sync, public scenario catalog, and public daily podcasts.
enum LingDailyService {
    static let baseURL = URL(string: "https://lingdaily.yasobi.xyz")!
}

struct AccountSignInRequest: Encodable {
    let identityToken: String
    let nonce: String
    let fullName: String?
}

/// Fresh Sign in with Apple confirmation for permanently deleting the account.
struct AccountDeletionRequest: Encodable {
    let identityToken: String
    let nonce: String
    let authorizationCode: String?
}

struct AccountSignInResponse: Decodable {
    struct Account: Decodable { let id: String; let email: String; let isPrivateEmail: Bool }
    let sessionToken: String
    let expiresAt: String
    let account: Account

    func session(appleUserID: String) -> AccountSession? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let expiry = formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt) else { return nil }
        let session = AccountSession(token: sessionToken, userID: account.id, expiresAt: expiry, email: account.email,
                                     isPrivateEmail: account.isPrivateEmail, appleUserID: appleUserID)
        return session.isUsable() ? session : nil
    }
}

/// The AI calls practice features make; views and controllers take one injected instance.
protocol PracticeServing {
    func respond(to request: AIPracticeRequest) async throws -> AIPracticeResponse
    func reviewSentences(_ request: SentenceReviewRequest) async throws -> [SentenceReviewRecord]
    func createScenario(from description: String) async throws -> PracticeScenario
    func createNewsScenario(from episode: TodayEpisode) async throws -> PracticeScenario
    func translate(_ text: String) async throws -> String
    func suggest(for session: PracticeSession) async throws -> LiveSuggestion
    func liveConnection(for session: PracticeSession) throws -> LiveConnectionSpec
    func scenarioIdeas(avoiding shown: [String], interests: [String]) async throws -> [String]
}

private struct ServerFailure: Decodable { let message: String }

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

final class PracticeAPIClient: PracticeServing {
    typealias HTTPTransport = @Sendable (URLRequest) async throws -> (Data, HTTPURLResponse)

    private let accountSession: () -> AccountSession?
    private let aiSettings: () -> AISettings
    private let aiTransport: HTTPTransport

    /// Shared by every client so requests reuse warm connections (and TLS sessions)
    /// to the Tokyo server instead of paying a new handshake from China each time.
    private static let backendSession = makeSession(requestTimeout: 35, resourceTimeout: 40)
    /// Sync uploads the local archive and downloads the cloud copy; both can be large
    /// on a slow uplink, so only the overall limit is longer.
    private static let syncSession = makeSession(requestTimeout: 35, resourceTimeout: 120)
    private static let directAISession = makeSession(requestTimeout: 50, resourceTimeout: 75)

    private static func makeSession(requestTimeout: TimeInterval, resourceTimeout: TimeInterval) -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = requestTimeout
        config.timeoutIntervalForResource = resourceTimeout
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.waitsForConnectivity = true
        // Freshness is decided by the stores, as before, not by a shared response cache.
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }

    init(accountSession: @escaping () -> AccountSession? = { AccountKeychain.load() },
         aiSettings: @escaping () -> AISettings = { AISettingsKeychain.load() ?? AISettings() },
         aiTransport: HTTPTransport? = nil) {
        self.accountSession = accountSession
        self.aiSettings = aiSettings
        self.aiTransport = aiTransport ?? { request in
            let (data, response) = try await Self.directAISession.data(for: request)
            guard let http = response as? HTTPURLResponse else { throw PracticeNetworkError.invalidReply }
            return (data, http)
        }
    }

    // MARK: - Optional Account, Cloud Sync & Public Editorial Content

    /// Exchanges a Sign in with Apple identity token for a LingDaily session.
    func signIn(_ request: AccountSignInRequest) async throws -> AccountSignInResponse {
        try await sendBackend("api/ios/auth/apple", request, bearer: nil)
    }

    /// Uploads pending local changes (including encrypted AISettings) and returns the account's cloud copy.
    func sync(_ changes: SyncChanges) async throws -> SyncSnapshot {
        guard let account = accountSession(), account.isUsable() else { throw PracticeNetworkError.signedOut }
        return try await sendBackend("api/ios/sync", changes, bearer: account.token,
                                     encoder: CloudSyncCoding.encoder, decoder: CloudSyncCoding.decoder,
                                     maxBytes: 64 * 1024 * 1024, session: Self.syncSession)
    }

    /// Permanently deletes the account and its cloud data (web data and synced AI settings included).
    func deleteAccount(_ request: AccountDeletionRequest) async throws {
        guard let account = accountSession(), account.isUsable() else { throw PracticeNetworkError.signedOut }
        struct Deleted: Decodable { let deleted: Bool }
        let result: Deleted = try await sendBackend("api/ios/account/delete", request, bearer: account.token)
        guard result.deleted else { throw PracticeNetworkError.invalidReply }
    }

    /// Built-in scenarios. Public editorial content; requires no login.
    func scenarioCatalog() async throws -> (scenarios: [PracticeScenario], extras: [String: ScenarioExtras]) {
        let response: ScenarioCatalogResponse = try await sendBackend("api/ios/scenarios", Optional<String>.none,
                                                                      bearer: nil, maxBytes: 512 * 1024, method: "GET")
        let scenarios = response.validScenarios
        guard !scenarios.isEmpty else { throw PracticeNetworkError.invalidReply }
        return (scenarios, response.validExtras)
    }

    /// Recent daily bilingual news podcasts (`GET /api/ios/podcasts`). Public; requires no login.
    func podcasts() async throws -> [TodayEpisode] {
        let response: PodcastListResponse = try await sendBackend("api/ios/podcasts", Optional<String>.none,
                                                                  bearer: nil, maxBytes: 1024 * 1024, method: "GET")
        return response.episodes
    }

    // MARK: - Direct BYOK AI Operations (Gemini & OpenAI)

    func respond(to request: AIPracticeRequest) async throws -> AIPracticeResponse {
        let context = DirectAIPrompts.buildPracticeContext(request)
        var retryContext = context
        retryContext["formatReminder"] = "The previous attempt was invalid. Rewrite ONLY learnerLatestAnswer in feedback.revised; do not put the role-play partner reply there. Follow every required field and length limit."
        let latestAnswer = (context["learnerLatestAnswer"] as? String) ?? ""
        let (model, turn) = try await generateStructured(
            systemInstruction: DirectAIPrompts.practiceInstruction(
                level: request.level,
                attitude: request.attitude,
                temperament: request.temperament,
                reviewItems: request.reviewItems
            ),
            schema: DirectAIPrompts.practiceResponseSchema,
            payload: context,
            retryPayload: retryContext,
            temperature: 0.65,
            maxOutputTokens: 1800,
            invalidMessage: "AI 这次的表达建议不完整，请重试。",
            unavailableMessage: "暂时连不上你配置的模型接口，请重试。你的回答已保留。",
            parse: { raw in try DirectAIPrompts.parsePracticeTurn(raw, action: request.action, learnerAnswer: latestAnswer) }
        )
        return AIPracticeResponse(requestId: request.requestId, model: model, data: turn)
    }

    func reviewSentences(_ request: SentenceReviewRequest) async throws -> [SentenceReviewRecord] {
        let payload: [String: Any] = [
            "scenario": DirectAIPrompts.scenarioDictionary(request.scenario),
            "learnerMessages": request.messages.map {
                [
                    "messageId": $0.messageId.uuidString.lowercased(),
                    "text": $0.text,
                    "precedingPartner": $0.precedingPartner,
                ]
            },
        ]
        var retryPayload = payload
        retryPayload["formatReminder"] = "Return exactly one item for EVERY provided messageId. Empty strings mean no improvement needed. Preserve learner meaning and perspective."
        let (_, records) = try await generateStructured(
            systemInstruction: DirectAIPrompts.sentenceReviewInstruction,
            schema: DirectAIPrompts.sentenceReviewSchema,
            payload: payload,
            retryPayload: retryPayload,
            temperature: 0.2,
            maxOutputTokens: 8192,
            invalidMessage: "这次的表达建议不完整，请重试。",
            unavailableMessage: "暂时无法整理表达建议，原话已保留。",
            parse: { raw in try DirectAIPrompts.parseSentenceReview(raw, request: request) }
        )
        return records
    }

    /// Generates a three-step scenario from the learner's own description of an upcoming conversation.
    func createScenario(from description: String) async throws -> PracticeScenario {
        let cleanDescription = String(description.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300))
        guard !cleanDescription.isEmpty else { throw PracticeNetworkError.invalidReply }
        let payload: [String: Any] = ["learnerDescription": cleanDescription]
        var retryPayload = payload
        retryPayload["formatReminder"] = "The previous attempt was invalid. Return exactly 3 steps and respect every field length."
        let scenarioID = "custom-\(UUID().uuidString)"
        let (_, scenario) = try await generateStructured(
            systemInstruction: DirectAIPrompts.scenarioInstruction,
            schema: DirectAIPrompts.scenarioResponseSchema,
            payload: payload,
            retryPayload: retryPayload,
            temperature: 0.8,
            maxOutputTokens: 2400,
            invalidMessage: "AI 这次没能生成完整的场景，请重试。",
            unavailableMessage: "暂时连不上模型接口，请重试。你的描述已保留。",
            parse: { raw in try DirectAIPrompts.parseScenarioDraft(raw, id: scenarioID) }
        )
        return scenario
    }

    func createNewsScenario(from episode: TodayEpisode) async throws -> PracticeScenario {
        let payload: [String: Any] = [
            "episodeTitle": episode.title,
            "date": episode.date,
            "summaryZh": episode.summary,
            "vocabulary": episode.vocabulary.map {
                ["term": $0.term, "meaning": $0.meaning, "example": $0.example]
            },
        ]
        var retryPayload = payload
        retryPayload["formatReminder"] = "The previous attempt was invalid. Return exactly 3 steps and respect every field length."
        let scenarioID = "news-\(episode.date)"
        let (_, scenario) = try await generateStructured(
            systemInstruction: DirectAIPrompts.newsScenarioInstruction,
            schema: DirectAIPrompts.scenarioResponseSchema,
            payload: payload,
            retryPayload: retryPayload,
            temperature: 0.6,
            maxOutputTokens: 2400,
            invalidMessage: "这期播客的话题没准备好，请再试一次。",
            unavailableMessage: "暂时连不上模型接口，请检查网络或接口设置后重试。",
            parse: { raw in try DirectAIPrompts.parseScenarioDraft(raw, id: scenarioID) }
        )
        return scenario
    }

    /// Chinese gloss for one partner line, fetched when the learner taps 中文.
    func translate(_ text: String) async throws -> String {
        let clean = String(text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1000))
        guard !clean.isEmpty else { throw PracticeNetworkError.invalidReply }
        let payload: [String: Any] = ["line": clean]
        var retryPayload = payload
        retryPayload["formatReminder"] = "Return {\"translation\": \"...\"} only."
        let (_, translation) = try await generateStructured(
            systemInstruction: DirectAIPrompts.translationInstruction,
            schema: DirectAIPrompts.translationResponseSchema,
            payload: payload,
            retryPayload: retryPayload,
            temperature: 0.2,
            maxOutputTokens: 1200,
            invalidMessage: "这句翻译不完整，请重试。",
            unavailableMessage: "暂时无法翻译，请稍后重试。",
            parse: DirectAIPrompts.parseTranslation
        )
        return translation
    }

    /// Chinese-first reply idea for the learner's next line in a Live call.
    func suggest(for session: PracticeSession) async throws -> LiveSuggestion {
        guard let request = LiveSuggestionRequest(session: session) else {
            throw PracticeNetworkError.invalidReply
        }
        let stepGoal = request.scenario.goals.indices.contains(request.stepIndex)
            ? request.scenario.goals[request.stepIndex]
            : (request.scenario.goals.last ?? "")
        var payload: [String: Any] = [
            "scenario": DirectAIPrompts.scenarioDictionary(request.scenario),
            "personalGoal": request.goal,
            "context": request.context,
            "currentTask": stepGoal,
            "stepIndex": request.stepIndex,
            "recentMessages": request.messages.map { ["role": $0.role.rawValue, "text": $0.text] },
        ]
        for (k, v) in DirectAIPrompts.partnerStyleContext(attitude: request.attitude, temperament: request.temperament) {
            payload[k] = v
        }
        if let reviewItems = request.reviewItems, !reviewItems.isEmpty {
            payload["reviewItems"] = reviewItems.map { ["text": $0.text, "meaning": $0.meaning] }
        }
        var retryPayload = payload
        retryPayload["formatReminder"] = "Return hint, keywords, reply and meaning only, within the length limits."
        let (_, suggestion) = try await generateStructured(
            systemInstruction: DirectAIPrompts.suggestionInstruction(reviewItems: request.reviewItems),
            schema: DirectAIPrompts.suggestionResponseSchema(level: request.level),
            payload: payload,
            retryPayload: retryPayload,
            temperature: 0.5,
            maxOutputTokens: 1500,
            invalidMessage: "这次的建议不完整，请再点一次。",
            unavailableMessage: "暂时拿不到建议，请稍后再试。",
            parse: DirectAIPrompts.parseSuggestion
        )
        return suggestion
    }

    func liveConnection(for session: PracticeSession) throws -> LiveConnectionSpec {
        guard let resolved = aiSettings().resolvedVoice else {
            throw PracticeNetworkError.notConfigured("请先在「接口设置」中填写 API Key 与实时语音模型。")
        }
        return try LiveConnectionSpec.make(
            provider: resolved.provider,
            config: resolved.config,
            session: session,
            pauseMs: LivePause.milliseconds()
        )
    }

    /// "换一批": three fresh one-line scenario ideas, avoiding ones already shown.
    func scenarioIdeas(avoiding shown: [String], interests: [String]) async throws -> [String] {
        var payload: [String: Any] = [
            "avoid": Array(shown.suffix(30)).map { String($0.prefix(120)) },
        ]
        for (k, v) in DirectAIPrompts.interestNotes(interests) {
            payload[k] = v
        }
        var retryPayload = payload
        retryPayload["formatReminder"] = "Return exactly 3 ideas, each at most 30 Chinese characters."
        let (_, ideas) = try await generateStructured(
            systemInstruction: DirectAIPrompts.ideasInstruction,
            schema: DirectAIPrompts.ideasResponseSchema,
            payload: payload,
            retryPayload: retryPayload,
            temperature: 1.0,
            maxOutputTokens: 1200,
            invalidMessage: "这一批没生成好，请再点一次。",
            unavailableMessage: "暂时换不了，请稍后再试。",
            parse: DirectAIPrompts.parseIdeas
        )
        return ideas
    }

    // MARK: - Private Transport Helpers

    private func generateStructured<T>(
        systemInstruction: String,
        schema: [String: Any],
        payload: [String: Any],
        retryPayload: [String: Any],
        temperature: Double,
        maxOutputTokens: Int,
        invalidMessage: String,
        unavailableMessage: String,
        parse: (String) throws -> T
    ) async throws -> (model: String, data: T) {
        guard let resolved = aiSettings().resolvedText else {
            throw PracticeNetworkError.notConfigured("请先在「接口设置」中填写 API Key 与文字模型。")
        }
        let provider = resolved.provider
        let config = resolved.config
        let activeModel = provider == .gemini ? AIEndpointNormalizer.cleanGeminiModel(config.textModel) : config.textModel

        for attempt in 0..<2 {
            let currentPayload = attempt == 0 ? payload : retryPayload
            let currentTemp = attempt == 0 ? temperature : 0.2
            let payloadJSON = try DirectAICodec.encodeJSONString(currentPayload)
            let urlRequest: URLRequest
            switch provider {
            case .gemini:
                urlRequest = try DirectAICodec.geminiGenerateRequest(
                    baseURL: config.baseURL,
                    apiKey: config.apiKey,
                    model: activeModel,
                    systemInstruction: systemInstruction,
                    schema: schema,
                    payloadJSON: payloadJSON,
                    temperature: currentTemp,
                    maxOutputTokens: maxOutputTokens
                )
            case .openai:
                urlRequest = try DirectAICodec.openAIChatRequest(
                    baseURL: config.baseURL,
                    apiKey: config.apiKey,
                    model: activeModel,
                    systemInstruction: systemInstruction,
                    schema: schema,
                    payloadJSON: payloadJSON,
                    temperature: currentTemp
                )
            }
            let data: Data
            let http: HTTPURLResponse
            do {
                (data, http) = try await aiTransport(urlRequest)
                try Task.checkCancellation()
            } catch is CancellationError {
                throw CancellationError()
            } catch let error as URLError where error.code == .cancelled {
                throw CancellationError()
            } catch let error as PracticeNetworkError {
                throw error
            } catch {
                throw PracticeNetworkError.server(unavailableMessage)
            }

            guard data.count <= 2 * 1024 * 1024 else {
                throw PracticeNetworkError.server(invalidMessage)
            }

            let rawText: String
            do {
                switch provider {
                case .gemini:
                    rawText = try DirectAICodec.parseGeminiGenerateResponse(data: data, statusCode: http.statusCode, model: activeModel)
                case .openai:
                    rawText = try DirectAICodec.parseOpenAIChatResponse(data: data, statusCode: http.statusCode, model: activeModel)
                }
            } catch let error as PracticeNetworkError {
                if case .invalidReply = error, attempt == 0 { continue }
                throw error
            }

            do {
                let parsed = try parse(rawText)
                return (activeModel, parsed)
            } catch {
                if attempt == 0 { continue }
                throw PracticeNetworkError.server(invalidMessage)
            }
        }
        throw PracticeNetworkError.server(invalidMessage)
    }

    private func sendBackend<Body: Encodable, Result: Decodable>(
        _ path: String,
        _ body: Body,
        bearer: String?,
        encoder: JSONEncoder = JSONEncoder(),
        decoder: JSONDecoder = JSONDecoder(),
        maxBytes: Int = 24 * 1024,
        method: String = "POST",
        session: URLSession = PracticeAPIClient.backendSession
    ) async throws -> Result {
        var urlRequest = URLRequest(url: LingDailyService.baseURL.appendingPathComponent(path))
        urlRequest.httpMethod = method
        if let bearer { urlRequest.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        if method != "GET" {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = try encoder.encode(body)
        }
        do {
            let (data, response) = try await session.data(for: urlRequest)
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse, data.count <= maxBytes else { throw PracticeNetworkError.invalidReply }
            guard http.statusCode == 200 else {
                if http.statusCode == 401, bearer != nil {
                    // The production session expired or was rejected: sign out on this device.
                    AccountKeychain.delete()
                    NotificationCenter.default.post(name: .accountSessionRejected, object: nil)
                    throw PracticeNetworkError.signedOut
                }
                if let failure = try? JSONDecoder().decode(ServerFailure.self, from: data), failure.message.count <= 200 {
                    throw PracticeNetworkError.server(failure.message)
                }
                throw PracticeNetworkError.unavailable
            }
            return try decoder.decode(Result.self, from: data)
        } catch is CancellationError { throw CancellationError() }
        catch let error as PracticeNetworkError { throw error }
        catch let error as URLError where error.code == .cancelled { throw CancellationError() }
        catch is DecodingError { throw PracticeNetworkError.invalidReply }
        catch { throw PracticeNetworkError.unavailable }
    }
}
