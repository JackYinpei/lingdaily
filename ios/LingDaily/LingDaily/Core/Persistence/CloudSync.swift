import Foundation

/// Cloud copy of the signed-in account, as returned by `/api/ios/sync`.
/// Rehearsals, vocabulary and own scenarios live in the same Supabase tables as the web app;
/// `aiSettings` is stored encrypted per user on the server.
struct SyncSnapshot: Decodable {
    struct Session: Decodable { let id: String; let session: PracticeSession }
    struct Expression: Decodable {
        let key, text, meaning, source: String
        let createdAt: Date
        let kind: String?
    }
    let sessions: [Session]
    let expressions: [Expression]
    let scenarios: [PracticeScenario]
    let rejectedSessions: [String]?
    /// Sessions whose cloud copy is the version this device sent in `knownSessions`; not repeated in `sessions`.
    let unchangedSessions: [String]?
    let aiSettings: AISettings?
}

/// Local changes not yet in the cloud.
struct SyncChanges: Encodable {
    struct Bucket<Item: Encodable>: Encodable {
        var upsert: [Item] = []
        var delete: [String] = []
        var isEmpty: Bool { upsert.isEmpty && delete.isEmpty }
    }
    struct Expression: Encodable {
        let text, meaning, source: String
        let createdAt: Date
        let kind: String?
    }
    var sessions = Bucket<PracticeSession>()
    var expressions = Bucket<Expression>()
    var scenarios = Bucket<PracticeScenario>()
    /// Version (updatedAt, epoch ms) of every session on this device, so the server skips sending them back.
    var knownSessions: [String: Double]?
    var aiSettings: AISettings? = nil
    var isEmpty: Bool { sessions.isEmpty && expressions.isEmpty && scenarios.isEmpty && aiSettings == nil }
}

/// What one sync request may carry. Mirrors the server's limits; the byte budget also
/// stays below common proxy body limits, so a large first upload goes out in several rounds.
struct SyncBatchLimits {
    var sessions = 100, sessionDeletes = 200
    var expressions = 500, expressionDeletes = 500
    var scenarios = 50, scenarioDeletes = 50
    /// Leaves room for vocabulary, scenarios and `knownSessions`, keeping a request under 1 MB.
    var sessionBytes = 600 * 1024
    /// The server returns at most its newest 500 sessions; anything not listed simply comes back in full.
    var knownSessions = 500
    static let server = SyncBatchLimits()
}

enum CloudSyncCoding {
    private static let fractionalFormatter = makeFormatter(fractional: true)
    private static let wholeSecondFormatter = makeFormatter(fractional: false)
    private static func makeFormatter(fractional: Bool) -> ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = fractional ? [.withInternetDateTime, .withFractionalSeconds] : [.withInternetDateTime]
        return formatter
    }
    // Created once: a sync encodes and decodes thousands of dates.
    private static func formatter(fractional: Bool) -> ISO8601DateFormatter {
        fractional ? fractionalFormatter : wholeSecondFormatter
    }

    static var encoder: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(formatter(fractional: true).string(from: date))
        }
        return encoder
    }

    static var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = formatter(fractional: true).date(from: value) ?? formatter(fractional: false).date(from: value) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid date")
        }
        return decoder
    }
}

/// Bookkeeping for one account: what the cloud had at the last sync and what
/// still has to be sent. Changes are tracked explicitly (not by comparing
/// timestamps), so a round trip can never make an item look modified again.
struct SyncLedger: Codable, Equatable {
    struct Keys: Codable, Equatable {
        var sessions: Set<String> = []
        var expressions: Set<String> = []
        var scenarios: Set<String> = []
        var count: Int { sessions.count + expressions.count + scenarios.count }
    }

    var ownerUserID: String?
    var lastSyncedAt: Date?
    var synced = Keys()
    var dirty = Keys()
    var deleted = Keys()
    /// Sessions the server can never store (invalid or too large); kept locally, not retried until edited.
    var rejectedSessions: Set<String> = []
    var aiSettingsDirty: Bool = false

    init(ownerUserID: String? = nil,
         lastSyncedAt: Date? = nil,
         synced: Keys = Keys(),
         dirty: Keys = Keys(),
         deleted: Keys = Keys(),
         rejectedSessions: Set<String> = [],
         aiSettingsDirty: Bool = false) {
        self.ownerUserID = ownerUserID
        self.lastSyncedAt = lastSyncedAt
        self.synced = synced
        self.dirty = dirty
        self.deleted = deleted
        self.rejectedSessions = rejectedSessions
        self.aiSettingsDirty = aiSettingsDirty
    }

    private enum CodingKeys: String, CodingKey {
        case ownerUserID, lastSyncedAt, synced, dirty, deleted, rejectedSessions, aiSettingsDirty
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        ownerUserID = try container.decodeIfPresent(String.self, forKey: .ownerUserID)
        lastSyncedAt = try container.decodeIfPresent(Date.self, forKey: .lastSyncedAt)
        synced = try container.decodeIfPresent(Keys.self, forKey: .synced) ?? Keys()
        dirty = try container.decodeIfPresent(Keys.self, forKey: .dirty) ?? Keys()
        deleted = try container.decodeIfPresent(Keys.self, forKey: .deleted) ?? Keys()
        rejectedSessions = try container.decodeIfPresent(Set<String>.self, forKey: .rejectedSessions) ?? []
        aiSettingsDirty = try container.decodeIfPresent(Bool.self, forKey: .aiSettingsDirty) ?? false
    }

    var pendingCount: Int { dirty.count + deleted.count + (aiSettingsDirty ? 1 : 0) }

    static func sessionKey(_ id: UUID) -> String { id.uuidString.lowercased() }

    mutating func sessionChanged(_ id: UUID) {
        let key = Self.sessionKey(id)
        dirty.sessions.insert(key); deleted.sessions.remove(key); rejectedSessions.remove(key)
    }
    // Deletions are always sent: the item may already be on the server from an in-flight upload.
    mutating func sessionDeleted(_ id: UUID) {
        let key = Self.sessionKey(id)
        dirty.sessions.remove(key); deleted.sessions.insert(key)
    }
    mutating func expressionChanged(_ key: String) { dirty.expressions.insert(key); deleted.expressions.remove(key) }
    mutating func expressionDeleted(_ key: String) { dirty.expressions.remove(key); deleted.expressions.insert(key) }
    mutating func scenarioChanged(_ id: String) { dirty.scenarios.insert(id); deleted.scenarios.remove(id) }
    mutating func scenarioDeleted(_ id: String) { dirty.scenarios.remove(id); deleted.scenarios.insert(id) }
    mutating func aiSettingsChanged() { aiSettingsDirty = true }

    /// First sync for an account: everything already on this device is uploaded into it.
    mutating func adopt(owner: String, archive: PracticeArchive, hasAISettings: Bool = false) {
        self = SyncLedger(ownerUserID: owner)
        dirty.sessions = Set(archive.sessions.map { Self.sessionKey($0.id) })
        dirty.expressions = Set(archive.expressions.map(\.id))
        dirty.scenarios = Set(archive.scenarios.map(\.id))
        aiSettingsDirty = hasAISettings
    }

    /// After a lost ledger write: everything on this device is sent again, and the
    /// deletes the saved ledger still knew about are kept (resending a delete is harmless).
    mutating func readopt(owner: String, archive: PracticeArchive, hasAISettings: Bool = false) {
        let pendingDeletes = deleted
        let pendingAI = aiSettingsDirty
        adopt(owner: owner, archive: archive, hasAISettings: hasAISettings || pendingAI)
        deleted = Keys(sessions: pendingDeletes.sessions.subtracting(dirty.sessions),
                       expressions: pendingDeletes.expressions.subtracting(dirty.expressions),
                       scenarios: pendingDeletes.scenarios.subtracting(dirty.scenarios))
    }

    /// The next request's worth of pending changes. Whatever does not fit stays
    /// pending and goes out in the following round.
    func changes(from archive: PracticeArchive, aiSettings: AISettings? = nil, limits: SyncBatchLimits = .server) -> SyncChanges {
        var changes = SyncChanges()
        var bytes = 0
        for session in archive.sessions where dirty.sessions.contains(Self.sessionKey(session.id)) {
            guard changes.sessions.upsert.count < limits.sessions else { break }
            let size = (try? CloudSyncCoding.encoder.encode(session).count) ?? 0
            // A session larger than the whole budget still goes alone, so the server can reject it.
            if !changes.sessions.upsert.isEmpty, bytes + size > limits.sessionBytes { break }
            changes.sessions.upsert.append(session)
            bytes += size
        }
        changes.sessions.delete = Array(deleted.sessions.sorted().prefix(limits.sessionDeletes))
        changes.expressions.upsert = archive.expressions.filter { dirty.expressions.contains($0.id) }.prefix(limits.expressions).map {
            .init(text: $0.text, meaning: $0.meaning, source: $0.source, createdAt: $0.createdAt, kind: $0.kind)
        }
        changes.expressions.delete = Array(deleted.expressions.sorted().prefix(limits.expressionDeletes))
        changes.scenarios.upsert = Array(archive.scenarios.filter { dirty.scenarios.contains($0.id) }.prefix(limits.scenarios))
        changes.scenarios.delete = Array(deleted.scenarios.sorted().prefix(limits.scenarioDeletes))
        changes.knownSessions = Dictionary(archive.sessions.prefix(limits.knownSessions).map {
            (Self.sessionKey($0.id), $0.updatedAt.timeIntervalSince1970 * 1000)
        }, uniquingKeysWith: { a, _ in a })
        if aiSettingsDirty, let aiSettings {
            changes.aiSettings = aiSettings
        }
        return changes
    }

    /// Applies a successful round trip. `sent` is what was uploaded; anything
    /// changed locally while the request was in flight stays pending.
    /// Returns updated `AISettings` when the remote copy should replace the local one.
    @discardableResult
    mutating func merge(_ snapshot: SyncSnapshot, sent: SyncChanges, into archive: inout PracticeArchive,
                        localAISettings: AISettings? = nil, now: Date = Date()) -> AISettings? {
        let sentSessions = Dictionary(sent.sessions.upsert.map { (Self.sessionKey($0.id), $0.updatedAt) }, uniquingKeysWith: { a, _ in a })
        for session in archive.sessions {
            let key = Self.sessionKey(session.id)
            if sentSessions[key] == session.updatedAt { dirty.sessions.remove(key) }
        }
        for key in (snapshot.rejectedSessions ?? []).map({ $0.lowercased() }) where sentSessions[key] != nil {
            dirty.sessions.remove(key); rejectedSessions.insert(key)
        }
        dirty.expressions.subtract(sent.expressions.upsert.map { SavedExpression.key($0.text) })
        dirty.scenarios.subtract(sent.scenarios.upsert.map(\.id))
        deleted.sessions.subtract(sent.sessions.delete)
        deleted.expressions.subtract(sent.expressions.delete)
        deleted.scenarios.subtract(sent.scenarios.delete)

        var adoptedAISettings: AISettings?
        if sent.aiSettings != nil, localAISettings?.updatedAt == sent.aiSettings?.updatedAt {
            aiSettingsDirty = false
        }
        if let remoteAI = snapshot.aiSettings {
            let localUpdated = localAISettings?.updatedAt ?? .distantPast
            if !aiSettingsDirty || remoteAI.updatedAt > localUpdated {
                aiSettingsDirty = false
                if remoteAI != localAISettings {
                    adoptedAISettings = remoteAI
                }
            }
        }

        // Sessions the server did not repeat are this device's own copies (same version).
        let unchanged = Set((snapshot.unchangedSessions ?? []).map { $0.lowercased() })
        let held = archive.sessions.filter { unchanged.contains(Self.sessionKey($0.id)) }
            .map { SyncSnapshot.Session(id: Self.sessionKey($0.id), session: $0) }
        // Sessions: remote wins unless this device still has unsent edits or a pending delete.
        let remoteSessions = (snapshot.sessions + held).filter { $0.session.isValid && $0.session.userTurns > 0 }
        let remoteKeys = Set(remoteSessions.map { $0.id.lowercased() })
        var sessions = archive.sessions.filter { session in
            let key = Self.sessionKey(session.id)
            if dirty.sessions.contains(key) || remoteKeys.contains(key) || rejectedSessions.contains(key) { return true }
            if synced.sessions.contains(key) { return false } // deleted on another device or the web
            dirty.sessions.insert(key)
            return true
        }
        for remote in remoteSessions {
            let key = remote.id.lowercased()
            guard !dirty.sessions.contains(key), !deleted.sessions.contains(key) else { continue }
            sessions.removeAll { Self.sessionKey($0.id) == key }
            sessions.append(remote.session)
        }
        archive.sessions = sessions.sorted { $0.updatedAt > $1.updatedAt }

        // Vocabulary: union by key; removals elsewhere apply unless edited here.
        let remoteExpressions = Dictionary(snapshot.expressions.map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
        var expressions = archive.expressions.filter { item in
            if dirty.expressions.contains(item.id) || remoteExpressions[item.id] != nil { return true }
            if synced.expressions.contains(item.id) { return false }
            dirty.expressions.insert(item.id)
            return true
        }
        let localKeys = Set(expressions.map(\.id))
        for remote in snapshot.expressions where !localKeys.contains(remote.key) && !deleted.expressions.contains(remote.key) {
            expressions.append(SavedExpression(id: remote.key, text: remote.text, meaning: remote.meaning,
                                               source: remote.source, createdAt: remote.createdAt, kind: remote.kind))
        }
        archive.expressions = expressions.sorted { $0.createdAt > $1.createdAt }

        // Own scenarios.
        let remoteScenarios = Dictionary(snapshot.scenarios.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var scenarios = archive.scenarios.filter { scenario in
            if dirty.scenarios.contains(scenario.id) || remoteScenarios[scenario.id] != nil { return true }
            if synced.scenarios.contains(scenario.id) { return false }
            dirty.scenarios.insert(scenario.id)
            return true
        }
        for remote in snapshot.scenarios where !deleted.scenarios.contains(remote.id) {
            if let index = scenarios.firstIndex(where: { $0.id == remote.id }) {
                if !dirty.scenarios.contains(remote.id) { scenarios[index] = remote }
            } else {
                scenarios.append(remote)
            }
        }
        archive.scenarios = scenarios

        synced = Keys(sessions: remoteKeys, expressions: Set(remoteExpressions.keys), scenarios: Set(remoteScenarios.keys))
        lastSyncedAt = now
        return adoptedAISettings
    }
}
