import Foundation

/// Stores the sync ledger on disk. A failed write leaves an outdated file behind,
/// so the failure is also recorded outside that file: the next launch then
/// re-uploads everything on the device instead of trusting the outdated ledger.
struct SyncLedgerFile {
    static let staleKey = "LingDaily.syncLedgerWriteFailed"

    let url: URL
    var defaults: UserDefaults = .standard

    /// True when an earlier write failed, so the saved ledger may be missing changes.
    var isStale: Bool { defaults.bool(forKey: Self.staleKey) }

    func load() -> SyncLedger {
        (try? Data(contentsOf: url)).flatMap { try? JSONDecoder().decode(SyncLedger.self, from: $0) } ?? SyncLedger()
    }

    /// Writes the ledger. A failure marks the file stale. A success clears that mark
    /// only when `current` is true, i.e. the saved ledger no longer needs a full resync.
    func save(_ ledger: SyncLedger, current: Bool = true) throws {
        do {
            let data = try JSONEncoder().encode(ledger)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            #if os(iOS)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
            #else
            try data.write(to: url, options: .atomic)
            #endif
        } catch {
            defaults.set(true, forKey: Self.staleKey)
            throw error
        }
        if current { defaults.removeObject(forKey: Self.staleKey) }
    }
}
