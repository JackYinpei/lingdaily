import Foundation

struct LiveTokenRequest: Encodable {
    struct Message: Encodable { let role: PracticeMessage.Role; let text: String }
    let scenario: AIPracticeRequest.Scenario
    let goal, context: String
    let stepIndex: Int
    let messages: [Message]
    var model: String? = nil
    init(session: PracticeSession) {
        scenario = .init(title: session.scenario.title, partner: session.scenario.partner,
                         partnerRole: session.scenario.partnerRole, setting: session.scenario.setting,
                         goals: session.scenario.steps.map(\.goal))
        goal = session.personalGoal; context = session.context; stepIndex = session.stepIndex
        messages = session.messages.filter { !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.suffix(12).map { .init(role: $0.role, text: String($0.text.trimmingCharacters(in: .whitespacesAndNewlines).prefix(2000))) }
    }
}

struct LiveToken: Decodable {
    let token, model, wsURL, expiresAt: String
    static let endpoint = "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
    static let relayEndpoint = "wss://lingdailyapi-jp.yasobi.xyz/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
    static let legacyRelayEndpoint = "wss://lingdailyapi.yasobi.xyz/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained"
    func connectionURL() throws -> URL {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let expiry = formatter.date(from: expiresAt) ?? ISO8601DateFormatter().date(from: expiresAt)
        guard [Self.endpoint, Self.relayEndpoint, Self.legacyRelayEndpoint].contains(wsURL), !token.isEmpty, token.utf8.count <= 4096,
              !model.isEmpty, model.count <= 100,
              let expiry, expiry > Date(),
              var parts = URLComponents(string: wsURL) else { throw LiveProtocolError.invalid }
        parts.queryItems = [URLQueryItem(name: "access_token", value: token)]
        guard let url = parts.url else { throw LiveProtocolError.invalid }
        return url
    }
}

enum LiveProtocolError: Error { case invalid, overloaded }

struct LiveToolCall {
    let id, name: String
    let arguments: [String: Any]
    func validated() -> LiveToolAction? {
        guard !id.isEmpty, id.utf8.count <= 128, name.utf8.count <= 80,
              let data = try? JSONSerialization.data(withJSONObject: arguments), data.count <= 8192 else { return nil }
        func value(_ key: String, _ max: Int) -> String? {
            guard let s = arguments[key] as? String, !s.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  s.count <= max else { return nil }
            return s
        }
        switch name {
        case "record_language_correction":
            guard Set(arguments.keys) == ["original", "corrected", "explanation", "category"],
                  let original = value("original", 2000), let corrected = value("corrected", 800),
                  let explanation = value("explanation", 500), let category = value("category", 40),
                  ["grammar", "word_choice", "naturalness", "other"].contains(category) else { return nil }
            return .correction(original: original, feedback: .init(revised: corrected, meaning: "", note: explanation))
        case "record_unfamiliar_learning_items":
            guard Set(arguments.keys) == ["items"], let raw = arguments["items"] as? [[String: Any]],
                  !raw.isEmpty, raw.count <= 20 else { return nil }
            var items: [AILearningItem] = []
            for item in raw {
                guard Set(item.keys) == ["text", "type", "meaning"],
                      let text = item["text"] as? String, let type = item["type"] as? String,
                      let meaning = item["meaning"] as? String,
                      ["word", "phrase", "grammar", "other"].contains(type),
                      !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, text.count <= 80,
                      !meaning.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, meaning.count <= 120 else { return nil }
                if !items.contains(where: { SavedExpression.key($0.text) == SavedExpression.key(text) }) {
                    items.append(.init(text: text, type: type, meaning: meaning))
                }
            }
            return .items(items)
        case "mark_task_complete":
            guard Set(arguments.keys) == ["taskIndex"], let number = arguments["taskIndex"] as? NSNumber,
                  CFGetTypeID(number) != CFBooleanGetTypeID(), number.doubleValue.rounded() == number.doubleValue,
                  (0...2).contains(number.intValue) else { return nil }
            return .complete(number.intValue)
        default: return nil
        }
    }
}

enum LiveToolAction { case correction(original: String, feedback: AIFeedback), items([AILearningItem]), complete(Int) }

enum LiveEvent {
    case setupComplete, interrupted, turnComplete, goAway
    case transcription(PracticeMessage.Role, String, finished: Bool)
    case audio(Data)
    case tool(LiveToolCall)
    case cancelledTools([String])
    case usage(LiveUsage)
}

import CoreFoundation

enum LiveCodec {
    private static func encode(_ value: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: value)
        guard let string = String(data: data, encoding: .utf8) else { throw LiveProtocolError.invalid }
        return string
    }
    static func setup(model: String) throws -> String {
        // The server-bound token supplies ALL configuration. Client cannot
        // replace the system instruction, tools, voice, transcription or VAD.
        try encode(["setup": ["model": "models/\(model)"]])
    }
    static func audio(_ pcm: Data) throws -> String {
        guard !pcm.isEmpty, pcm.count <= 3200, pcm.count % 2 == 0 else { throw LiveProtocolError.invalid }
        return try encode(["realtimeInput": ["audio": ["mimeType": "audio/pcm;rate=16000", "data": pcm.base64EncodedString()]]])
    }
    static func audioEnd() throws -> String { try encode(["realtimeInput": ["audioStreamEnd": true]]) }
    static func text(_ text: String) throws -> String {
        guard !text.isEmpty, text.count <= 2000 else { throw LiveProtocolError.invalid }
        return try encode(["clientContent": ["turns": [["role": "user", "parts": [["text": text]]]], "turnComplete": true]])
    }
    static func toolResponse(_ call: LiveToolCall, accepted: Bool) throws -> String {
        try encode(["toolResponse": ["functionResponses": [["id": call.id, "name": call.name,
                    "response": ["status": accepted ? "accepted" : "rejected"]]]]])
    }
    static func parse(_ data: Data) throws -> [LiveEvent] {
        guard data.count <= 512 * 1024,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any], root["error"] == nil else {
            throw LiveProtocolError.invalid
        }
        var events: [LiveEvent] = []
        if root["setupComplete"] != nil { events.append(.setupComplete) }
        if let content = root["serverContent"] as? [String: Any] {
            // Invalidation always precedes audio in the same envelope.
            let interrupted = content["interrupted"] as? Bool == true
            if interrupted { events.append(.interrupted) }
            for (key, role) in [("inputTranscription", PracticeMessage.Role.user), ("outputTranscription", .partner)] {
                if let trans = content[key] as? [String: Any] {
                    let text = trans["text"] as? String ?? ""
                    let finished = trans["finished"] as? Bool == true
                    guard !text.isEmpty || finished else { continue }
                    guard text.count <= 8000 else { throw LiveProtocolError.overloaded }
                    events.append(.transcription(role, text, finished: finished))
                }
            }
            if !interrupted, let turn = content["modelTurn"] as? [String: Any], let parts = turn["parts"] as? [[String: Any]] {
                for part in parts {
                    if let inline = part["inlineData"] as? [String: Any],
                       let mime = inline["mimeType"] as? String, mime.hasPrefix("audio/pcm"),
                       let raw = inline["data"] as? String, let pcm = Data(base64Encoded: raw) {
                        guard pcm.count % 2 == 0, pcm.count <= 240_000 else { throw LiveProtocolError.invalid }
                        events.append(.audio(pcm))
                    }
                }
            }
            if content["turnComplete"] as? Bool == true { events.append(.turnComplete) }
        }
        if let tool = root["toolCall"] as? [String: Any], let calls = tool["functionCalls"] as? [[String: Any]] {
            guard calls.count <= 20 else { throw LiveProtocolError.overloaded }
            for call in calls {
                guard let id = call["id"] as? String, let name = call["name"] as? String,
                      id.utf8.count <= 128, name.utf8.count <= 80 else { throw LiveProtocolError.invalid }
                events.append(.tool(.init(id: id, name: name, arguments: call["args"] as? [String: Any] ?? [:])))
            }
        }
        if let cancellation = root["toolCallCancellation"] as? [String: Any], let ids = cancellation["ids"] as? [String] {
            guard ids.count <= 20, ids.allSatisfy({ $0.utf8.count <= 128 }) else { throw LiveProtocolError.invalid }
            events.append(.cancelledTools(ids))
        }
        if let metadata = root["usageMetadata"] as? [String: Any], let usage = LiveUsage(metadata: metadata) {
            events.append(.usage(usage))
        }
        if root["goAway"] != nil { events.append(.goAway) }
        return events
    }
}

struct LiveGenerations {
    private(set) var connection: UInt64 = 0
    private(set) var playback: UInt64 = 0
    mutating func reconnect() { connection &+= 1; playback &+= 1 }
    mutating func interrupt() { playback &+= 1 }
    func accepts(connection value: UInt64) -> Bool { value == connection }
    func accepts(connection c: UInt64, playback p: UInt64) -> Bool { c == connection && p == playback }
}

/// Frame exactly 20ms of 16kHz mono PCM16; preserve bytes across converter calls.
struct LivePCMFramer {
    private var remainder = Data()
    mutating func append(_ bytes: Data) throws -> [Data] {
        guard bytes.count % 2 == 0, bytes.count <= 32_000 else { throw LiveProtocolError.invalid }
        remainder.append(bytes)
        var frames: [Data] = []
        while remainder.count >= 640 { frames.append(Data(remainder.prefix(640))); remainder.removeFirst(640) }
        return frames
    }
    mutating func reset() { remainder.removeAll(keepingCapacity: true) }
    static func encode(_ samples: [Float]) -> Data {
        var bytes = Data(capacity: samples.count * 2)
        for sample in samples {
            let clipped = sample.isFinite ? max(-1, min(1, sample)) : 0
            let value = Int16((clipped * 32767).rounded()).littleEndian
            bytes.append(UInt8(truncatingIfNeeded: value)); bytes.append(UInt8(truncatingIfNeeded: value >> 8))
        }
        return bytes
    }
    static func decode(_ bytes: Data) throws -> [Float] {
        guard bytes.count % 2 == 0 else { throw LiveProtocolError.invalid }
        let values = [UInt8](bytes)
        return stride(from: 0, to: values.count, by: 2).map {
            Float(Int16(bitPattern: UInt16(values[$0]) | UInt16(values[$0 + 1]) << 8)) / 32768
        }
    }
}

/// Streaming text is a delta; identical deltas can be intentional repetitions.
/// Only a full final snapshot replaces previous text. Interrupted
/// turnComplete belongs to the cancelled model turn, not the learner's barge-in.
struct LiveTranscriptReducer {
    struct Segment { let id: UUID; var text: String; var finalized: Bool }
    private var segments: [String: Segment] = [:]
    private var interrupted = false
    private var inputTurnBoundary = false
    mutating func update(role: PracticeMessage.Role, text: String, finished: Bool) throws -> Segment {
        let key = role.rawValue
        var segment = segments[key] ?? Segment(id: UUID(), text: "", finalized: false)
        if role == .user, inputTurnBoundary, !finished,
           !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            // Older model variants may omit finished. A non-final delta after
            // normal turnComplete starts the next input turn; a late explicit
            // final marker still updates the preceding bubble.
            segment = Segment(id: UUID(), text: "", finalized: false)
        } else if segment.finalized {
            // A new learner utterance can precede the interrupted notification.
            // Do not silently discard its first words while the partner speaks.
            if role == .user, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
               !finished || !segment.text.hasPrefix(text) {
                segment = Segment(id: UUID(), text: "", finalized: false)
            } else { return segment }
        }
        if finished, text.hasPrefix(segment.text) { segment.text = text }
        else { segment.text += text }
        guard segment.text.count <= 8000 else { throw LiveProtocolError.overloaded }
        segment.finalized = finished
        segments[key] = segment
        if role == .user { inputTurnBoundary = false }
        return segment
    }
    mutating func finishPartner() {
        segments.removeValue(forKey: PracticeMessage.Role.partner.rawValue)
        if segments[PracticeMessage.Role.user.rawValue]?.finalized == true {
            segments.removeValue(forKey: PracticeMessage.Role.user.rawValue)
        }
        interrupted = true
        inputTurnBoundary = false
    }
    mutating func finishTurn() {
        segments.removeValue(forKey: PracticeMessage.Role.partner.rawValue)
        // Retain unfinished user text for a late final marker. Interrupted
        // turnComplete must never mark a boundary in the learner's barge-in.
        inputTurnBoundary = !interrupted
        if segments[PracticeMessage.Role.user.rawValue]?.finalized == true {
            segments.removeValue(forKey: PracticeMessage.Role.user.rawValue)
        }
        interrupted = false
    }
    mutating func reset() { segments.removeAll(); interrupted = false; inputTurnBoundary = false }
}

/// Reservations include work not yet dispatched and buffers already scheduled
/// on the player. Thus both dispatch backlog and player backlog are bounded.
struct LivePlaybackBuffer {
    private(set) var generation: UInt64 = 0
    private(set) var reservedBytes = 0
    private var reservedChunks = 0
    private var pending: [Data] = []
    private var scheduled: [Data] = []
    private(set) var schedulingGeneration: UInt64 = 0
    let maxBytes: Int
    let maxChunks: Int
    init(maxBytes: Int = 480_000, maxChunks: Int = 256) {
        self.maxBytes = maxBytes; self.maxChunks = maxChunks
    }
    mutating func reserve(bytes: Int) -> UInt64? {
        guard bytes > 0, bytes % 2 == 0, reservedBytes + bytes <= maxBytes, reservedChunks < maxChunks else { return nil }
        reservedBytes += bytes; reservedChunks += 1
        return generation
    }
    @discardableResult
    mutating func enqueue(_ data: Data, generation epoch: UInt64) -> Bool {
        guard epoch == generation else { return false }
        pending.append(data); return true
    }
    mutating func next(outputReady: Bool) -> (Data, UInt64, UInt64)? {
        guard outputReady, !pending.isEmpty else { return nil }
        let data = pending.removeFirst()
        scheduled.append(data)
        return (data, generation, schedulingGeneration)
    }
    @discardableResult
    mutating func complete(bytes: Int, generation epoch: UInt64, schedulingGeneration schedule: UInt64? = nil) -> Bool {
        guard epoch == generation, schedule == nil || schedule == schedulingGeneration,
              let index = scheduled.firstIndex(where: { $0.count == bytes }) else { return false }
        scheduled.remove(at: index)
        reservedBytes = max(0, reservedBytes - bytes); reservedChunks = max(0, reservedChunks - 1)
        return true
    }
    /// A hardware restart cancels player scheduling, not the conversation.
    /// Retain scheduled audio and reject completions from the previous player
    /// timeline. Reservations not yet dispatched also remain valid.
    mutating func requeueScheduled() {
        schedulingGeneration &+= 1
        pending = scheduled + pending
        scheduled.removeAll(keepingCapacity: true)
    }
    mutating func invalidate() {
        generation &+= 1; schedulingGeneration &+= 1
        pending.removeAll(); scheduled.removeAll(); reservedBytes = 0; reservedChunks = 0
    }
}
