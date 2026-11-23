import Combine
import Foundation

/// Built-in scenarios from the server, cached on the device. The four bundled ones are
/// the fallback, so the home page never starts empty, even offline on first launch.
@MainActor
final class ScenarioCatalogStore: ObservableObject {
    @Published private(set) var scenarios: [PracticeScenario]
    /// Interest tags and alternate cast by scenario id; empty for the bundled fallback.
    @Published private(set) var extras: [String: ScenarioExtras]
    private let file: URL
    private let extrasFile: URL
    private var refreshing = false
    private var refreshedAt: Date?

    init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        file = directory.appendingPathComponent("LingDailyExperience/scenario-catalog.json")
        extrasFile = directory.appendingPathComponent("LingDailyExperience/scenario-catalog-extras.json")
        let cached = (try? Data(contentsOf: file)).flatMap { try? JSONDecoder().decode([PracticeScenario].self, from: $0) }
        scenarios = cached?.isEmpty == false ? cached! : ScenarioLibrary.all
        let cachedExtras = (try? Data(contentsOf: extrasFile)).flatMap { try? JSONDecoder().decode([ScenarioExtras].self, from: $0) } ?? []
        extras = cached?.isEmpty == false ? Dictionary(cachedExtras.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first }) : [:]
    }

    func scenario(id: String) -> PracticeScenario? { scenarios.first { $0.id == id } }

    /// Who can play this scenario's partner; empty when there is no choice.
    func cast(for scenarioID: String) -> [PartnerCharacter] { extras[scenarioID]?.cast ?? [] }

    func refresh() async {
        // The server marks the catalog fresh for 10 minutes; launch and return-to-app both ask for it.
        if let refreshedAt, Date().timeIntervalSince(refreshedAt) < 600 { return }
        guard !refreshing else { return }
        refreshing = true
        defer { refreshing = false }
        guard let fresh = try? await PracticeAPIClient().scenarioCatalog() else { return }
        refreshedAt = Date()
        guard fresh.scenarios != scenarios || fresh.extras != extras else { return }
        scenarios = fresh.scenarios
        extras = fresh.extras
        try? FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        if let data = try? JSONEncoder().encode(fresh.scenarios) { try? data.write(to: file, options: .atomic) }
        if let data = try? JSONEncoder().encode(Array(fresh.extras.values)) { try? data.write(to: extrasFile, options: .atomic) }
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
