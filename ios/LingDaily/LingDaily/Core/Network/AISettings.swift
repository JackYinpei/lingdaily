import Foundation
import Security

enum AIProviderKind: String, Codable, CaseIterable, Identifiable {
    case gemini, openai
    var id: String { rawValue }
    var title: String { self == .gemini ? "Google Gemini" : "OpenAI" }

    /// Prefilled newest models (checked end to end with the app's real requests on 2026-11-28).
    var defaultTextModel: String { self == .gemini ? "gemini-3.8-flash" : "gpt-6.2-sol" }
    var defaultLiveModel: String { self == .gemini ? "gemini-3.8-live" : "gpt-realtime-2.1" }
}

struct AIProviderConfiguration: Codable, Equatable {
    var apiKey: String = ""
    var baseURL: String = ""
    var textModel: String = ""
    var liveModel: String = ""

    init(apiKey: String = "", baseURL: String = "", textModel: String = "", liveModel: String = "") {
        self.apiKey = apiKey
        self.baseURL = baseURL
        self.textModel = textModel
        self.liveModel = liveModel
    }

    private enum CodingKeys: String, CodingKey {
        case apiKey, baseURL, textModel, liveModel
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        apiKey = try container.decodeIfPresent(String.self, forKey: .apiKey) ?? ""
        baseURL = try container.decodeIfPresent(String.self, forKey: .baseURL) ?? ""
        textModel = try container.decodeIfPresent(String.self, forKey: .textModel) ?? ""
        liveModel = try container.decodeIfPresent(String.self, forKey: .liveModel) ?? ""
    }

    var trimmed: AIProviderConfiguration {
        AIProviderConfiguration(
            apiKey: String(apiKey.trimmingCharacters(in: .whitespacesAndNewlines).prefix(512)),
            baseURL: String(baseURL.trimmingCharacters(in: .whitespacesAndNewlines).prefix(512)),
            textModel: String(textModel.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120)),
            liveModel: String(liveModel.trimmingCharacters(in: .whitespacesAndNewlines).prefix(120))
        )
    }

    var hasAnyValue: Bool {
        let clean = trimmed
        return !clean.apiKey.isEmpty || !clean.baseURL.isEmpty || !clean.textModel.isEmpty || !clean.liveModel.isEmpty
    }

    /// Empty model fields become the provider's default models.
    func withDefaultModels(for provider: AIProviderKind) -> AIProviderConfiguration {
        var filled = self
        if filled.textModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { filled.textModel = provider.defaultTextModel }
        if filled.liveModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { filled.liveModel = provider.defaultLiveModel }
        return filled
    }
}

struct AISettings: Codable, Equatable {
    var updatedAt: Date = Date(timeIntervalSince1970: 0)
    var textProvider: AIProviderKind = .gemini
    var voiceProvider: AIProviderKind = .gemini
    var gemini: AIProviderConfiguration = .init()
    var openai: AIProviderConfiguration = .init()

    init(updatedAt: Date = Date(timeIntervalSince1970: 0),
         textProvider: AIProviderKind = .gemini,
         voiceProvider: AIProviderKind = .gemini,
         gemini: AIProviderConfiguration = .init(),
         openai: AIProviderConfiguration = .init()) {
        self.updatedAt = updatedAt
        self.textProvider = textProvider
        self.voiceProvider = voiceProvider
        self.gemini = gemini
        self.openai = openai
    }

    private enum CodingKeys: String, CodingKey {
        case updatedAt, textProvider, voiceProvider, gemini, openai
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt) ?? Date(timeIntervalSince1970: 0)
        textProvider = try container.decodeIfPresent(AIProviderKind.self, forKey: .textProvider) ?? .gemini
        voiceProvider = try container.decodeIfPresent(AIProviderKind.self, forKey: .voiceProvider) ?? .gemini
        gemini = try container.decodeIfPresent(AIProviderConfiguration.self, forKey: .gemini) ?? .init()
        openai = try container.decodeIfPresent(AIProviderConfiguration.self, forKey: .openai) ?? .init()
    }

    func configuration(for provider: AIProviderKind) -> AIProviderConfiguration {
        provider == .gemini ? gemini : openai
    }

    mutating func setConfiguration(_ configuration: AIProviderConfiguration, for provider: AIProviderKind) {
        if provider == .gemini {
            gemini = configuration
        } else {
            openai = configuration
        }
    }

    func sanitized() -> AISettings {
        AISettings(
            updatedAt: Self.millisecondAligned(updatedAt),
            textProvider: textProvider,
            voiceProvider: voiceProvider,
            gemini: gemini.trimmed,
            openai: openai.trimmed
        )
    }

    func hasSameContent(as other: AISettings) -> Bool {
        let a = sanitized()
        let b = other.sanitized()
        return a.textProvider == b.textProvider
            && a.voiceProvider == b.voiceProvider
            && a.gemini == b.gemini
            && a.openai == b.openai
    }

    static func millisecondAligned(_ date: Date) -> Date {
        Date(timeIntervalSince1970: (date.timeIntervalSince1970 * 1000).rounded() / 1000)
    }

    var hasAnyValue: Bool {
        gemini.hasAnyValue || openai.hasAnyValue
    }

    /// The provider chosen in 接口设置; text and voice both use it (`voiceProvider` mirrors it for sync).
    var provider: AIProviderKind { textProvider }

    /// Both providers with empty model fields filled with their defaults.
    func withDefaultModels() -> AISettings {
        var filled = self
        filled.gemini = gemini.withDefaultModels(for: .gemini)
        filled.openai = openai.withDefaultModels(for: .openai)
        return filled
    }

    /// The chosen provider once it has an API key; empty models fall back to its defaults.
    private var resolved: (provider: AIProviderKind, config: AIProviderConfiguration)? {
        let config = configuration(for: provider).trimmed.withDefaultModels(for: provider)
        return config.apiKey.isEmpty ? nil : (provider, config)
    }

    var resolvedText: (provider: AIProviderKind, config: AIProviderConfiguration)? { resolved }

    var resolvedVoice: (provider: AIProviderKind, config: AIProviderConfiguration)? { resolved }

    var isAnyConfigured: Bool {
        resolvedText != nil || resolvedVoice != nil
    }
}

/// This-device-only Keychain item for user-configured BYOK credentials and models.
enum AISettingsKeychain {
    private static let service = "com.qcy.LingDaily.aiSettings"
    private static let account = "settings"
    private static let lock = NSLock()
    private static var loadedFromKeychain = false
    private static var cached: AISettings?

    private static var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    static func load() -> AISettings? {
        lock.lock()
        defer { lock.unlock() }
        if loadedFromKeychain { return cached }
        loadedFromKeychain = true
        var item: CFTypeRef?
        var request = query
        request[kSecReturnData as String] = true
        request[kSecMatchLimit as String] = kSecMatchLimitOne
        guard SecItemCopyMatching(request as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let decoded = try? CloudSyncCoding.decoder.decode(AISettings.self, from: data) else {
            cached = nil
            return nil
        }
        cached = decoded
        return decoded
    }

    @discardableResult
    static func save(_ settings: AISettings) -> Bool {
        guard let data = try? CloudSyncCoding.encoder.encode(settings) else { return false }
        lock.lock()
        defer { lock.unlock() }
        cached = settings
        loadedFromKeychain = true
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func delete() {
        lock.lock()
        defer { lock.unlock() }
        cached = nil
        loadedFromKeychain = true
        SecItemDelete(query as CFDictionary)
    }
}

/// Normalizes official and custom provider base URLs for HTTPS and WebSocket connections.
enum AIEndpointNormalizer {
    /// An empty base URL uses the project's Tokyo relay (phones in mainland China cannot reach the
    /// official endpoints); a URL the learner enters, official or their own relay, replaces it.
    static let defaultGeminiBase = "https://lingdailyapi-jp.yasobi.xyz"
    static let defaultOpenAIBase = "https://lingdailyapi-jp.yasobi.xyz/openai"

    /// Strict query encoding: `URLComponents.queryItems` leaves `+` alone, which servers read as a space.
    private static func queryValue(_ raw: String) -> String? {
        raw.addingPercentEncoding(withAllowedCharacters: CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"))
    }

    static func cleanGeminiModel(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("models/") {
            return String(trimmed.dropFirst("models/".count))
        }
        return trimmed
    }

    static func isLoopbackOrPrivateLAN(_ host: String) -> Bool {
        let lower = host.lowercased()
        if lower == "localhost" || lower == "127.0.0.1" || lower == "::1" || lower == "[::1]" {
            return true
        }
        let parts = lower.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count == 4 else { return false }
        let octets = parts.compactMap { Int($0) }
        guard octets.count == 4, zip(parts, octets).allSatisfy({ part, value in
            (0...255).contains(value) && part == String(value)
        }) else { return false }
        return octets[0] == 10
            || octets[0] == 127
            || (octets[0] == 172 && (16...31).contains(octets[1]))
            || (octets[0] == 192 && octets[1] == 168)
    }

    private static func parseOriginAndPath(_ raw: String, defaultOrigin: String) throws -> URLComponents {
        var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix("/") { text.removeLast() }
        if text.isEmpty { text = defaultOrigin }
        else if !text.contains("://") { text = "https://" + text }
        guard var components = URLComponents(string: text),
              let scheme = components.scheme?.lowercased(),
              let host = components.host, !host.isEmpty,
              components.user == nil, components.password == nil,
              components.query == nil, components.fragment == nil else {
            throw PracticeNetworkError.notConfigured("接口地址格式不正确，请检查后再试。")
        }
        guard scheme == "https" || (scheme == "http" && isLoopbackOrPrivateLAN(host)) else {
            throw PracticeNetworkError.notConfigured("接口地址必须使用 https://（仅本机或局域网支持 http://）。")
        }
        components.scheme = scheme
        while components.path.hasSuffix("/") && components.path.count > 1 {
            components.path.removeLast()
        }
        if components.path == "/" { components.path = "" }
        return components
    }

    static func cleanGeminiBaseURL(_ raw: String) throws -> String {
        var components = try parseOriginAndPath(raw, defaultOrigin: defaultGeminiBase)
        for suffix in ["/v1beta", "/v1alpha"] {
            if components.path.hasSuffix(suffix) {
                components.path = String(components.path.dropLast(suffix.count))
                break
            }
        }
        while components.path.hasSuffix("/") { components.path.removeLast() }
        guard let url = components.url else {
            throw PracticeNetworkError.notConfigured("Gemini 接口地址格式不正确。")
        }
        return url.absoluteString
    }

    static func geminiGenerateContentURL(baseURL: String, model: String) throws -> URL {
        let base = try cleanGeminiBaseURL(baseURL)
        let cleanModel = cleanGeminiModel(model)
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/:")
        guard !cleanModel.isEmpty,
              let encodedModel = cleanModel.addingPercentEncoding(withAllowedCharacters: allowed),
              let url = URL(string: "\(base)/v1beta/models/\(encodedModel):generateContent") else {
            throw PracticeNetworkError.notConfigured("文字模型名称无效，请检查接口设置。")
        }
        return url
    }

    static func geminiModelsURL(baseURL: String) throws -> URL {
        let base = try cleanGeminiBaseURL(baseURL)
        guard let url = URL(string: "\(base)/v1beta/models?pageSize=100") else {
            throw PracticeNetworkError.notConfigured("Gemini 接口地址格式不正确。")
        }
        return url
    }

    static func geminiLiveWebSocketURL(baseURL: String, apiKey: String) throws -> URL {
        let cleanKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanKey.isEmpty else {
            throw PracticeNetworkError.notConfigured("请先在接口设置中填写 API Key。")
        }
        let base = try cleanGeminiBaseURL(baseURL)
        guard var components = URLComponents(string: base) else {
            throw PracticeNetworkError.notConfigured("Gemini 接口地址格式不正确。")
        }
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path += "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
        components.percentEncodedQueryItems = [URLQueryItem(name: "key", value: queryValue(cleanKey))]
        guard let url = components.url else {
            throw PracticeNetworkError.notConfigured("Gemini 语音接口地址格式不正确。")
        }
        return url
    }

    static func cleanOpenAIV1BaseURL(_ raw: String) throws -> String {
        var components = try parseOriginAndPath(raw, defaultOrigin: defaultOpenAIBase)
        if components.path.hasSuffix("/chat/completions") {
            components.path = String(components.path.dropLast("/chat/completions".count))
        }
        while components.path.hasSuffix("/") { components.path.removeLast() }
        if !components.path.hasSuffix("/v1") {
            components.path += "/v1"
        }
        guard let url = components.url else {
            throw PracticeNetworkError.notConfigured("OpenAI 接口地址格式不正确。")
        }
        return url.absoluteString
    }

    static func openAIChatCompletionsURL(baseURL: String) throws -> URL {
        let v1 = try cleanOpenAIV1BaseURL(baseURL)
        guard let url = URL(string: "\(v1)/chat/completions") else {
            throw PracticeNetworkError.notConfigured("OpenAI 接口地址格式不正确。")
        }
        return url
    }

    static func openAIModelsURL(baseURL: String) throws -> URL {
        let v1 = try cleanOpenAIV1BaseURL(baseURL)
        guard let url = URL(string: "\(v1)/models") else {
            throw PracticeNetworkError.notConfigured("OpenAI 接口地址格式不正确。")
        }
        return url
    }

    static func openAIRealtimeWebSocketURL(baseURL: String, model: String) throws -> URL {
        let cleanModel = model.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanModel.isEmpty else {
            throw PracticeNetworkError.notConfigured("请先在接口设置中填写实时语音模型。")
        }
        let v1 = try cleanOpenAIV1BaseURL(baseURL)
        guard var components = URLComponents(string: v1) else {
            throw PracticeNetworkError.notConfigured("OpenAI 接口地址格式不正确。")
        }
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path += "/realtime"
        components.percentEncodedQueryItems = [URLQueryItem(name: "model", value: queryValue(cleanModel))]
        guard let url = components.url else {
            throw PracticeNetworkError.notConfigured("OpenAI 语音接口地址格式不正确。")
        }
        return url
    }
}
