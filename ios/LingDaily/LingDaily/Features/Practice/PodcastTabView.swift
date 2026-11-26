import SwiftUI

/// 播客: public daily bilingual news podcast, past episodes ("往期"), eight terms per episode,
/// and an optional BYOK spoken rehearsal ("聊聊这期内容").
struct PodcastTabView: View {
    @EnvironmentObject private var aiSettings: AISettingsStore
    @EnvironmentObject private var today: TodayStore
    @Environment(\.practiceService) private var api
    @ObservedObject private var player = PodcastPlayer.shared
    @State private var selectedScenario: PracticeScenario?
    @State private var vocabularyEpisode: TodayEpisode?
    @State private var showingAPISettings = false
    @State private var generatingDate: String?
    @State private var generationError: String?
    @State private var loaded = false

    private var pastEpisodes: [TodayEpisode] {
        Array(today.episodes.dropFirst())
    }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 28) {
                    PageTitle(title: "播客")
                    if let episode = today.episode {
                        TodayCard(
                            episode: episode,
                            player: player,
                            cachedScenario: today.scenario(for: episode.date) ?? episode.practiceScenario,
                            isGeneratingScenario: generatingDate == episode.date,
                            isTextAIConfigured: aiSettings.settings.resolvedText != nil,
                            scenarioError: generationError,
                            onDiscuss: { discuss(episode) },
                            onVocabulary: { vocabularyEpisode = episode }
                        )
                        if !pastEpisodes.isEmpty {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("往期").font(.subheadline.weight(.semibold)).foregroundColor(Brand.secondary)
                                ForEach(pastEpisodes) { item in
                                    PastEpisodeCard(
                                        episode: item,
                                        player: player,
                                        onVocabulary: { vocabularyEpisode = item }
                                    )
                                }
                            }
                        }
                    } else if loaded {
                        Text("最近还没有新的播客。").font(.subheadline).foregroundColor(Brand.secondary)
                    } else {
                        ProgressView().frame(maxWidth: .infinity, minHeight: 44)
                    }
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                .readableColumn()
            }
        }
        .pushDestination(item: $selectedScenario) { PreparationFlowView(scenario: $0) }
        .pushDestination(item: $vocabularyEpisode) { TodayVocabularyView(episode: $0) }
        .pushDestination(isPresented: $showingAPISettings) { APISettingsView() }
        .task {
            await today.refresh()
            loaded = true
            #if DEBUG
            if DebugLaunch.take("today-vocabulary"), let first = today.episode {
                // Programmatic pushes during the first layout are dropped.
                try? await Task.sleep(nanoseconds: 600_000_000)
                vocabularyEpisode = first
            }
            #endif
        }
    }

    private func discuss(_ episode: TodayEpisode) {
        generationError = nil
        if let cached = today.scenario(for: episode.date) ?? episode.practiceScenario {
            selectedScenario = cached
            return
        }
        guard aiSettings.settings.resolvedText != nil else {
            showingAPISettings = true
            return
        }
        guard generatingDate == nil else { return }
        generatingDate = episode.date
        Task {
            defer { generatingDate = nil }
            do {
                let scenario = try await api.createNewsScenario(from: episode)
                today.cacheScenario(scenario, for: episode.date)
                selectedScenario = scenario
            } catch is CancellationError {
            } catch {
                generationError = error.localizedDescription
            }
        }
    }
}
