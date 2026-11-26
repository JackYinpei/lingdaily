import Combine
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var reminders: ReminderCenter
    @AppStorage(LearnerInterests.askedKey) private var interestsAsked = false
    @State private var showsInterests = false
    @State private var tab = 0

    var body: some View {
        Group {
            if #available(iOS 16.0, *) {
                NavigationStack { tabs }
            } else {
                NavigationView { tabs }.navigationViewStyle(.stack)
            }
        }
        .tint(Brand.accent)
        .accentColor(Brand.accent)
        .fullScreenCover(isPresented: $showsInterests) { InterestOnboardingView() }
        .onAppear {
            showsInterests = !interestsAsked
            #if DEBUG
            if !DebugLaunch.route.isEmpty { showsInterests = false }
            if DebugLaunch.opensLearning { tab = 2 }
            if DebugLaunch.opensPodcast { tab = 1 }
            #endif
        }
    }

    private var tabs: some View {
        TabView(selection: $tab) {
            PracticeHomeView()
                .tabItem { Label("练习", systemImage: "bubble.left.and.bubble.right") }.tag(0)
            PodcastTabView()
                .tabItem { Label("播客", systemImage: "headphones") }.tag(1)
            LearningView()
                .tabItem { Label("学习", systemImage: "book.closed") }.tag(2)
            SettingsView()
                .tabItem { Label("我的", systemImage: "person") }.tag(3)
        }
        // A tapped reminder opens its scenario from the practice page.
        .onReceive(reminders.$pendingScenarioID) { if $0 != nil { tab = 0 } }
        .navigationBarHidden(true)
        .safeAreaInset(edge: .top, spacing: 0) { StorageBanner() }
    }
}
