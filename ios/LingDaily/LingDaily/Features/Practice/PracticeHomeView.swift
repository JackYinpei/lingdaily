import Combine
import SwiftUI

struct PracticeHomeView: View {
    @EnvironmentObject private var store: PracticeStore
    @EnvironmentObject private var aiSettings: AISettingsStore
    @EnvironmentObject private var catalog: ScenarioCatalogStore
    @EnvironmentObject private var today: TodayStore
    @EnvironmentObject private var reminders: ReminderCenter
    @State private var selectedScenario: PracticeScenario?
    @State private var resumed: PracticeSession?
    @State private var composing = false
    @State private var showingAPISettings = false
    @State private var created: PracticeScenario?
    /// Home filter; "" shows every category. Kept across launches.
    @AppStorage("homeScenarioCategory") private var category = ""
    /// First-run picks; matching built-in scenarios come first.
    @AppStorage(LearnerInterests.key) private var interestsRaw = ""

    private var picks: [String] { LearnerInterests.picks(from: interestsRaw) }

    /// Built-in scenarios, the ones matching the learner's picks first.
    private var catalogScenarios: [PracticeScenario] {
        LearnerInterests.ranked(catalog.scenarios, extras: catalog.extras, picks: picks)
    }

    /// The best few unfinished matches get a 「适合你」 mark.
    private var recommended: Set<String> {
        LearnerInterests.recommended(catalog.scenarios.filter { !finished.contains($0.id) }, extras: catalog.extras, picks: picks)
    }

    /// Own scenarios with a real conversation coming up come first, soonest first.
    private var ownScenarios: [PracticeScenario] {
        let startOfToday = Calendar.current.startOfDay(for: Date())
        let upcoming = { (scenario: PracticeScenario) in reminders.eventDay(for: scenario.id).flatMap { $0 >= startOfToday ? $0 : nil } }
        return store.archive.scenarios.enumerated().sorted { left, right in
            switch (upcoming(left.element), upcoming(right.element)) {
            case let (l?, r?): return l < r
            case (.some, nil): return true
            case (nil, .some): return false
            default: return left.offset < right.offset
            }
        }.map(\.element)
    }

    /// Latest unfinished rehearsal, unless a newer attempt at the same scenario was already completed.
    private var unfinished: PracticeSession? {
        let sessions = store.archive.sessions
        return sessions.first { session in
            session.isAI && session.phase != .completed && !sessions.contains {
                $0.scenario.id == session.scenario.id && $0.phase == .completed && $0.updatedAt > session.updatedAt
            }
        }
    }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text(Self.greeting()).font(.largeTitle.bold()).foregroundColor(Brand.ink)
                            Spacer(minLength: 12)
                            Button { created = nil; composing = true } label: {
                                Label("新场景", systemImage: "plus")
                                    .font(.subheadline.weight(.semibold)).foregroundColor(Brand.onInk)
                                    .padding(.horizontal, 16).frame(minHeight: 44)
                                    .background(Brand.ink).clipShape(Capsule())
                            }.accessibilityIdentifier("create-scenario")
                        }
                    }
                    if !aiSettings.settings.isAnyConfigured { apiSetupCard }
                    if let unfinished { continueCard(unfinished) }
                    if categories.count > 1 { categoryFilter }
                    VStack(spacing: 14) {
                        ForEach(ownScenarios.filter { !finished.contains($0.id) && shows($0) }) { scenario in
                            customSceneButton(scenario)
                        }
                        ForEach(catalogScenarios.filter { !finished.contains($0.id) && shows($0) }) { sceneButton($0, isCustom: false) }
                    }
                    if !finishedScenarios.isEmpty {
                        // Finished scenarios fold away so new ones stay on top; still one tap to practise again.
                        VStack(alignment: .leading, spacing: 10) {
                            Text("练过的").font(.subheadline.weight(.semibold)).foregroundColor(Brand.secondary)
                            ForEach(finishedScenarios, id: \.scenario.id) { item in
                                Button { selectedScenario = item.scenario } label: {
                                    CompactSceneCard(scenario: item.scenario, isCustom: item.isCustom)
                                }
                                .buttonStyle(.plain)
                                .accessibilityIdentifier("scene-\(item.scenario.id)")
                                .contextMenu {
                                    if item.isCustom {
                                        Button(role: .destructive) {
                                            reminders.cancelEvent(for: item.scenario.id)
                                            store.removeScenario(item.scenario.id)
                                        } label: {
                                            Label("删除这个场景", systemImage: "trash")
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                .readableColumn()
            }
        }
        .pushDestination(isPresented: $showingAPISettings) { APISettingsView() }
        .pushDestination(isPresented: $composing) {
            if let created {
                PreparationFlowView(scenario: created)
            } else {
                ScenarioComposerView { created = $0 }
            }
        }
        .pushDestination(item: $selectedScenario) { PreparationFlowView(scenario: $0) }
        .pushDestination(item: $resumed) { session in
            ConversationView(initialSession: session, onClose: { resumed = nil })
        }
        .task {
            // Independent requests: 「今日」 (also used by the 播客 tab) does not wait for the catalog.
            async let catalogRefresh: Void = catalog.refresh()
            async let todayRefresh: Void = today.refresh()
            _ = await (catalogRefresh, todayRefresh)
            #if DEBUG
            if !DebugLaunch.route.isEmpty {
                try? await Task.sleep(nanoseconds: 600_000_000)
            }
            if DebugLaunch.take("prep") { selectedScenario = catalog.scenario(id: DebugLaunch.argument) ?? catalog.scenarios.first }
            if DebugLaunch.take("compose") { created = nil; composing = true }
            #endif
        }
        .onReceive(reminders.$pendingScenarioID.compactMap { $0 }) { id in
            reminders.pendingScenarioID = nil
            guard selectedScenario == nil, resumed == nil, !composing else { return }
            selectedScenario = store.archive.scenarios.first { $0.id == id } ?? catalog.scenario(id: id)
        }
    }

    /// Scenarios with at least one completed rehearsal.
    private var finished: Set<String> {
        Set(store.archive.sessions.filter { $0.phase == .completed }.map(\.scenario.id))
    }

    private var finishedScenarios: [(scenario: PracticeScenario, isCustom: Bool)] {
        ownScenarios.filter { finished.contains($0.id) && shows($0) }.map { ($0, true) }
            + catalogScenarios.filter { finished.contains($0.id) && shows($0) }.map { ($0, false) }
    }

    /// Categories that have at least one scenario: everyday life and school first, work last.
    private var categories: [String] {
        let present = Set((ownScenarios + catalog.scenarios).map(\.category))
        let preferred = ["日常", "学习", "社交", "旅行", "职场"]
        return preferred.filter(present.contains) + present.subtracting(preferred).sorted()
    }

    /// A category that no longer has scenarios falls back to showing everything.
    private var activeCategory: String? { categories.contains(category) ? category : nil }

    private func shows(_ scenario: PracticeScenario) -> Bool {
        activeCategory.map { scenario.category == $0 } ?? true
    }

    private var categoryFilter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                categoryChip("全部", selected: activeCategory == nil) { category = "" }
                ForEach(categories, id: \.self) { name in
                    categoryChip(name, selected: activeCategory == name) { category = name }
                }
            }
            .padding(.horizontal, 20)
        }
        .padding(.horizontal, -20)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("场景分类")
    }

    private func categoryChip(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(selected ? .semibold : .regular))
                .foregroundColor(selected ? Brand.onInk : Brand.ink)
                .padding(.horizontal, 16).frame(minHeight: 44)
                .background(selected ? Brand.ink : Brand.surface)
                .overlay(Capsule().strokeBorder(selected ? Color.clear : Brand.line))
                .clipShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
        .accessibilityIdentifier("category-\(title)")
    }

    private func customSceneButton(_ scenario: PracticeScenario) -> some View {
        sceneButton(scenario, isCustom: true).contextMenu {
            Button(role: .destructive) {
                reminders.cancelEvent(for: scenario.id)
                store.removeScenario(scenario.id)
            } label: {
                Label("删除这个场景", systemImage: "trash")
            }
        }
    }

    private func sceneButton(_ scenario: PracticeScenario, isCustom: Bool) -> some View {
        Button { selectedScenario = scenario } label: {
            SceneCard(scenario: scenario, isCustom: isCustom, eventDay: isCustom ? reminders.eventDay(for: scenario.id) : nil,
                      recommended: !isCustom && recommended.contains(scenario.id))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("scene-\(scenario.id)")
    }

    private var apiSetupCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("先配置模型接口").font(.headline).foregroundColor(Brand.ink)
            Text("填入 Google Gemini 或 OpenAI 的 API Key 与模型名称即可开始对话。")
                .font(.subheadline).foregroundColor(Brand.secondary).lineSpacing(3)
            Button("配置接口") { showingAPISettings = true }
                .buttonStyle(SolidButtonStyle())
                .accessibilityIdentifier("open-api-settings")
        }.surfaceCard()
    }

    private func continueCard(_ session: PracticeSession) -> some View {
        Button { resumed = session } label: {
            HStack(spacing: 14) {
                Avatar(scenario: session.scenario, size: 44)
                VStack(alignment: .leading, spacing: 8) {
                    Text("继续和 \(session.scenario.partner) 的对话")
                        .font(.headline).foregroundColor(Brand.ink)
                    StepProgress(current: session.stepIndex, total: session.scenario.steps.count)
                    Text("第 \(session.stepIndex + 1) 步 · \(session.step.goal)")
                        .font(.caption).foregroundColor(Brand.secondary)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundColor(Brand.secondary)
            }.surfaceCard(padding: 16)
        }.buttonStyle(.plain).accessibilityIdentifier("continue-rehearsal")
    }

    private static func greeting(now: Date = Date()) -> String {
        switch Calendar.current.component(.hour, from: now) {
        case 5..<11: return "早上好"
        case 11..<13: return "中午好"
        case 13..<18: return "下午好"
        case 18..<23: return "晚上好"
        default: return "夜深了"
        }
    }
}

/// Leads with the person and their first line — what the learner will actually face.
struct SceneCard: View {
    let scenario: PracticeScenario
    var isCustom = false
    /// The day of the real conversation, when the learner set one.
    var eventDay: Date? = nil
    /// Matches the learner's first-run picks.
    var recommended = false

    private var eventLabel: String? {
        guard let eventDay else { return nil }
        let calendar = Calendar.current
        if calendar.isDateInToday(eventDay) { return "今天要用" }
        if calendar.isDateInTomorrow(eventDay) { return "明天要用" }
        guard eventDay > Date() else { return nil }
        return "\(calendar.component(.month, from: eventDay))月\(calendar.component(.day, from: eventDay))日要用"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Avatar(scenario: scenario, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(scenario.partner).font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Text(scenario.partnerRole).font(.caption).foregroundColor(Brand.inkOnTone)
                }
                Spacer(minLength: 0)
                if let eventLabel {
                    Text(eventLabel).font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                } else if recommended {
                    Text("适合你 · \(scenario.category)").font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                } else {
                    Text(isCustom ? "我的 · \(scenario.category)" : scenario.category)
                        .font(.caption.weight(.medium)).foregroundColor(Brand.inkOnTone)
                }
            }
            Text("“\(scenario.steps[0].prompt)”")
                .font(Brand.english(.title3)).foregroundColor(Brand.ink)
                .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .firstTextBaseline) {
                Text(scenario.title).font(.headline).foregroundColor(Brand.ink)
                Spacer(minLength: 8)
                Image(systemName: "arrow.right").font(.headline).foregroundColor(Brand.ink)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.tone(scenario.id))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// One-line card for a scenario already practised to the end.
struct CompactSceneCard: View {
    let scenario: PracticeScenario
    var isCustom = false
    var body: some View {
        HStack(spacing: 12) {
            Avatar(scenario: scenario, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                Text(scenario.title).font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink).lineLimit(1)
                Text("\(scenario.partner) · \(isCustom ? "我的 · " : "")\(scenario.category)")
                    .font(.caption).foregroundColor(Brand.inkOnTone).lineLimit(1)
            }
            Spacer(minLength: 8)
            Image(systemName: "chevron.right").font(.caption.weight(.semibold)).foregroundColor(Brand.inkOnTone)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.tone(scenario.id))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

struct StepProgress: View {
    let current: Int
    let total: Int
    var body: some View {
        HStack(spacing: 4) {
            ForEach(0..<total, id: \.self) { index in
                Capsule().fill(index <= current ? Brand.accent : Brand.line).frame(height: 4)
            }
        }
        .accessibilityElement()
        .accessibilityLabel("第 \(current + 1) 步，共 \(total) 步")
    }
}
