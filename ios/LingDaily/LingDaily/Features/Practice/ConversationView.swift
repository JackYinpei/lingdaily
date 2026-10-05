import Combine
import SwiftUI

struct ConversationView: View {
    @EnvironmentObject private var store: PracticeStore
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var speech = SpeechController()
    @StateObject private var model: PracticeViewModel
    @StateObject private var live = LivePracticeController()
    @State private var voiceMode: Bool
    @AppStorage("autoReadAIReplies") private var autoReadReplies = true
    @State private var draft = ""
    @State private var dictationPrefix = ""
    @State private var dictationActive = false
    @State private var submittingDictation = false
    @AppStorage("preferVoicePractice") private var preferVoicePractice = true
    @State private var hintLevel = 0
    @StateObject private var translations = BubbleTranslations()
    @State private var showExit = false
    @FocusState private var inputFocused: Bool
    let onClose: () -> Void
    private var session: PracticeSession { model.session }
    private var messageCount: Int { session.messages.count }
    private var lastMessageText: String { session.messages.last?.text ?? "" }
    private var onListen: ((String) -> Void)? { voiceMode ? nil : { text in speech.speak(text) } }
    private var practiceStep: PracticeStep { session.suggestedStep ?? session.step }
    private var isLastStep: Bool { session.stepIndex + 1 == session.scenario.steps.count }

    init(initialSession: PracticeSession, initialVoiceMode: Bool? = nil, onClose: @escaping () -> Void) {
        _model = StateObject(wrappedValue: PracticeViewModel(session: initialSession))
        let preferred = initialVoiceMode ?? (UserDefaults.standard.object(forKey: "preferVoicePractice") as? Bool ?? true)
        _voiceMode = State(initialValue: initialSession.isAI && preferred)
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            PageBackground()
            if session.phase == .completed && live.state == .disconnected {
                PracticeSummaryView(session: session, onClose: onClose)
            } else {
                conversation
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                StorageBanner()
                if session.phase != .completed { header }
            }
        }
        .confirmationDialog("稍后可以从学习记录继续", isPresented: $showExit, titleVisibility: .visible) {
            Button("保存并离开") { store.save(session); onClose() }
            Button("继续练习", role: .cancel) {}
        } message: { Text("已发送的内容会保留，输入框中未发送的草稿不会保存。") }
        .onChange(of: speech.transcript) { text in
            guard dictationActive, !voiceMode, !text.isEmpty else { return }
            draft = String((dictationPrefix + text).prefix(800))
        }
        .onChange(of: messageCount) { _ in
            if !voiceMode, autoReadReplies, scenePhase == .active, let last = session.messages.last, last.role == .partner {
                speech.speak(last.text)
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background { dictationActive = false; live.stop(); speech.stopAll(); model.pause(); store.save(session) }
        }
        .onChange(of: voiceMode) { enabled in
            dictationActive = false; speech.stopAll(); inputFocused = false
            preferVoicePractice = enabled
            if enabled { model.enterLive() }
            else { live.stop(); model.enterText(store: store) }
        }
        .onAppear { if voiceMode { model.enterLive() } else { model.requestPending(store: store) } }
        .onDisappear { dictationActive = false; live.stop(); speech.stopAll(); model.pause() }
    }

    // MARK: Header — who you're talking to and which step you're on, always visible.

    private var header: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    live.stop()
                    dictationActive = false
                    speech.stopAll()
                    model.pause()
                    inputFocused = false
                    if session.userTurns == 0 { onClose() } else { showExit = true }
                } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }
                    .accessibilityLabel("离开练习")
                Avatar(scenario: session.scenario, size: 34)
                VStack(alignment: .leading, spacing: 1) {
                    Text(session.scenario.partner).font(.subheadline.weight(.semibold))
                    Text(session.scenario.partnerRole).font(.caption2).foregroundColor(Brand.secondary)
                }
                Spacer()
                if !voiceMode { Button {
                    autoReadReplies.toggle()
                    if !autoReadReplies { speech.stopAll() }
                } label: {
                    Image(systemName: autoReadReplies ? "speaker.wave.2" : "speaker.slash").frame(width: 44, height: 44)
                }.accessibilityLabel(autoReadReplies ? "关闭自动朗读" : "开启自动朗读") }
            }
            .font(.body).foregroundColor(Brand.ink)
            Picker("对话模式", selection: $voiceMode) {
                Text("文字").tag(false)
                Text("语音通话").tag(true)
            }.pickerStyle(.segmented).padding(.horizontal, 16)
                .accessibilityIdentifier("conversation-mode")
            VStack(alignment: .leading, spacing: 6) {
                StepProgress(current: session.stepIndex, total: session.scenario.steps.count)
                Text("第 \(session.stepIndex + 1) 步 · \(session.step.goal)")
                    .font(.caption.weight(.medium)).foregroundColor(Brand.secondary)
            }.padding(.horizontal, 16)
        }
        .padding(.horizontal, 4).padding(.bottom, 10)
        .background(Brand.page)
        .overlay(alignment: .bottom) { Brand.line.frame(height: 1) }
    }

    // MARK: Transcript

    private var conversation: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: true) {
                VStack(alignment: .leading, spacing: 16) {
                    VStack(spacing: 6) {
                        Text(session.scenario.setting)
                        if !session.personalGoal.isEmpty { Text("你的目标：\(session.personalGoal)") }
                        if !session.context.isEmpty { Text("背景：\(session.context)") }
                    }
                    .font(.footnote).foregroundColor(Brand.secondary).lineSpacing(3)
                    .multilineTextAlignment(.center).frame(maxWidth: .infinity)
                    .padding(.horizontal, 12).padding(.bottom, 8)
                    transcriptRows
                    if !voiceMode && session.pendingAIRequest != nil { pendingState }
                    Color.clear.frame(height: 1).id("latest")
                }
                .padding(.horizontal, 16).padding(.vertical, 20)
                .readableColumn()
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                if voiceMode {
                    voiceControls.readableColumn().background(Brand.page)
                } else if session.pendingAIRequest == nil {
                    Group {
                        if session.phase == .review { reviewActions } else { composer }
                    }.readableColumn().background(Brand.page)
                }
            }
            .onAppear { proxy.scrollTo("latest", anchor: .bottom) }
            .onChange(of: lastMessageText) { _ in if voiceMode { scrollToLatest(proxy) } }
            .onChange(of: messageCount) { _ in scrollToLatest(proxy) }
            .onChange(of: session.phase) { _ in scrollToLatest(proxy) }
            .onChange(of: hintLevel) { _ in scrollToLatest(proxy) }
            .onChange(of: inputFocused) { if $0 { scrollToLatest(proxy) } }
        }
    }

    private var transcriptRows: some View {
                    ForEach(session.messages) { message in
                        MessageBubble(message: message, scenario: session.scenario,
                                      showTranslation: translations.shown.contains(message.id),
                                      translationState: translations.state(of: message.id),
                                      onTranslate: {
                                          translations.toggle(message, in: session.scenario) { text in
                                              model.applyTranslation(text, to: message.id, store: store)
                                          }
                                      },
                                      onListen: onListen)
                        if let feedback = session.feedback(for: message.id) {
                            FeedbackNote(feedback: feedback, source: session.scenario.title, onListen: onListen)
                        }
                    }
    }

    private var voiceControls: some View {
        VStack(spacing: 10) {
            Text(live.status).font(.caption.weight(.medium)).foregroundColor(Brand.secondary)
                .accessibilityIdentifier("live-status")
            if let message = live.errorMessage {
                Text(message).font(.caption).foregroundColor(Brand.secondary)
            }
            HStack(spacing: 10) {
                if live.state == .disconnected {
                    Button(session.live?.model == nil ? "开始通话" : "重新连接") {
                        dictationActive = false; speech.stopAll(); model.pause()
                        live.start(model: model, store: store)
                    }.buttonStyle(SolidButtonStyle()).accessibilityIdentifier("live-connect")
                } else {
                    Button { live.toggleMute() } label: {
                        Label(live.muted ? "取消静音" : "静音", systemImage: live.muted ? "mic.slash" : "mic")
                    }.buttonStyle(SolidButtonStyle(secondary: true)).disabled(live.state != .active)
                        .accessibilityIdentifier("live-mute")
                    Button("结束") { live.stop() }.buttonStyle(SolidButtonStyle())
                        .accessibilityIdentifier("live-end")
                }
            }
        }.padding(.horizontal, 16).padding(.vertical, 12)
    }

    @ViewBuilder private var pendingState: some View {
        if model.isLoading {
            HStack(alignment: .bottom, spacing: 8) {
                Avatar(scenario: session.scenario, size: 28)
                TypingDots().padding(.horizontal, 16).padding(.vertical, 14)
                    .background(Brand.surface).clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            }.accessibilityLabel("\(session.scenario.partner) 正在回复").accessibilityIdentifier("ai-request-state")
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("没收到 \(session.scenario.partner) 的回复").font(.headline).foregroundColor(Brand.ink)
                Text(model.errorMessage ?? "网络可能断开了，已发送的内容都还在。")
                    .font(.subheadline).foregroundColor(Brand.secondary).lineSpacing(3)
                Button("再试一次") { model.requestPending(store: store) }
                    .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("retry-ai-request")
            }.surfaceCard()
        }
    }

    // MARK: Bottom bar — exactly one of: composer, or retry/next after feedback.

    private var reviewActions: some View {
        VStack(spacing: 8) {
            audioError
            HStack(spacing: 10) {
                Button {
                    speech.stopAll()
                    model.beginRetry(store: store)
                    hintLevel = 0
                    DispatchQueue.main.async { inputFocused = true }
                } label: { Label("再说一次", systemImage: "arrow.counterclockwise") }
                    .buttonStyle(SolidButtonStyle(secondary: true)).accessibilityIdentifier("retry-utterance")
                Button {
                    speech.stopAll()
                    model.advance(store: store)
                    hintLevel = 0
                } label: { Text(isLastStep ? "完成" : "下一步") }
                    .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("next-mission")
            }
        }.padding(.horizontal, 16).padding(.vertical, 12)
    }

    private var composer: some View {
        VStack(alignment: .leading, spacing: 10) {
            audioError
            if session.phase == .retry {
                HStack {
                    Text("换个说法，再说一次").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                    Spacer()
                    Button("算了") {
                        speech.stopAll()
                        draft = ""
                        inputFocused = false
                        model.cancelRetry(store: store)
                    }.font(.subheadline).foregroundColor(Brand.secondary).frame(minHeight: 32)
                }
            }
            hints
            HStack(spacing: 8) {
                Button {
                    inputFocused = false
                    if speech.isRecording { Task { _ = await speech.finishRecording() } }
                    else {
                        dictationPrefix = draft.isEmpty ? "" : draft + " "
                        dictationActive = true
                        Task {
                            guard dictationActive, !voiceMode, scenePhase == .active else { return }
                            await speech.startRecording(maxCharacters: max(1, 800 - dictationPrefix.count))
                        }
                    }
                } label: {
                    Image(systemName: speech.isRecording ? "stop.fill" : "mic")
                        .font(.body.weight(.semibold)).frame(width: 44, height: 44)
                        .foregroundColor(speech.isRecording ? Brand.onInk : Brand.ink)
                        .background(speech.isRecording ? Brand.accent : Brand.surface)
                        .overlay(Circle().stroke(Brand.line, lineWidth: speech.isRecording ? 0 : 1))
                        .clipShape(Circle())
                }
                .disabled(speech.isRequestingPermission || speech.isFinalizing || submittingDictation || (!speech.isRecording && draft.count >= 800))
                .accessibilityLabel(speech.isRecording ? "停止听写" : "开始英语听写")
                HStack(spacing: 4) {
                    TextField(session.phase == .retry ? "换一种说法…" : "用英语回答…", text: $draft)
                        .font(.body).padding(.leading, 16).frame(minHeight: 44).focused($inputFocused)
                        .submitLabel(.send).onSubmit(submit)
                        .disableAutocorrection(true).accessibilityIdentifier("practice-input")
                        .disabled(speech.isFinalizing || submittingDictation)
                        .onChange(of: draft) { draft = String($0.prefix(800)) }
                    Button(action: submit) {
                        Image(systemName: "arrow.up").font(.subheadline.weight(.bold)).foregroundColor(Brand.onInk)
                            .frame(width: 34, height: 34).background(Brand.ink).clipShape(Circle())
                            .frame(width: 44, height: 44)
                    }
                    .disabled(!canSubmit)
                    .opacity(canSubmit ? 1 : 0.25)
                    .accessibilityLabel("发送").accessibilityIdentifier("send-answer")
                }
                .background(Brand.surface).clipShape(Capsule())
                .overlay(Capsule().stroke(Brand.line))
            }
            if speech.isRecording {
                Text("正在听写 · 点停止后可以修改").font(.caption2).foregroundColor(Brand.accent)
                    .frame(maxWidth: .infinity)
            } else if speech.isFinalizing || submittingDictation {
                Text("正在整理最后一句…").font(.caption2).foregroundColor(Brand.secondary)
                    .frame(maxWidth: .infinity)
            }
        }.padding(.horizontal, 16).padding(.top, 10).padding(.bottom, 8)
    }

    /// Three explicit levels instead of a cycling button: meaning → keywords → a sample line.
    private var hints: some View {
        VStack(alignment: .leading, spacing: 8) {
            if hintLevel > 0 {
                Text(hintLevel == 1 ? practiceStep.hint : (hintLevel == 2 ? practiceStep.keywords : practiceStep.expression))
                    .font(hintLevel == 3 ? Brand.english(.body) : .subheadline)
                    .foregroundColor(Brand.ink).lineSpacing(3).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12).background(Brand.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
            HStack(spacing: 6) {
                Text("提示").font(.caption).foregroundColor(Brand.secondary)
                ForEach(Array(["意思", "关键词", "参考说法"].enumerated()), id: \.offset) { index, label in
                    let level = index + 1
                    Button { hintLevel = hintLevel == level ? 0 : level } label: {
                        Text(label).font(.caption.weight(.medium))
                            .padding(.horizontal, 12).frame(minHeight: 30)
                            .foregroundColor(hintLevel == level ? Brand.onInk : Brand.ink)
                            .background(hintLevel == level ? Brand.ink : Color.clear)
                            .overlay(Capsule().stroke(Brand.line))
                            .clipShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(hintLevel == level ? .isSelected : [])
                    .accessibilityIdentifier(index == 0 ? "practice-hint" : "practice-hint-\(level)")
                }
            }
        }
    }

    @ViewBuilder private var audioError: some View {
        if let error = speech.errorMessage {
            Text(error).font(.caption).foregroundColor(Brand.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var canSubmit: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !speech.isRequestingPermission
            && !speech.isFinalizing && !submittingDictation
    }

    private func submit() {
        guard !speech.isRequestingPermission, !speech.isFinalizing, !submittingDictation else { return }
        if speech.isRecording {
            submittingDictation = true
            let prefix = dictationPrefix
            Task {
                let result = await speech.finishRecording()
                submittingDictation = false
                guard dictationActive, !voiceMode, scenePhase == .active else { return }
                draft = String((prefix + result).prefix(800))
                sendDraft()
            }
        } else { sendDraft() }
    }

    private func sendDraft() {
        dictationActive = false
        speech.stopAll()
        guard model.send(draft, store: store) else { return }
        draft = ""
        hintLevel = 0
        inputFocused = false
    }

    private func scrollToLatest(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("latest", anchor: .bottom) }
    }
}

/// Which partner lines show their Chinese gloss. Lines without one (Live
/// transcripts) are translated once on first tap and saved with the message.
@MainActor
final class BubbleTranslations: ObservableObject {
    @Published private(set) var shown: Set<UUID> = []
    @Published private var loading: Set<UUID> = []
    @Published private var failed: Set<UUID> = []

    func state(of id: UUID) -> MessageBubble.TranslationState {
        loading.contains(id) ? .loading : failed.contains(id) ? .failed : .idle
    }

    func toggle(_ message: PracticeMessage, in scenario: PracticeScenario, save: @escaping (String) -> Void) {
        let id = message.id
        if shown.contains(id) { shown.remove(id); return }
        if MessageBubble.translation(of: message, in: scenario) != nil { shown.insert(id); return }
        guard !loading.contains(id) else { return }
        loading.insert(id)
        failed.remove(id)
        Task {
            do {
                save(try await PracticeAPIClient().translate(message.text))
                shown.insert(id)
            } catch {
                failed.insert(id)
            }
            loading.remove(id)
        }
    }
}

struct MessageBubble: View {
    enum TranslationState { case idle, loading, failed }
    let message: PracticeMessage
    let scenario: PracticeScenario
    var showTranslation = false
    var translationState = TranslationState.idle
    var onTranslate: (() -> Void)? = nil
    var onListen: ((String) -> Void)? = nil

    private var isUser: Bool { message.role == .user }
    private var translation: String? { Self.translation(of: message, in: scenario) }

    static func translation(of message: PracticeMessage, in scenario: PracticeScenario) -> String? {
        message.translation ?? (message.kind == .prompt && scenario.steps.indices.contains(message.stepIndex)
            ? scenario.steps[message.stepIndex].translation : nil)
    }

    private var translateLabel: String {
        switch translationState {
        case .loading: return "翻译中…"
        case .failed: return "翻译失败，重试"
        case .idle: return showTranslation ? "隐藏中文" : "中文"
        }
    }

    var body: some View {
        if isUser {
            VStack(alignment: .trailing, spacing: 4) {
                if message.kind == .retry {
                    Text("再说一次").font(.caption2).foregroundColor(Brand.secondary)
                }
                Text(message.text).font(Brand.english()).foregroundColor(Brand.onInk).lineSpacing(3)
                    .textSelection(.enabled)
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(Brand.ink).clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            }
            .padding(.leading, 48).frame(maxWidth: .infinity, alignment: .trailing)
        } else {
            HStack(alignment: .top, spacing: 8) {
                Avatar(scenario: scenario, size: 28)
                VStack(alignment: .leading, spacing: 2) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(message.text).font(Brand.english()).foregroundColor(Brand.ink).lineSpacing(3)
                            .textSelection(.enabled)
                        if showTranslation, let translation {
                            Text(translation).font(.subheadline).foregroundColor(Brand.secondary).lineSpacing(2)
                        }
                    }
                    .padding(.horizontal, 16).padding(.vertical, 11)
                    .background(Brand.surface).clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    HStack(spacing: 0) {
                        if let onListen {
                            Button { onListen(message.text) } label: {
                                Image(systemName: "speaker.wave.2").frame(width: 40, height: 32)
                            }.accessibilityLabel("朗读")
                        }
                        if let onTranslate {
                            Button(translateLabel, action: onTranslate).frame(height: 32)
                                .disabled(translationState == .loading)
                        }
                    }.font(.caption).foregroundColor(Brand.secondary)
                }
            }
            .padding(.trailing, 32).frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Coaching sits directly under the sentence it is about, like a margin note.
struct FeedbackNote: View {
    @EnvironmentObject private var store: PracticeStore
    let feedback: AIFeedback
    let source: String
    var onListen: ((String) -> Void)? = nil

    var body: some View {
        let saved = store.isSaved(feedback.revised)
        VStack(alignment: .leading, spacing: 10) {
            Text(feedback.note).font(.subheadline).foregroundColor(Brand.ink).lineSpacing(3)
            VStack(alignment: .leading, spacing: 4) {
                Text("更自然的说法").font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                Text(feedback.revised).font(Brand.english(.title3)).foregroundColor(Brand.ink).lineSpacing(3)
                    .textSelection(.enabled)
                Text(feedback.meaning).font(.subheadline).foregroundColor(Brand.secondary)
            }
            if let items = feedback.items, !items.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("已加入词库").font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                    ForEach(items, id: \.text) { item in
                        (Text(item.text).font(Brand.english(.callout)).foregroundColor(Brand.ink)
                            + Text("  \(item.meaning)").font(.footnote).foregroundColor(Brand.secondary))
                    }
                }.accessibilityElement(children: .combine)
            }
            HStack(spacing: 0) {
                if let onListen {
                    Button { onListen(feedback.revised) } label: { Label("听", systemImage: "speaker.wave.2") }
                        .frame(minHeight: 36).padding(.trailing, 16)
                }
                Button { store.toggleExpression(feedback.revised, meaning: feedback.meaning, source: source) } label: {
                    Label(saved ? "已收藏" : "收藏", systemImage: saved ? "bookmark.fill" : "bookmark")
                }
                .foregroundColor(saved ? Brand.accent : Brand.secondary).frame(minHeight: 36)
                .accessibilityIdentifier("save-expression")
                Spacer()
            }.font(.caption.weight(.medium)).foregroundColor(Brand.secondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.surface)
        .overlay(alignment: .leading) { Brand.accent.frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.leading, 36)
    }
}

struct TypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var animating = false
    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { index in
                Circle().fill(Brand.secondary).frame(width: 7, height: 7)
                    .opacity(animating ? 1 : 0.3)
                    .animation(reduceMotion ? nil : .easeInOut(duration: 0.6).repeatForever().delay(Double(index) * 0.2),
                               value: animating)
            }
        }.onAppear { animating = true }
    }
}
