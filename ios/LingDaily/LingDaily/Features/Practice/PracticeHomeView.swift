import SwiftUI

struct PracticeHomeView: View {
    @EnvironmentObject private var store: PracticeStore
    @EnvironmentObject private var account: AccountStore
    @State private var selectedScenario: PracticeScenario?
    @State private var resumed: PracticeSession?
    @State private var composing = false
    @State private var created: PracticeScenario?

    private var unfinished: PracticeSession? {
        store.archive.sessions.first { $0.isAI && $0.phase != .completed }
    }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView(showsIndicators: false) {
                VStack(alignment: .leading, spacing: 28) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(Self.dayFormatter.string(from: Date()))
                            .font(.subheadline).foregroundColor(Brand.secondary)
                        HStack {
                            Text(Self.greeting()).font(.largeTitle.bold()).foregroundColor(Brand.ink)
                            Spacer(minLength: 12)
                            Button { composing = true } label: {
                                Label("新场景", systemImage: "plus")
                                    .font(.subheadline.weight(.semibold)).foregroundColor(Brand.onInk)
                                    .padding(.horizontal, 16).frame(minHeight: 44)
                                    .background(Brand.ink).clipShape(Capsule())
                            }.accessibilityIdentifier("create-scenario")
                        }
                        Text("今天想和谁聊聊？").font(.subheadline).foregroundColor(Brand.secondary)
                    }
                    if !account.canPractice { signInCard }
                    if let unfinished { continueCard(unfinished) }
                    VStack(spacing: 14) {
                        ForEach(store.archive.scenarios) { scenario in
                            sceneButton(scenario, isCustom: true).contextMenu {
                                Button(role: .destructive) { store.removeScenario(scenario.id) } label: {
                                    Label("删除这个场景", systemImage: "trash")
                                }
                            }
                        }
                        ForEach(ScenarioLibrary.all) { sceneButton($0, isCustom: false) }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 32)
                .readableColumn()
            }
        }
        .sheet(isPresented: $composing, onDismiss: {
            // Open the new scenario only after the sheet is gone; two presentations cannot overlap.
            if let created { selectedScenario = created; self.created = nil }
        }) {
            ScenarioComposerView { created = $0 }
        }
        .fullScreenCover(item: $selectedScenario) { PreparationFlowView(scenario: $0) }
        .fullScreenCover(item: $resumed) { session in
            ConversationView(initialSession: session, onClose: { resumed = nil })
        }
    }

    private func sceneButton(_ scenario: PracticeScenario, isCustom: Bool) -> some View {
        Button { selectedScenario = scenario } label: { SceneCard(scenario: scenario, isCustom: isCustom) }
            .buttonStyle(.plain)
            .accessibilityIdentifier("scene-\(scenario.id)")
    }

    private var signInCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text("先登录，再开口").font(.headline).foregroundColor(Brand.ink)
                Text("用 Apple 登录后就能和场景里的人对话。练习记录只保存在这台设备。")
                    .font(.subheadline).foregroundColor(Brand.secondary)
            }
            AppleSignInButton()
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

    private static let dayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = "M月d日 EEEE"
        return formatter
    }()

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
    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Avatar(scenario: scenario, size: 40)
                VStack(alignment: .leading, spacing: 2) {
                    Text(scenario.partner).font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Text(scenario.partnerRole).font(.caption).foregroundColor(Brand.inkOnTone)
                }
                Spacer(minLength: 0)
                Text(isCustom ? "我的 · \(scenario.category)" : scenario.category)
                    .font(.caption.weight(.medium)).foregroundColor(Brand.inkOnTone)
            }
            Text("“\(scenario.steps[0].prompt)”")
                .font(Brand.english(.title3)).foregroundColor(Brand.ink)
                .lineSpacing(3).fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(scenario.title).font(.headline).foregroundColor(Brand.ink)
                    Text(scenario.subtitle).font(.caption).foregroundColor(Brand.inkOnTone)
                }
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
