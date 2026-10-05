import Foundation

enum PracticeNetworkError: LocalizedError {
    case notConfigured, signedOut, invalidReply, unavailable, server(String)
    var errorDescription: String? {
        switch self {
        case .notConfigured: return "本机开发服务配置无效。请重新运行 npm run ios:dev（真机加 -- --device），再从 Xcode 重新运行。"
        case .signedOut: return "请先在「我的」用 Apple 登录，再开始对话。"
        case .invalidReply: return "AI 回复不完整，请重试。你的回答已保留。"
        case .unavailable: return "暂时连不上服务，请检查网络后重试。"
        case .server(let message): return message
        }
    }
}

/// Production service. All AI calls go through it after Sign in with Apple.
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

struct AIConnectionConfiguration: Codable {
    let baseURL: URL
    let accessToken: String
    let allowsPhysicalDevice: Bool?

    init(baseURL: URL, accessToken: String, allowsPhysicalDevice: Bool? = nil) {
        self.baseURL = baseURL
        self.accessToken = accessToken
        self.allowsPhysicalDevice = allowsPhysicalDevice
    }

    /// Pairing is restricted to loopback or an explicitly opted-in private LAN.
    /// Public servers use the signed-in account session instead.
    func isValidForDevelopment(physicalDevice: Bool = false) -> Bool {
        guard baseURL.scheme == "http", baseURL.port == 8000,
              baseURL.user == nil, baseURL.password == nil, baseURL.query == nil,
              baseURL.fragment == nil, baseURL.path.isEmpty || baseURL.path == "/",
              accessToken.count == 64, accessToken.allSatisfy({ "0123456789abcdef".contains($0) }),
              let host = baseURL.host else { return false }
        if host == "localhost" { return !physicalDevice }
        guard allowsPhysicalDevice == true else { return false }
        let parts = host.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let numbers = parts.compactMap { Int($0) }
        guard numbers.count == 4, zip(parts, numbers).allSatisfy({ part, number in
            (0...255).contains(number) && part == String(number)
        }) else { return false }
        return numbers[0] == 10 || (numbers[0] == 172 && (16...31).contains(numbers[1]))
            || (numbers[0] == 192 && numbers[1] == 168)
    }

    static func bundled() -> AIConnectionConfiguration? {
        #if DEBUG
        guard let url = Bundle.main.url(forResource: "AIConnection", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let config = try? JSONDecoder().decode(Self.self, from: data) else { return nil }
        #if os(iOS) && !targetEnvironment(simulator)
        guard config.isValidForDevelopment(physicalDevice: true) else { return nil }
        #else
        guard config.isValidForDevelopment() else { return nil }
        #endif
        return config
        #else
        return nil
        #endif
    }
}

protocol PracticeServing {
    func respond(to request: AIPracticeRequest) async throws -> AIPracticeResponse
}

private struct ServerFailure: Decodable { let message: String }

private final class NoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}

final class PracticeAPIClient: PracticeServing {
    /// Debug-only local pairing from `npm run ios:dev`; nil means the production service.
    let configuration: AIConnectionConfiguration?
    private let session: URLSession
    private let accountSession: () -> AccountSession?

    init(configuration: AIConnectionConfiguration? = .bundled(),
         accountSession: @escaping () -> AccountSession? = { AccountKeychain.load() }) {
        self.configuration = configuration
        self.accountSession = accountSession
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 35
        config.timeoutIntervalForResource = 40
        config.httpCookieAcceptPolicy = .never
        config.httpShouldSetCookies = false
        config.waitsForConnectivity = true
        session = URLSession(configuration: config, delegate: NoRedirectDelegate(), delegateQueue: nil)
    }

    deinit { session.invalidateAndCancel() }

    /// True when this build talks to a local development server and needs no account.
    var usesLocalDevelopment: Bool { configuration != nil }

    /// Exchanges a Sign in with Apple identity token for a LingDaily session.
    func signIn(_ request: AccountSignInRequest) async throws -> AccountSignInResponse {
        try await send("api/ios/auth/apple", request, baseURL: LingDailyService.baseURL, bearer: nil)
    }

    /// Uploads pending local changes and returns the account's cloud copy.
    func sync(_ changes: SyncChanges) async throws -> SyncSnapshot {
        guard configuration == nil else { throw PracticeNetworkError.notConfigured }
        guard let account = accountSession(), account.isUsable() else { throw PracticeNetworkError.signedOut }
        return try await send("api/ios/sync", changes, baseURL: LingDailyService.baseURL, bearer: account.token,
                              encoder: CloudSyncCoding.encoder, decoder: CloudSyncCoding.decoder, maxBytes: 64 * 1024 * 1024)
    }

    /// Permanently deletes the account and its cloud data (web data included).
    func deleteAccount(_ request: AccountDeletionRequest) async throws {
        guard let account = accountSession(), account.isUsable() else { throw PracticeNetworkError.signedOut }
        struct Deleted: Decodable { let deleted: Bool }
        let result: Deleted = try await send("api/ios/account/delete", request, baseURL: LingDailyService.baseURL, bearer: account.token)
        guard result.deleted else { throw PracticeNetworkError.invalidReply }
    }

    func respond(to request: AIPracticeRequest) async throws -> AIPracticeResponse {
        let result: AIPracticeResponse = try await post("api/ios/practice", request)
        guard result.requestId == request.requestId, result.data.isValid(for: request.action) else {
            throw PracticeNetworkError.invalidReply
        }
        return result
    }

    /// Generates a three-step scenario from the learner's own description of an upcoming conversation.
    func createScenario(from description: String) async throws -> PracticeScenario {
        let request = AIScenarioRequest(requestId: UUID(), description: String(description.prefix(300)))
        let result: AIScenarioResponse = try await post("api/ios/scenario", request)
        guard result.requestId == request.requestId, let scenario = result.makeScenario() else {
            throw PracticeNetworkError.invalidReply
        }
        return scenario
    }

    func liveToken(for session: PracticeSession) async throws -> LiveToken {
        try await post("api/ios/live-token", LiveTokenRequest(session: session))
    }

    private func post<Body: Encodable, Result: Decodable>(_ path: String, _ body: Body) async throws -> Result {
        #if os(iOS) && !targetEnvironment(simulator)
        let physicalDevice = true
        #else
        let physicalDevice = false
        #endif
        if let config = configuration {
            guard config.isValidForDevelopment(physicalDevice: physicalDevice) else { throw PracticeNetworkError.notConfigured }
            return try await send(path, body, baseURL: config.baseURL, bearer: config.accessToken)
        }
        guard let account = accountSession(), account.isUsable() else { throw PracticeNetworkError.signedOut }
        return try await send(path, body, baseURL: LingDailyService.baseURL, bearer: account.token)
    }

    private func send<Body: Encodable, Result: Decodable>(_ path: String, _ body: Body, baseURL: URL, bearer: String?,
                                                          encoder: JSONEncoder = JSONEncoder(), decoder: JSONDecoder = JSONDecoder(),
                                                          maxBytes: Int = 24 * 1024) async throws -> Result {
        var urlRequest = URLRequest(url: baseURL.appendingPathComponent(path))
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let bearer { urlRequest.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization") }
        urlRequest.httpBody = try encoder.encode(body)
        do {
            let (data, response) = try await session.data(for: urlRequest)
            try Task.checkCancellation()
            guard let http = response as? HTTPURLResponse, data.count <= maxBytes else { throw PracticeNetworkError.invalidReply }
            guard http.statusCode == 200 else {
                if http.statusCode == 401, configuration == nil, bearer != nil {
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
