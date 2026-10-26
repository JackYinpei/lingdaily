import Combine
import Foundation

/// Built-in scenarios from the server, cached on the device. The four bundled ones are
/// the fallback, so the home page never starts empty, even offline on first launch.
@MainActor
final class ScenarioCatalogStore: ObservableObject {
    @Published private(set) var scenarios: [PracticeScenario]
    private let file: URL
    private var refreshing = false

    init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = directory.appendingPathComponent("LingDailyExperience/scenario-catalog.json")
        let cached = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([PracticeScenario].self, from: $0) }
        scenarios = cached?.isEmpty == false ? cached! : ScenarioLibrary.all
    }

    func scenario(id: String) -> PracticeScenario? { scenarios.first { $0.id == id } }

    func refresh() async {
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        guard let fresh = try? await PracticeAPIClient().scenarioCatalog(), fresh != scenarios else { return }
        scenarios = fresh
        guard let data = try? JSONEncoder().encode(fresh) else { return }
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: file, options: .atomic)
    }
}

/// 「今日」: the latest daily podcast and its rehearsal. Kept in memory; refreshed on return to the app.
@MainActor
final class TodayStore: ObservableObject {
    @Published private(set) var episode: TodayEpisode?
    private var loadedAt: Date?
    private var refreshing = false

    func refresh(force: Bool = false) async {
        guard !refreshing else { return }
        // Within 10 minutes only a missing rehearsal is worth asking for again.
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 600, episode?.scenario != nil { return }
        refreshing = true
        defer { refreshing = false }
        do {
            episode = try await PracticeAPIClient().today()
            loadedAt = Date()
        } catch PracticeNetworkError.signedOut {
            episode = nil
        } catch {}
    }

    func clear() {
        episode = nil
        loadedAt = nil
    }
}
