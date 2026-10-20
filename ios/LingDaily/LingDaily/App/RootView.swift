import Combine
import SwiftUI

struct RootView: View {
    @EnvironmentObject private var account: AccountStore
    @State private var showsAIConsent = false
    var body: some View {
        NavigationView {
            TabView {
                PracticeHomeView()
                    .tabItem { Label("练习", systemImage: "bubble.left.and.bubble.right") }
                LearningView()
                    .tabItem { Label("学习", systemImage: "book.closed") }
                SettingsView()
                    .tabItem { Label("我的", systemImage: "person") }
            }
            .navigationBarHidden(true)
            .safeAreaInset(edge: .top, spacing: 0) { StorageBanner() }
        }
        .navigationViewStyle(.stack)
        .tint(Brand.accent)
        .accentColor(Brand.accent)
        .sheet(isPresented: $showsAIConsent) { AIDataConsentView() }
        .onAppear { offerAIConsent() }
        .onChange(of: account.canPractice) { _ in offerAIConsent() }
        .onReceive(NotificationCenter.default.publisher(for: AIDataConsent.requested).receive(on: RunLoop.main)) { _ in
            showsAIConsent = true
        }
    }

    private func offerAIConsent() {
        if account.canPractice && !AIDataConsent.isGranted() { showsAIConsent = true }
    }
}
