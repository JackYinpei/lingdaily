import SwiftUI

struct PreparationFlowView: View {
    let scenario: PracticeScenario
    @Environment(\.dismiss) private var dismiss
    @State private var session: PracticeSession?
    @State private var goal = ""
    @State private var context = ""
    @State private var addsContext = false
    @AppStorage("preferVoicePractice") private var voiceMode = true
    @FocusState private var fieldFocused: Bool

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
                        }
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
                            Text("\(scenario.partner) 会按你的目标调整对话和追问。")
                                .font(.caption).foregroundColor(Brand.secondary)
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 64).padding(.bottom, 24)
                    .readableColumn()
                }
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.headline).foregroundColor(Brand.ink)
                        .frame(width: 44, height: 44)
                }.padding(.leading, 10).accessibilityLabel("关闭")
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                VStack(spacing: 10) {
                    Picker("对话模式", selection: $voiceMode) {
                        Text("文字").tag(false)
                        Text("语音通话").tag(true)
                    }.pickerStyle(.segmented).accessibilityIdentifier("preparation-mode")
                    Button {
                        fieldFocused = false
                        session = PracticeSession(scenario: scenario, goal: goal, context: context, useAI: true)
                    } label: { Text(voiceMode ? "进入语音通话" : "开始文字对话") }
                        .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("start-rehearsal")
                    Text("目标、背景和对话文字会发送给 Gemini；进入语音通话后语音也会发送，原始录音不保存。")
                        .font(.caption2).foregroundColor(Brand.secondary).multilineTextAlignment(.center)
                }
                .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 8)
                .readableColumn().background(Brand.page)
            }
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
