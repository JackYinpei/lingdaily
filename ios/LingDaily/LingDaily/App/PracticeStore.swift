import SwiftUI
import Combine

/// A user-visible change to the local archive, recorded so cloud sync can upload it.
enum ArchiveChange {
    case session(UUID), sessionDeleted(UUID)
    case expression(String), expressionDeleted(String)
    case scenario(String), scenarioDeleted(String)
}

@MainActor
final class PracticeStore: ObservableObject {
    @Published private(set) var archive = PracticeArchive()
    @Published private(set) var storageError: String?
    /// Set by `SyncEngine`; called after each local edit (never for merged cloud data).
    var onChange: ((ArchiveChange) -> Void)?
    private let file: ArchiveFile
    private(set) var canWrite = true

    init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = ArchiveFile(url: directory.appendingPathComponent("LingDailyExperience/archive-v1.json"))
        do { archive = try file.load() }
        catch {
            canWrite = false
            storageError = "本机记录暂时无法读取。原文件已保留，本次体验不会覆盖它。"
        }
    }

    func save(_ session: PracticeSession, collecting items: [AILearningItem] = []) {
        let knownExpressions = Set(archive.expressions.map(\.id))
        archive.upsert(session)
        archive.collect(items, source: session.scenario.title)
        persist()
        if archive.sessions.contains(where: { $0.id == session.id }) { onChange?(.session(session.id)) }
        for item in archive.expressions where !knownExpressions.contains(item.id) { onChange?(.expression(item.id)) }
    }

    func addScenario(_ scenario: PracticeScenario) {
        archive.scenarios.insert(scenario, at: 0)
        persist()
        onChange?(.scenario(scenario.id))
    }

    func removeScenario(_ id: String) {
        archive.scenarios.removeAll { $0.id == id }
        persist()
        onChange?(.scenarioDeleted(id))
    }

    func removeSession(_ id: UUID) {
        archive.sessions.removeAll { $0.id == id }
        persist()
        onChange?(.sessionDeleted(id))
    }

    func isSaved(_ text: String) -> Bool {
        archive.expressions.contains { $0.id == SavedExpression.key(text) }
    }

    func toggleExpression(_ text: String, meaning: String, source: String) {
        archive.toggleExpression(text: text, meaning: meaning, source: source)
        persist()
        let key = SavedExpression.key(text)
        onChange?(isSaved(text) ? .expression(key) : .expressionDeleted(key))
    }

    func removeExpression(_ id: String) {
        archive.expressions.removeAll { $0.id == id }
        persist()
        onChange?(.expressionDeleted(id))
    }

    /// Replaces local data with the merged cloud copy; not reported as a local edit.
    func replaceArchive(_ merged: PracticeArchive) {
        guard canWrite, merged != archive else { return }
        archive = merged
        persist()
    }

    /// Removes this account's data from the device (sign-out or account deletion).
    func clearAll() {
        archive = PracticeArchive()
        persist()
    }

    func retrySave() { persist() }

    private func persist() {
        guard canWrite else { return }
        do {
            try file.save(archive)
            storageError = nil
        } catch {
            storageError = "还没有保存到本机，请重试。退出 App 前请保留本次内容。"
        }
    }
}
