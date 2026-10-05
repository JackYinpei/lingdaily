import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var account: AccountStore
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("autoReadAIReplies") private var autoReadReplies = true

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    PageTitle(title: "我的")
                    if !account.usesLocalDevelopment { accountCard }
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 10) {
                            Text("外观").font(.subheadline).foregroundColor(Brand.ink)
                            Picker("外观", selection: $appearance) {
                                Text("跟随系统").tag("system")
                                Text("浅色").tag("light")
                                Text("深色").tag("dark")
                            }.pickerStyle(.segmented)
                        }
                        Brand.line.frame(height: 1)
                        Toggle("自动朗读对方的话", isOn: $autoReadReplies)
                            .font(.subheadline).foregroundColor(Brand.ink).tint(Brand.accent)
                    }.surfaceCard()
                    Text("LingDaily 体验版 0.3.0 · iOS 15+")
                        .font(.caption).foregroundColor(Brand.secondary).frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                .readableColumn()
            }
        }
    }

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let session = account.session {
                VStack(alignment: .leading, spacing: 4) {
                    Text("已登录").font(.subheadline).foregroundColor(Brand.ink)
                    Text(session.displayEmail).font(.caption).foregroundColor(Brand.secondary)
                }
                Brand.line.frame(height: 1)
                Button("退出登录", role: .destructive) { account.signOut() }
                    .font(.subheadline).frame(minHeight: 44)
            } else {
                Text("登录后才能和对方对话。练习记录仍只保存在这台设备。")
                    .font(.subheadline).foregroundColor(Brand.secondary)
                AppleSignInButton()
            }
        }.surfaceCard()
    }
}
