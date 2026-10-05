import Combine
import Foundation

/// Keeps the local archive and the signed-in account's cloud copy in step.
/// Local edits are recorded immediately and uploaded a few seconds later;
/// the device also pulls when the account signs in and when the app returns.
@MainActor
final class SyncEngine: ObservableObject {
    enum Status: Equatable { case idle, syncing, failed(String) }

    @Published private(set) var status: Status = .idle
    @Published private(set) var lastSyncedAt: Date?
    private let store: PracticeStore
    private let account: AccountStore
    private let file: URL
    private var ledger: SyncLedger
    private var running: Task<Bool, Never>?
    private var again = false
    private var debounce: Task<Void, Never>?
    private var signedIn: AnyCancellable?

    init(store: PracticeStore, account: AccountStore) {
        self.store = store
        self.account = account
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = directory.appendingPathComponent("LingDailyExperience/sync-ledger.json")
        ledger = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode(SyncLedger.self, from: $0) } ?? SyncLedger()
        lastSyncedAt = ledger.lastSyncedAt
        store.onChange = { [weak self] change in self?.record(change) }
        signedIn = account.$session.removeDuplicates().sink { [weak self] session in
            guard session != nil else { return }
            Task { @MainActor in _ = await self?.syncNow() }
        }
    }

    var isEnabled: Bool { !account.usesLocalDevelopment && account.session != nil }
    var pendingCount: Int { ledger.pendingCount }

    func record(_ change: ArchiveChange) {
        switch change {
        case .session(let id): ledger.sessionChanged(id)
        case .sessionDeleted(let id): ledger.sessionDeleted(id)
        case .expression(let key): ledger.expressionChanged(key)
        case .expressionDeleted(let key): ledger.expressionDeleted(key)
        case .scenario(let id): ledger.scenarioChanged(id)
        case .scenarioDeleted(let id): ledger.scenarioDeleted(id)
        }
        saveLedger()
        debounce?.cancel()
        debounce = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            _ = await self?.syncNow()
        }
    }

    /// Runs one sync (or joins the running one). Returns true when nothing is left to upload.
    @discardableResult
    func syncNow() async -> Bool {
        guard isEnabled else { return false }
        if let running {
            again = true
            return await running.value
        }
        let task = Task { [weak self] () -> Bool in
            guard let self else { return false }
            var clean = await self.performSync()
            while self.again && clean {
                self.again = false
                clean = await self.performSync()
            }
            return clean
        }
        running = task
        let result = await task.value
        running = nil
        again = false
        return result
    }

    private func performSync() async -> Bool {
        guard let session = account.session, store.canWrite else { return false }
        if ledger.ownerUserID != session.userID {
            if ledger.ownerUserID != nil {
                // Data on this device belongs to another account: never upload it into this one.
                store.clearAll()
                ledger = SyncLedger(ownerUserID: session.userID)
            } else {
                ledger.adopt(owner: session.userID, archive: store.archive)
            }
            saveLedger()
        }
        status = .syncing
        let changes = ledger.changes(from: store.archive)
        do {
            let snapshot = try await PracticeAPIClient(configuration: nil).sync(changes)
            guard account.session?.userID == session.userID else { return false }
            var merged = store.archive
            ledger.merge(snapshot, sent: changes, into: &merged)
            store.replaceArchive(merged)
            saveLedger()
            lastSyncedAt = ledger.lastSyncedAt
            status = .idle
            return ledger.pendingCount == 0
        } catch {
            status = account.session == nil ? .idle : .failed(error.localizedDescription)
            return false
        }
    }

    /// Uploads what is left before signing out. True when the device holds nothing unsynced.
    func flushBeforeSignOut() async -> Bool {
        guard isEnabled else { return true }
        return await syncNow()
    }

    /// Forgets this device's account data after sign-out or account deletion.
    func resetLocalData() {
        debounce?.cancel()
        store.clearAll()
        ledger = SyncLedger()
        lastSyncedAt = nil
        status = .idle
        saveLedger()
    }

    private func saveLedger() {
        guard let data = try? JSONEncoder().encode(ledger) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        #if os(iOS)
        try? data.write(to: file, options: [.atomic, .completeFileProtectionUnlessOpen])
        #else
        try? data.write(to: file, options: .atomic)
        #endif
    }
}
