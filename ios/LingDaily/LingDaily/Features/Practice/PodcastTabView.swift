import SwiftUI

/// 播客: the daily podcast on a tab of its own (it used to be a card on the practice home):
/// listen, its eight terms, and a rehearsal about one story.
struct PodcastTabView: View {
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var today: TodayStore
    @ObservedObject private var player = PodcastPlayer.shared
    @State private var selectedScenario: PracticeScenario?
    @State private var showsVocabulary = false
    @State private var loaded = false

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 28) {
                    PageTitle(title: "播客")
                    if !account.canPractice {
                        VStack(alignment: .leading, spacing: 14) {
                            Text("登录后收听每日播客").font(.headline).foregroundColor(Brand.ink)
                            AppleSignInButton()
                        }.surfaceCard()
                    } else if let episode = today.episode {
                        TodayCard(episode: episode, player: player, onPractice: { selectedScenario = $0 },
                                  onVocabulary: { showsVocabulary = true })
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
        .pushDestination(isPresented: $showsVocabulary) {
            if let episode = today.episode { TodayVocabularyView(episode: episode) }
        }
        .task {
            if account.canPractice { await today.refresh() }
            loaded = true
            #if DEBUG
            if DebugLaunch.take("today-vocabulary"), today.episode != nil {
                // Programmatic pushes during the first layout are dropped.
                try? await Task.sleep(nanoseconds: 600_000_000)
                showsVocabulary = true
            }
            #endif
        }
    }
}
