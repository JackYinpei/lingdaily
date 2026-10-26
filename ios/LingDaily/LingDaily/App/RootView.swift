import Combine
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var reminders: ReminderCenter
    @State private var showsAIConsent = false
    @State private var tab = 0
    var body: some View {
        NavigationView {
            TabView(selection: $tab) {
                PracticeHomeView()
                    .tabItem { Label("练习", systemImage: "bubble.left.and.bubble.right") }.tag(0)
                LearningView()
                    .tabItem { Label("学习", systemImage: "book.closed") }.tag(1)
                SettingsView()
                    .tabItem { Label("我的", systemImage: "person") }.tag(2)
            }
            // A tapped reminder opens its scenario from the practice page.
            .onReceive(reminders.$pendingScenarioID) { if $0 != nil { tab = 0 } }
            .navigationBarHidden(true)
            .safeAreaInset(edge: .top, spacing: 0) { StorageBanner() }
        }
        .navigationViewStyle(.stack)
        .tint(Brand.accent)
        .accentColor(Brand.accent)
        .sheet(isPresented: $showsAIConsent) { AIDataConsentView() }
        .onAppear {
            offerAIConsent()
            #if DEBUG
            if DebugLaunch.opensLearning { tab = 1 }
            #endif
        }
        .onChange(of: account.canPractice) { _ in offerAIConsent() }
        .onReceive(NotificationCenter.default.publisher(for: AIDataConsent.requested).receive(on: RunLoop.main)) { _ in
            showsAIConsent = true
        }
    }

    private func offerAIConsent() {
        if account.canPractice && !AIDataConsent.isGranted() { showsAIConsent = true }
    }
}
