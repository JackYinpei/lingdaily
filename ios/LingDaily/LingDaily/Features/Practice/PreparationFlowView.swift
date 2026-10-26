import SwiftUI

struct PreparationFlowView: View {
    let scenario: PracticeScenario
    @EnvironmentObject private var account: AccountStore
    @EnvironmentObject private var store: PracticeStore
    @Environment(\.dismiss) private var dismiss
    @State private var session: PracticeSession?
    @State private var goal = ""
    @State private var context = ""
    @State private var addsContext = false
    @State private var reviewItems: [ReviewTarget] = []
    @State private var quickReview = false
    @AppStorage("preferVoicePractice") private var voiceMode = true
    @AppStorage(PracticeLevel.key) private var levelRaw = PracticeLevel.standard.rawValue
    @AppStorage(ReviewPicker.enabledKey) private var reviewEnabled = true
    @FocusState private var fieldFocused: Bool

    private var level: PracticeLevel { PracticeLevel(rawValue: levelRaw) ?? .standard }

    var body: some View {
        if let session {
            ConversationView(initialSession: session, initialVoiceMode: voiceMode, autoStartVoice: voiceMode, onClose: { dismiss() })
        } else {
            ZStack(alignment: .topLeading) {
                PageBackground()
                ScrollView {
                    VStack(alignment: .leading, spacing: 28) {
                        scene
                        VStack(alignment: .leading, spacing: 12) {
                            Text("这次要说到").font(.headline).foregroundColor(Brand.ink)
                            ForEach(Array(scenario.steps.enumerated()), id: \.element.id) { index, step in
                                HStack(spacing: 12) {
                                    Text(String(index + 1)).font(.subheadline.weight(.semibold).monospacedDigit())
                                        .foregroundColor(Brand.secondary).frame(width: 18)
                                    Text(step.goal).font(.body).foregroundColor(Brand.ink)
                                }
                            }
                            Button { quickReview = true } label: {
                                Label("先过一遍三句话", systemImage: "text.badge.checkmark")
                            }.font(.subheadline).foregroundColor(Brand.secondary).frame(minHeight: 44)
                                .accessibilityIdentifier("quick-review")
                        }
                        VStack(alignment: .leading, spacing: 10) {
                            Text("难度").font(.headline).foregroundColor(Brand.ink)
                            Picker("难度", selection: $levelRaw) {
                                ForEach(PracticeLevel.allCases) { Text($0.label).tag($0.rawValue) }
                            }.pickerStyle(.segmented).accessibilityIdentifier("practice-level")
                            Text(Self.levelNote(level)).font(.caption).foregroundColor(Brand.secondary)
                        }
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
                    if account.canPractice {
                        Picker("对话模式", selection: $voiceMode) {
                            Text("文字").tag(false)
                            Text("语音通话").tag(true)
                        }.pickerStyle(.segmented).accessibilityIdentifier("preparation-mode")
                        Button {
                            fieldFocused = false
                            session = PracticeSession(scenario: scenario, goal: goal, context: context, useAI: true,
                                                      level: level, reviewItems: reviewEnabled ? reviewItems : [])
                        } label: { Text(voiceMode ? "进入语音通话" : "开始文字对话") }
                            .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("start-rehearsal")
                    } else {
                        // Signing in here keeps the learner on this scenario instead of sending them to 我的.
                        AppleSignInButton()
                    }
                }
                .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
                .readableColumn().background(Brand.page)
            }
            .navigationBack(title: "准备对话") { dismiss() }
            .onAppear { if reviewItems.isEmpty { reviewItems = ReviewPicker.pick(from: store.archive, for: scenario) } }
            .pushDestination(isPresented: $quickReview) {
                ReviewView(title: "快速过一遍", cards: scenario.steps.map {
                    ReviewCard(id: $0.id, text: $0.expression, meaning: $0.meaning, label: $0.goal)
                })
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

    private var scene: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 14) {
                Avatar(scenario: scenario, size: 56)
                VStack(alignment: .leading, spacing: 3) {
                    Text(scenario.partner).font(.title3.weight(.semibold)).foregroundColor(Brand.ink)
                    Text(scenario.partnerRole).font(.subheadline).foregroundColor(Brand.inkOnTone)
                }
            }
            Text(scenario.title).font(.title.bold()).foregroundColor(Brand.ink)
            Text(scenario.setting).font(.body).foregroundColor(Brand.inkOnTone).lineSpacing(5)
                .fixedSize(horizontal: false, vertical: true)
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
