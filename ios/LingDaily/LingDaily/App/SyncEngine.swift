import Combine
import Foundation

/// Posted by the Live call screen when a call starts and when it ends.
enum LiveCallActivity {
    static let changed = Notification.Name("LingDaily.liveCallActivityChanged")
    static let isActiveKey = "isActive"

    /// Owned by one call controller. Also reports the end if the controller goes away mid-call,
    /// so sync can never stay on hold.
    final class Marker {
        var isActive = false {
            didSet { if isActive != oldValue { Self.post(isActive) } }
        }
        deinit { if isActive { Self.post(false) } }
        private static func post(_ active: Bool) {
            NotificationCenter.default.post(name: LiveCallActivity.changed, object: nil, userInfo: [LiveCallActivity.isActiveKey: active])
        }
    }
}

/// Keeps the local archive and the signed-in account's cloud copy in step.
/// Local edits are recorded immediately and uploaded a few seconds later;
/// the device also pulls when the account signs in and when the app returns.
/// During a Live call nothing is uploaded (the call's audio needs the bandwidth);
/// edits made during the call go out right after hang-up.
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
    private var liveCall: AnyCancellable?
    private var inLiveCall = false
    private var deferredDuringCall = false
    /// Bumped by every local edit; a sync that started before an edit runs once more.
    private var changeCount = 0
    private var changeCountAtStart = 0

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
        liveCall = NotificationCenter.default.publisher(for: LiveCallActivity.changed).sink { [weak self] note in
            let active = note.userInfo?[LiveCallActivity.isActiveKey] as? Bool ?? false
            Task { @MainActor in self?.liveCallChanged(active: active) }
        }
    }

    private func liveCallChanged(active: Bool) {
        guard active != inLiveCall else { return }
        inLiveCall = active
        guard !active, deferredDuringCall else { return }
        deferredDuringCall = false
        Task { _ = await syncNow() }
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
        changeCount &+= 1
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
        if inLiveCall {
            deferredDuringCall = true
            return false
        }
        if let running {
            // Only edits made after the running sync collected its changes need another round;
            // a caller that just wants fresh cloud data gets it from the running one.
            if changeCount != changeCountAtStart { again = true }
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

    /// Uploads in rounds until nothing fits the remaining pending changes, or a round makes no progress.
    private func performSync() async -> Bool {
        changeCountAtStart = changeCount
        var pending = Int.max
        for _ in 0..<50 {
            guard let clean = await performRound() else { return false }
            if clean || ledger.pendingCount >= pending { return clean }
            pending = ledger.pendingCount
        }
        return ledger.pendingCount == 0
    }

    /// One request. Nil when it failed.
    private func performRound() async -> Bool? {
        guard let session = account.session, store.canWrite else { return nil }
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
            guard account.session?.userID == session.userID else { return nil }
            var merged = store.archive
            ledger.merge(snapshot, sent: changes, into: &merged)
            store.replaceArchive(merged)
            saveLedger()
            lastSyncedAt = ledger.lastSyncedAt
            status = .idle
            return ledger.pendingCount == 0
        } catch {
            status = account.session == nil ? .idle : .failed(error.localizedDescription)
            return nil
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
