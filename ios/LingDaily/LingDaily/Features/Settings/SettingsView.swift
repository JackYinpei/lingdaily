import AuthenticationServices
import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var sync: SyncEngine
    @AppStorage("appearance") private var appearance = "system"
    @AppStorage("autoReadAIReplies") private var autoReadReplies = true
    @AppStorage(SpeechController.slowKey) private var slowSpeech = false
    @AppStorage(ReviewPicker.enabledKey) private var reviewWords = true
    @AppStorage(LivePause.key) private var pauseMs = LivePause.standard
    @AppStorage(AIDataConsent.key) private var aiConsentVersion = ""
    @State private var signingOut = false
    @State private var unsyncedOnSignOut = false
    @State private var showingAccountData = false

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
                    ReminderCard()
                    if account.canPractice { AIModelCard() }
                    if account.session != nil && !account.usesLocalDevelopment { UsageCard() }
                    VStack(alignment: .leading, spacing: 12) {
                        Link("隐私政策", destination: LingDailyService.baseURL.appendingPathComponent("privacy"))
                            .frame(minHeight: 44)
                        Brand.line.frame(height: 1)
                        Link("帮助与联系", destination: LingDailyService.baseURL.appendingPathComponent("support"))
                            .frame(minHeight: 44)
                        Brand.line.frame(height: 1)
                        if aiConsentVersion == AIDataConsent.version {
                            Button("撤回 AI 数据使用授权") { AIDataConsent.revoke() }
                                .frame(minHeight: 44)
                        } else {
                            Button("AI 数据使用") {
                                NotificationCenter.default.post(name: AIDataConsent.requested, object: nil)
                            }.frame(minHeight: 44)
                        }
                    }.font(.subheadline).foregroundColor(Brand.ink).surfaceCard()
                    Text("LingDaily \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
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
        ReminderCenter.shared.clearAll()
        ReviewLog.clear()
        account.signOut()
    }

    private static let timeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.unitsStyle = .short
        return formatter
    }()
}

/// 账号与数据: where the learner's data lives, and — one step further — account
/// deletion (App Store Review Guideline 5.1.1(v)): explain, then confirm with Apple.
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
            Text("账号和全部练习记录、词库、自建场景（含网页版）将永久删除，无法撤销。")
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
                        sync.resetLocalData()
                        ReminderCenter.shared.clearAll()
                        ReviewLog.clear()
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

/// Lets the learner pick a model per feature from the server's allowed list.
/// The choice is stored on this device; empty means the server default.
private struct AIModelCard: View {
    @State private var catalog: AIModelCatalog?
    @State private var failed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("AI 模型").font(.subheadline).foregroundColor(Brand.ink)
            if let catalog {
                ForEach(AIModelFeature.allCases) { feature in
                    if feature != AIModelFeature.allCases.first { Brand.line.frame(height: 1) }
                    ModelRow(feature: feature, options: catalog.feature(feature))
                }
            } else if failed {
                Button("加载失败，点此重试") { Task { await load() } }
                    .font(.caption).foregroundColor(Brand.secondary).frame(minHeight: 44)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .surfaceCard()
        .task { if catalog == nil { await load() } }
    }

    private func load() async {
        failed = false
        do { catalog = try await PracticeAPIClient().modelCatalog() } catch { failed = true }
    }
}

private struct ModelRow: View {
    let feature: AIModelFeature
    let options: AIModelCatalog.Feature
    @AppStorage private var selection: String

    init(feature: AIModelFeature, options: AIModelCatalog.Feature) {
        self.feature = feature
        self.options = options
        _selection = AppStorage(wrappedValue: "", AIModelPreference.key(feature))
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text(feature.title).font(.subheadline).foregroundColor(Brand.ink)
            Spacer(minLength: 8)
            Picker(feature.title, selection: $selection) {
                Text("默认（\(options.default)）").tag("")
                ForEach(options.choices.filter { $0.id != options.default }, id: \.id) { choice in
                    Text("\(choice.id) · \(choice.note)").tag(choice.id)
                }
            }
            .pickerStyle(.menu).tint(Brand.secondary).font(.caption)
            .accessibilityIdentifier("model-\(feature.rawValue)")
        }
        .frame(minHeight: 44)
    }
}

/// The learner's own AI token usage over the last 30 days (no prices).
private struct UsageCard: View {
    @State private var summary: AIUsageSummary?
    @State private var failed = false

    private static let labels = ["practice": "文字对话", "scenario": "生成场景", "ideas": "换一批",
                                 "translate": "单句翻译", "suggest": "卡住时的建议", "live": "语音通话"]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("我的用量").font(.subheadline).foregroundColor(Brand.ink)
                Spacer()
                Text("近 30 天").font(.caption).foregroundColor(Brand.secondary)
            }
            if let summary {
                Text("\(Self.format(summary.total.total_tokens)) tokens · \(summary.total.calls) 次")
                    .font(.title3.weight(.semibold)).foregroundColor(Brand.ink)
                ForEach(summary.byFeature, id: \.key) { group in
                    HStack {
                        Text(Self.labels[group.key] ?? group.key).font(.caption).foregroundColor(Brand.secondary)
                        Spacer()
                        Text("\(Self.format(group.total_tokens)) · \(group.calls) 次").font(.caption).foregroundColor(Brand.ink)
                    }
                }
                if summary.byFeature.isEmpty {
                    Text("还没有用量记录。").font(.caption).foregroundColor(Brand.secondary)
                }
            } else if failed {
                Button("加载失败，点此重试") { Task { await load() } }
                    .font(.caption).foregroundColor(Brand.secondary).frame(minHeight: 44)
            } else {
                ProgressView().frame(maxWidth: .infinity, minHeight: 44)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .surfaceCard()
        .task { await load() }
    }

    private func load() async {
        failed = false
        do { summary = try await PracticeAPIClient().usageSummary() } catch { failed = true }
    }

    private static func format(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

