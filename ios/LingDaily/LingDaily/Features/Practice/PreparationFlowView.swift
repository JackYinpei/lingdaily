import SwiftUI

struct PreparationFlowView: View {
    let scenario: PracticeScenario
    @EnvironmentObject private var aiSettings: AISettingsStore
    @EnvironmentObject private var store: PracticeStore
    @EnvironmentObject private var catalog: ScenarioCatalogStore
    @Environment(\.dismiss) private var dismiss
    @State private var session: PracticeSession?
    @State private var showingAPISettings = false
    @State private var goal = ""
    @State private var context = ""
    @State private var addsContext = false
    @State private var reviewItems: [ReviewTarget] = []
    /// The partner's avatar on the 脾气 pad, each axis -1...1; the centre is the scenario's persona.
    @State private var padPoint = CGPoint.zero
    /// The partner's persona for this rehearsal; editing it never changes the saved scenario.
    @State private var persona: String
    /// Who plays the partner this time (「换个人」); nil keeps the scenario's own partner.
    @State private var player: PartnerCharacter?
    @AppStorage("preferVoicePractice") private var voiceMode = true
    @AppStorage(PracticeLevel.key) private var levelRaw = PracticeLevel.standard.rawValue
    @AppStorage(ReviewPicker.enabledKey) private var reviewEnabled = true
    @FocusState private var fieldFocused: Bool

    private var level: PracticeLevel { PracticeLevel(rawValue: levelRaw) ?? .standard }
    private var temperament: PartnerTemperament { PartnerTemperament(x: padPoint.x, y: padPoint.y) }
    /// The scenario as it will be played: the chosen person, before the learner's persona edit.
    private var current: PracticeScenario { player.map { scenario.played(by: $0) } ?? scenario }
    private var cast: [PartnerCharacter] { catalog.cast(for: scenario.id) }

    init(scenario: PracticeScenario) {
        self.scenario = scenario
        _persona = State(initialValue: scenario.persona ?? "")
    }

    var body: some View {
        if let session {
            ConversationView(initialSession: session, initialVoiceMode: voiceMode, autoStartVoice: voiceMode, onClose: { dismiss() })
        } else {
            ZStack(alignment: .topLeading) {
                PageBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        scene
                        if cast.count > 1 { castPicker }
                        VStack(alignment: .leading, spacing: 10) {
                            Text("难度").font(.headline).foregroundColor(Brand.ink)
                            Picker("难度", selection: $levelRaw) {
                                ForEach(PracticeLevel.allCases) { Text($0.label).tag($0.rawValue) }
                            }.pickerStyle(.segmented).accessibilityIdentifier("practice-level")
                            Text(Self.levelNote(level)).font(.caption).foregroundColor(Brand.secondary)
                        }
                        partner
                        if reviewEnabled && !reviewItems.isEmpty { review }
                        VStack(alignment: .leading, spacing: 10) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("你的目标").font(.headline).foregroundColor(Brand.ink)
                                Text("可选").font(.caption).foregroundColor(Brand.secondary)
                            }
                            field("比如：\(scenario.subtitle)", text: $goal, limit: 100)
                                .accessibilityIdentifier("personal-goal")
                            if addsContext {
                                field("比如：语气自然一点，不要太正式", text: $context, limit: 500)
                            } else {
                                Button { addsContext = true } label: {
                                    Label("补充一点背景", systemImage: "plus")
                                }.font(.subheadline).foregroundColor(Brand.secondary).frame(minHeight: 44)
                            }
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 20).padding(.bottom, 24)
                    .readableColumn()
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 10) {
                    if aiSettings.settings.isAnyConfigured {
                        HStack(spacing: 12) {
                            Button {
                                if aiSettings.settings.resolvedText != nil {
                                    start(voice: false)
                                } else {
                                    showingAPISettings = true
                                }
                            } label: { Text("文字对话") }
                                .buttonStyle(SolidButtonStyle(secondary: aiSettings.settings.resolvedText == nil))
                                .accessibilityIdentifier("start-text")
                            Button {
                                if aiSettings.settings.resolvedVoice != nil {
                                    start(voice: true)
                                } else {
                                    showingAPISettings = true
                                }
                            } label: { Text("语音通话") }
                                .buttonStyle(SolidButtonStyle(secondary: aiSettings.settings.resolvedVoice == nil))
                                .accessibilityIdentifier("start-voice")
                        }
                    } else {
                        Button("配置 API Key 开始练习") {
                            fieldFocused = false
                            showingAPISettings = true
                        }
                        .buttonStyle(SolidButtonStyle())
                        .accessibilityIdentifier("configure-api-to-start")
                    }
                }
                .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
                .readableColumn().background(Brand.page)
            }
            .pushDestination(isPresented: $showingAPISettings) { APISettingsView() }
            .navigationBack(title: "准备对话") { dismiss() }
            .onAppear { if reviewItems.isEmpty { reviewItems = ReviewPicker.pick(from: store.archive, for: scenario) } }
        }
    }

    private func start(voice: Bool) {
        fieldFocused = false
        voiceMode = voice
        session = PracticeSession(scenario: current.withPersona(persona), goal: goal, context: context, useAI: true,
                                  level: level, temperament: temperament, reviewItems: reviewEnabled ? reviewItems : [])
    }

    /// 对方的脾气: drag the partner around a two-axis pad.
    private var partner: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("对方的脾气").font(.headline).foregroundColor(Brand.ink)
            TemperamentPad(scenario: current, point: $padPoint)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(temperament.label.map { "\(current.partner)：\($0)" } ?? "按场景设定。拖动头像，让对方更好商量或更难缠、更冷静或更激动。")
                    .font(.caption).foregroundColor(Brand.secondary).fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)
                Spacer(minLength: 0)
                if !temperament.isScenario {
                    Button("回到场景设定") { withAnimation(.easeOut(duration: 0.2)) { padPoint = .zero } }
                        .font(.caption).foregroundColor(Brand.secondary).frame(minHeight: 44)
                        .accessibilityIdentifier("reset-temperament")
                }
            }
        }
    }

    /// "三个词回来找你": words from 词库 the partner will make room for.
    private var review: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("试着用上").font(.headline).foregroundColor(Brand.ink)
            ForEach(reviewItems, id: \.self) { item in
                (Text(item.text).font(Brand.english(.body)).foregroundColor(Brand.ink)
                    + Text("  \(item.meaning)").font(.footnote).foregroundColor(Brand.secondary))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("review-words")
    }

    static func levelNote(_ level: PracticeLevel) -> String {
        switch level {
        case .easy: return "短句、常用词，对方更有耐心。"
        case .standard: return "日常的语速和用词。"
        case .challenge: return "更地道，会追问，还可能出点小状况。"
        }
    }

    /// 「换个人」: the same role played by someone with another temper and way of talking.
    private var castPicker: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("和谁练").font(.headline).foregroundColor(Brand.ink)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(cast, id: \.self) { person in
                        let selected = person.partner == current.partner
                        Button {
                            guard !selected else { return }
                            withAnimation(.easeOut(duration: 0.2)) {
                                player = person
                                persona = person.persona
                                padPoint = .zero
                            }
                            UISelectionFeedbackGenerator().selectionChanged()
                        } label: {
                            HStack(spacing: 10) {
                                Avatar(scenario: scenario.played(by: person), size: 36)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(person.partner).font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                                    Text(person.label).font(.caption).foregroundColor(Brand.secondary).lineLimit(1)
                                }
                            }
                            .padding(.leading, 8).padding(.trailing, 14).frame(minHeight: 52)
                            .background(Brand.surface)
                            .clipShape(Capsule())
                            .overlay(Capsule().stroke(selected ? Brand.accent : Brand.line, lineWidth: selected ? 1.5 : 1))
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityAddTraits(selected ? .isSelected : [])
                        .accessibilityIdentifier("cast-\(person.partner)")
                    }
                }
                .padding(.horizontal, 20).padding(.vertical, 1)
            }
            .padding(.horizontal, -20)
        }
    }

    private var scene: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Avatar(scenario: current, size: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text(current.partner).font(.title3.weight(.semibold)).foregroundColor(Brand.ink)
                    Text(scenario.partnerRole).font(.subheadline).foregroundColor(Brand.inkOnTone)
                }
            }
            Text(scenario.title).font(.title.bold()).foregroundColor(Brand.ink)
            Text(current.setting).font(.body).foregroundColor(Brand.inkOnTone).lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
            if let shown = PracticeScenario.cleanPersona(persona) {
                Text("\(current.partner)：\(shown)").font(.subheadline).foregroundColor(Brand.inkOnTone)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("partner-persona-summary")
            }
        }
        .padding(22).frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.tone(scenario.id))
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private func field(_ placeholder: String, text: Binding<String>, limit: Int) -> some View {
        TextField(placeholder, text: text)
            .padding(.horizontal, 16).frame(minHeight: 50)
            .background(Brand.surface)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Brand.line))
            .focused($fieldFocused)
            .onChange(of: text.wrappedValue) { text.wrappedValue = String($0.prefix(limit)) }
    }
}

/// A two-axis pad for how the partner behaves: 好商量 ↔ 不让步 across, 冷静 ↔ 情绪外放 up.
/// The knob is the partner's own avatar. Dragging is continuous; each axis has five levels and
/// entering a new one ticks, so the learner feels the steps the model can actually play.
private struct TemperamentPad: View {
    let scenario: PracticeScenario
    /// Each axis -1...1, up is more emotion.
    @Binding var point: CGPoint
    private let knob: CGFloat = 40
    private var temperament: PartnerTemperament { PartnerTemperament(x: point.x, y: point.y) }

    var body: some View {
        GeometryReader { geometry in
            let size = geometry.size
            let inset = knob / 2 + 8
            let span = CGSize(width: max(size.width - inset * 2, 1), height: max(size.height - inset * 2, 1))
            ZStack {
                Path { path in
                    path.move(to: CGPoint(x: size.width / 2, y: 30))
                    path.addLine(to: CGPoint(x: size.width / 2, y: size.height - 30))
                    path.move(to: CGPoint(x: 16, y: size.height / 2))
                    path.addLine(to: CGPoint(x: size.width - 16, y: size.height / 2))
                }
                .stroke(Brand.line, lineWidth: 1)
                Avatar(scenario: scenario, size: knob)
                    .overlay(Circle().stroke(Brand.ink, lineWidth: 1.5))
                    .position(x: inset + (point.x + 1) / 2 * span.width, y: inset + (1 - point.y) / 2 * span.height)
            }
            .contentShape(Rectangle())
            // Wins over the page's scroll so a drag that starts on the pad moves the partner.
            .highPriorityGesture(DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let before = temperament
                    point = CGPoint(x: Self.clamp((value.location.x - inset) / span.width * 2 - 1),
                                    y: Self.clamp(1 - (value.location.y - inset) / span.height * 2))
                    if temperament != before { UISelectionFeedbackGenerator().selectionChanged() }
                }
                .onEnded { _ in
                    // The centre is a single setting, so it snaps there.
                    if temperament.isScenario { withAnimation(.easeOut(duration: 0.2)) { point = .zero } }
                })
        }
        .frame(height: 176)
        // Under the knob, so the partner is never hidden by a label.
        .background(ZStack {
            axisLabel("情绪外放").padding(.top, 8).frame(maxHeight: .infinity, alignment: .top)
            axisLabel("冷静").padding(.bottom, 8).frame(maxHeight: .infinity, alignment: .bottom)
            axisLabel("好商量").padding(.leading, 14).offset(y: -12).frame(maxWidth: .infinity, alignment: .leading)
            axisLabel("不让步").padding(.trailing, 14).offset(y: -12).frame(maxWidth: .infinity, alignment: .trailing)
        })
        .background(Brand.surface)
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Brand.line))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("对方的脾气")
        .accessibilityValue(temperament.label ?? "按场景设定")
        .accessibilityAction(named: "更好商量") { step(pushback: -1) }
        .accessibilityAction(named: "更不让步") { step(pushback: 1) }
        .accessibilityAction(named: "更冷静") { step(emotion: -1) }
        .accessibilityAction(named: "更情绪外放") { step(emotion: 1) }
        .accessibilityIdentifier("partner-temperament")
    }

    private func axisLabel(_ text: String) -> some View {
        Text(text).font(.caption2).foregroundColor(Brand.secondary)
    }

    private func step(pushback: Int = 0, emotion: Int = 0) {
        let next = temperament.moved(pushback: pushback, emotion: emotion).point
        point = CGPoint(x: next.x, y: next.y)
    }

    private static func clamp(_ value: CGFloat) -> CGFloat { min(max(value, -1), 1) }
}
