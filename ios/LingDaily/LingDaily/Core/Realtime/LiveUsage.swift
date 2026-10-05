import Foundation

/// One `usageMetadata` message from Gemini Live. It covers a single model turn
/// (prompt incl. conversation context, and that turn's response), not a running
/// total, so a connection's usage is the sum of all of them.
struct LiveUsage: Equatable {
    var input = 0, output = 0, inputAudio = 0, outputAudio = 0, total = 0

    init(input: Int = 0, output: Int = 0, inputAudio: Int = 0, outputAudio: Int = 0, total: Int = 0) {
        self.input = input; self.output = output; self.inputAudio = inputAudio; self.outputAudio = outputAudio; self.total = total
    }

    init?(metadata: [String: Any]) {
        func int(_ key: String) -> Int { max(0, min((metadata[key] as? NSNumber)?.intValue ?? 0, 10_000_000)) }
        func audio(_ key: String) -> Int {
            (metadata[key] as? [[String: Any]] ?? [])
                .filter { ($0["modality"] as? String) == "AUDIO" }
                .reduce(0) { $0 + max(0, ($1["tokenCount"] as? NSNumber)?.intValue ?? 0) }
        }
        input = int("promptTokenCount"); output = int("responseTokenCount"); total = int("totalTokenCount")
        inputAudio = min(audio("promptTokensDetails"), input); outputAudio = min(audio("responseTokensDetails"), output)
        guard input + output + total > 0 else { return nil }
    }

    static func + (lhs: LiveUsage, rhs: LiveUsage) -> LiveUsage {
        LiveUsage(input: lhs.input + rhs.input, output: lhs.output + rhs.output, inputAudio: lhs.inputAudio + rhs.inputAudio,
                  outputAudio: lhs.outputAudio + rhs.outputAudio, total: lhs.total + rhs.total)
    }
}

/// What the app reports to `/api/ios/usage` when a Live connection ends.
struct LiveUsageReport: Encodable, Equatable {
    let reportId: UUID
    let model: String
    let inputTokens, outputTokens, inputAudioTokens, outputAudioTokens, totalTokens: Int

    init?(reportId: UUID, model: String, usage: LiveUsage) {
        guard usage.total > 0 || usage.input + usage.output > 0, !model.isEmpty else { return nil }
        self.reportId = reportId; self.model = model
        inputTokens = usage.input; outputTokens = usage.output
        inputAudioTokens = usage.inputAudio; outputAudioTokens = usage.outputAudio; totalTokens = usage.total
    }
}

/// The learner's own usage summary (`GET /api/ios/usage`).
struct AIUsageSummary: Decodable, Equatable {
    struct Group: Decodable, Equatable {
        let key: String
        let calls, total_tokens: Int
    }
    let days: Int
    let total: Group
    let byFeature: [Group]
}
