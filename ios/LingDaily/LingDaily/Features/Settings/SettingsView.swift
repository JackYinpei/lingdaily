import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var sync: SyncEngine
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("autoReadAIReplies") private var autoReadReplies = true
    @State private var signingOut = false
    @State private var unsyncedOnSignOut = false
    @State private var confirmingDeletion = false

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
                    if account.session != nil && !account.usesLocalDevelopment {
                        Button("删除账号") { confirmingDeletion = true }
                            .font(.subheadline).foregroundColor(Brand.accent)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .accessibilityIdentifier("delete-account")
                    }
                    Text("LingDaily 体验版 0.3.0 · iOS 15+")
                        .font(.caption).foregroundColor(Brand.secondary).frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                .readableColumn()
            }
        }
        .alert("还有内容没同步", isPresented: $unsyncedOnSignOut) {
            Button("仍然退出", role: .destructive) { finishSignOut() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("有 \(sync.pendingCount) 项改动还没上传到账号。退出会移除本机记录，这些改动会丢失。")
        }
        .sheet(isPresented: $confirmingDeletion) { DeleteAccountSheet() }
    }

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let session = account.session {
                VStack(alignment: .leading, spacing: 4) {
                    Text(session.displayEmail).font(.subheadline).foregroundColor(Brand.ink)
                    Text(syncDescription).font(.caption)
                        .foregroundColor(isSyncFailed ? Brand.accent : Brand.secondary)
                }
                if isSyncFailed {
                    Button("重新同步") { Task { await sync.syncNow() } }
                        .font(.subheadline).foregroundColor(Brand.ink).frame(minHeight: 44)
                }
                Brand.line.frame(height: 1)
                Button(signingOut ? "正在同步…" : "退出登录") { signOut() }
                    .font(.subheadline).foregroundColor(Brand.ink).frame(minHeight: 44)
                    .disabled(signingOut)
            } else {
                Text("登录后才能和对方对话。练习记录、词库和自建场景会同步到你的账号，网页版用同一个账号也能看到。")
                    .font(.subheadline).foregroundColor(Brand.secondary)
                AppleSignInButton()
            }
        }.surfaceCard()
    }

    private var isSyncFailed: Bool {
        if case .failed = sync.status { return true }
        return false
    }

    private var syncDescription: String {
        switch sync.status {
        case .syncing: return "正在同步…"
        case .failed(let message): return message
        case .idle:
            guard let date = sync.lastSyncedAt else { return "尚未同步" }
            return "已同步 · \(Self.timeFormatter.localizedString(for: date, relativeTo: Date()))"
        }
    }

    private func signOut() {
        signingOut = true
        Task {
            let clean = await sync.flushBeforeSignOut()
            signingOut = false
            if clean { finishSignOut() } else { unsyncedOnSignOut = true }
        }
    }

    /// Signing out removes this account's records from the device; they come back from the cloud on sign-in.
    private func finishSignOut() {
        sync.resetLocalData()
        account.signOut()
    }

    private static let timeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .short
        return formatter
    }()
}

/// Account deletion (App Store Review Guideline 5.1.1(v)): explain, then confirm with Apple.
private struct DeleteAccountSheet: View {
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var sync: SyncEngine
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var deleting = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            PageBackground()
            VStack(alignment: .leading, spacing: 20) {
                Text("删除账号").font(.title2.bold()).foregroundColor(Brand.ink)
                Text("将永久删除这个 LingDaily 账号，以及它在云端和这台设备上的全部练习记录、词库和自建场景。网页版使用的是同一个账号，网页上的对话和生词也会一起删除。此操作无法撤销。")
                    .font(.subheadline).foregroundColor(Brand.secondary).lineSpacing(4)
                Text("请用 Apple 再确认一次身份。")
                    .font(.subheadline).foregroundColor(Brand.ink)
                Spacer(minLength: 0)
                if let errorMessage {
                    Text(errorMessage).font(.caption).foregroundColor(Brand.accent)
                }
                SignInWithAppleButton(.continue) { account.prepare($0) } onCompletion: { result in
                    deleting = true
                    errorMessage = nil
                    Task {
                        do {
                            try await account.confirmDeletion(result)
                            sync.resetLocalData()
                            dismiss()
                        } catch is CancellationError {
                        } catch {
                            errorMessage = error.localizedDescription
                        }
                        deleting = false
                    }
                }
                .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
                .frame(height: 50).clipShape(Capsule())
                .disabled(deleting).opacity(deleting ? 0.6 : 1)
                .accessibilityIdentifier("confirm-delete-account")
                Button("取消") { dismiss() }
                    .font(.subheadline).foregroundColor(Brand.ink)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .disabled(deleting)
            }
            .padding(24)
            .readableColumn()
        }
        .interactiveDismissDisabled(deleting)
    }
}
