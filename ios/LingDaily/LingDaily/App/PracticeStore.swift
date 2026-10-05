import SwiftUI
import Combine

@MainActor
final class PracticeStore: ObservableObject {
    @Published private(set) var archive = PracticeArchive()
    @Published private(set) var storageError: String?
    private let file: ArchiveFile
    private var canWrite = true

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
        archive.upsert(session)
        archive.collect(items, source: session.scenario.title)
        persist()
    }

    func addScenario(_ scenario: PracticeScenario) {
        archive.scenarios.insert(scenario, at: 0)
        persist()
    }

    func removeScenario(_ id: String) {
        archive.scenarios.removeAll { $0.id == id }
        persist()
    }

    func removeSession(_ id: UUID) {
        archive.sessions.removeAll { $0.id == id }
        persist()
    }

    func isSaved(_ text: String) -> Bool {
        archive.expressions.contains { $0.id == SavedExpression.key(text) }
    }

    func toggleExpression(_ text: String, meaning: String, source: String) {
        archive.toggleExpression(text: text, meaning: meaning, source: source)
        persist()
    }

    func removeExpression(_ id: String) {
        archive.expressions.removeAll { $0.id == id }
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
