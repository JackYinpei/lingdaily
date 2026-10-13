import SwiftUI

struct RootView: View {
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
    }
}
