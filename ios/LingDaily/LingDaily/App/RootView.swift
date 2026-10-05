import SwiftUI

struct RootView: View {
    var body: some View {
        TabView {
            PracticeHomeView()
                .tabItem { Label("练习", systemImage: "bubble.left.and.bubble.right") }
            LearningView()
                .tabItem { Label("学习", systemImage: "book.closed") }
            SettingsView()
                .tabItem { Label("我的", systemImage: "person") }
        }
        .tint(Brand.accent)
        .accentColor(Brand.accent)
        .safeAreaInset(edge: .top, spacing: 0) { StorageBanner() }
    }
}
