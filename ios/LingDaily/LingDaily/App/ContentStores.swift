import Combine
import Foundation

/// Built-in scenarios from the server, cached on the device. Bundled `ScenarioCatalog.json`
/// (all 25 scenarios with tags & cast) loads on first launch before `ScenarioLibrary.all`.
@MainActor
final class ScenarioCatalogStore: ObservableObject {
    @Published private(set) var scenarios: [PracticeScenario]
    /// Interest tags and alternate cast by scenario id.
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
        if let cached, !cached.isEmpty {
            scenarios = cached
            let cachedExtras = (try? Data(contentsOf: extrasFile)).flatMap { try? JSONDecoder().decode([ScenarioExtras].self, from: $0) } ?? []
            extras = Dictionary(cachedExtras.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        } else if let bundled = Self.loadBundledCatalog() {
            scenarios = bundled.scenarios
            extras = bundled.extras
        } else {
            scenarios = ScenarioLibrary.all
            extras = [:]
        }
    }

    private static func loadBundledCatalog() -> (scenarios: [PracticeScenario], extras: [String: ScenarioExtras])? {
        guard let url = Bundle.main.url(forResource: "ScenarioCatalog", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let decoded = try? JSONDecoder().decode(ScenarioCatalogResponse.self, from: data),
              !decoded.validScenarios.isEmpty else {
            return nil
        }
        return (decoded.validScenarios, decoded.validExtras)
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

/// Public daily bilingual news podcasts (`GET /api/ios/podcasts`), plus in-memory cached
/// BYOK news practice scenarios keyed by episode date.
@MainActor
final class TodayStore: ObservableObject {
    @Published private(set) var episodes: [TodayEpisode] = []
    @Published private(set) var generatedScenarios: [String: PracticeScenario] = [:]
    private var loadedAt: Date?
    private var refreshing = false

    var episode: TodayEpisode? { episodes.first }

    func scenario(for date: String) -> PracticeScenario? {
        generatedScenarios[date]
    }

    func cacheScenario(_ scenario: PracticeScenario, for date: String) {
        generatedScenarios[date] = scenario
    }

    func refresh(force: Bool = false) async {
        guard !refreshing else { return }
        if !force, let loadedAt, Date().timeIntervalSince(loadedAt) < 300, !episodes.isEmpty { return }
        refreshing = true
        defer { refreshing = false }
        do {
            episodes = try await PracticeAPIClient().podcasts()
            loadedAt = Date()
        } catch {}
    }
}
