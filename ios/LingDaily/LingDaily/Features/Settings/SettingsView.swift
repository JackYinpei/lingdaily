import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var aiSettings: AISettingsStore
    @EnvironmentObject private var sync: SyncEngine
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("autoReadAIReplies") private var autoReadReplies = true
    @AppStorage(SpeechController.slowKey) private var slowSpeech = false
    @AppStorage(ReviewPicker.enabledKey) private var reviewWords = true
    @AppStorage(LivePause.key) private var pauseMs = LivePause.standard
    @State private var signingOut = false
    @State private var unsyncedOnSignOut = false
    @State private var showingAccountData = false
    @State private var showingAPISettings = false
    @State private var editingInterests = false
    @AppStorage(LearnerInterests.key) private var interestsRaw = ""

    /// The picked labels, or what choosing does.
    private var interestSummary: String {
        let picks = Set(LearnerInterests.picks(from: interestsRaw))
        let labels = (LearnerInterest.goals + LearnerInterest.fears).filter { picks.contains($0.id) }.map(\.label)
        return labels.isEmpty ? "选一选你想练的场合，首页按它排序" : labels.joined(separator: " · ")
    }

    private var apiSummary: String {
        guard let resolved = aiSettings.settings.resolvedText else {
            return "未配置 · 点击填入 API Key"
        }
        return "\(resolved.provider.title)\n文字 \(resolved.config.textModel) · 语音 \(resolved.config.liveModel)"
    }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 28) {
                    PageTitle(title: "我的")

                    Button { showingAPISettings = true } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("接口设置").font(.headline).foregroundColor(Brand.ink)
                                Text(apiSummary)
                                    .font(.caption)
                                    .foregroundColor(aiSettings.settings.isAnyConfigured ? Brand.secondary : Brand.accent)
                                    .lineSpacing(3)
                                    .multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right")
                                .font(.footnote.weight(.semibold))
                                .foregroundColor(Brand.secondary)
                        }
                        .frame(minHeight: 48)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .surfaceCard()
                    .accessibilityIdentifier("api-settings")

                    accountCard

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
                        Brand.line.frame(height: 1)
                        Toggle("放慢朗读", isOn: $slowSpeech)
                            .font(.subheadline).foregroundColor(Brand.ink).tint(Brand.accent)
                        Brand.line.frame(height: 1)
                        Toggle("练习时带上词库里的词", isOn: $reviewWords)
                            .font(.subheadline).foregroundColor(Brand.ink).tint(Brand.accent)
                            .accessibilityIdentifier("review-words-toggle")
                        Brand.line.frame(height: 1)
                        HStack {
                            Text("停顿多久算说完").font(.subheadline).foregroundColor(Brand.ink)
                            Spacer(minLength: 8)
                            Picker("停顿多久算说完", selection: $pauseMs) {
                                ForEach(LivePause.options, id: \.self) { Text(LivePause.label($0)).tag($0) }
                            }
                            .pickerStyle(.menu).tint(Brand.secondary)
                            .accessibilityIdentifier("live-pause")
                        }
                    }.surfaceCard()

                    Button { editingInterests = true } label: {
                        HStack(spacing: 12) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("练习偏好").font(.subheadline).foregroundColor(Brand.ink)
                                Text(interestSummary).font(.caption).foregroundColor(Brand.secondary).lineLimit(2)
                            }
                            Spacer(minLength: 8)
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(Brand.secondary)
                        }.frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain).surfaceCard()
                    .accessibilityIdentifier("edit-interests")

                    ReminderCard()

                    VStack(alignment: .leading, spacing: 12) {
                        Link("隐私政策", destination: LingDailyService.baseURL.appendingPathComponent("privacy"))
                            .frame(minHeight: 44)
                        Brand.line.frame(height: 1)
                        Link("帮助与联系", destination: LingDailyService.baseURL.appendingPathComponent("support"))
                            .frame(minHeight: 44)
                    }.font(.subheadline).foregroundColor(Brand.ink).surfaceCard()

                    Text("LingDaily \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
                        .font(.caption).foregroundColor(Brand.secondary).frame(maxWidth: .infinity)
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                .readableColumn()
            }
        }
        .pushDestination(isPresented: $showingAPISettings) { APISettingsView() }
        .pushDestination(isPresented: $editingInterests) { InterestOnboardingView(editing: true) }
        .alert("还有内容没同步", isPresented: $unsyncedOnSignOut) {
            Button("仍然退出", role: .destructive) { finishSignOut() }
            Button("取消", role: .cancel) {}
        } message: {
            Text("有 \(sync.pendingCount) 项改动还没上传到账号。退出会移除本机记录与接口设置，这些改动会丢失。")
        }
        .pushDestination(isPresented: $showingAccountData) { AccountDataView() }
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
                Brand.line.frame(height: 1)
                // Account deletion (App Store 5.1.1(v)) lives one level down, in 账号与数据.
                Button { showingAccountData = true } label: {
                    HStack {
                        Text("账号与数据").font(.subheadline).foregroundColor(Brand.ink)
                        Spacer()
                        Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundColor(Brand.secondary)
                    }.frame(minHeight: 44).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("account-data")
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Text("云同步（可选）").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Text("登录后可在多台设备间同步练习记录、词库、自建场景及加密保存的接口设置。不登录也可在本机完整使用。")
                        .font(.caption).foregroundColor(Brand.secondary).lineSpacing(3)
                }
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
        sync.forgetAccountData()
        account.signOut()
    }

    private static let timeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .short
        return formatter
    }()
}

/// 账号与数据: where the learner's data lives, and account deletion (App Store 5.1.1(v)).
private struct AccountDataView: View {
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var sync: SyncEngine
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var showsDeletion = false
    @State private var deleting = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(account.session?.displayEmail ?? "").font(.subheadline).foregroundColor(Brand.ink)
                        .frame(maxWidth: .infinity, alignment: .leading).surfaceCard()
                    if showsDeletion { deletion } else {
                        Button("删除账号") { showsDeletion = true }
                            .font(.footnote).foregroundColor(Brand.secondary)
                            .frame(maxWidth: .infinity, minHeight: 44)
                            .accessibilityIdentifier("delete-account")
                    }
                }
                .padding(24).readableColumn()
            }
        }
        .navigationBack(title: "账号与数据", isEnabled: !deleting) { dismiss() }
    }

    private var deletion: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("删除账号").font(.headline).foregroundColor(Brand.ink)
            Text("账号和全部练习记录、词库、自建场景及云端接口设置（含网页版）将永久删除，无法撤销。")
                .font(.subheadline).foregroundColor(Brand.secondary).lineSpacing(4)
            if let errorMessage {
                Text(errorMessage).font(.caption).foregroundColor(Brand.accent)
            }
            SignInWithAppleButton(.continue) { account.prepare($0) } onCompletion: { result in
                deleting = true
                errorMessage = nil
                Task {
                    do {
                        try await account.confirmDeletion(result)
                        sync.forgetAccountData()
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
            Button("不删了") { showsDeletion = false }
                .font(.subheadline).foregroundColor(Brand.ink)
                .frame(maxWidth: .infinity, minHeight: 44)
                .disabled(deleting)
        }.surfaceCard()
    }
}

/// Opt-in daily reminder. Days with practice are skipped; permission is asked only when it is turned on.
private struct ReminderCard: View {
    @EnvironmentObject private var store: PracticeStore
    @AppStorage(ReminderCenter.dailyEnabledKey) private var enabled = false
    @AppStorage(ReminderCenter.dailyHourKey) private var hour = 21
    @AppStorage(ReminderCenter.dailyMinuteKey) private var minute = 0
    @State private var denied = false

    private var time: Binding<Date> {
        Binding(get: { Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: Date()) ?? Date() },
                set: { value in
                    hour = Calendar.current.component(.hour, from: value)
                    minute = Calendar.current.component(.minute, from: value)
                    reschedule()
                })
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Toggle("每天提醒我练习", isOn: Binding(get: { enabled }, set: { turnOn in
                guard turnOn else { enabled = false; reschedule(); return }
                Task {
                    denied = !(await ReminderCenter.shared.requestPermission())
                    enabled = !denied
                    reschedule()
                }
            }))
            .font(.subheadline).foregroundColor(Brand.ink).tint(Brand.accent)
            .accessibilityIdentifier("daily-reminder")
            if enabled {
                DatePicker("提醒时间", selection: time, displayedComponents: .hourAndMinute)
                    .font(.subheadline).foregroundColor(Brand.ink).tint(Brand.accent)
                Text("当天已经练过就不再提醒。").font(.caption).foregroundColor(Brand.secondary)
            }
            if denied {
                Text("通知没有打开，可以在系统设置里允许 LingDaily 发送通知。").font(.caption).foregroundColor(Brand.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .surfaceCard()
    }

    private func reschedule() {
        ReminderCenter.shared.rescheduleDaily(practicedToday: PracticeStats.spokeToday(store.archive.sessions))
    }
}
