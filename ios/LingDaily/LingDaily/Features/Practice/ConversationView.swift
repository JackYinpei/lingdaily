import Combine
import SwiftUI

struct ConversationView: View {
    @EnvironmentObject private var store: PracticeStore
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.practiceService) private var api
    @StateObject private var speech = SpeechController()
    @StateObject private var model: PracticeViewModel
    @StateObject private var live = LivePracticeController()
    @State private var voiceMode: Bool
    @AppStorage("autoReadAIReplies") private var autoReadReplies = true
    @State private var draft = ""
    @State private var dictationPrefix = ""
    @State private var dictationActive = false
    @State private var submittingDictation = false
    @State private var showsLeaveConfirmation = false
    @State private var hasSavedOnExit = false
    @AppStorage("preferVoicePractice") private var preferVoicePractice = true
    @State private var hintLevel = 0
    @StateObject private var translations = BubbleTranslations()
    @StateObject private var meanings = FeedbackMeanings()
    /// Lines already there when this page opened; 轻松 glosses only the new ones automatically.
    @State private var earlierLines: Set<UUID>
    @FocusState private var inputFocused: Bool
    let onClose: () -> Void
    /// Set when the learner already chose 进入语音通话: the call starts without a second tap.
    private let autoStartVoice: Bool
    @State private var autoStarted = false
    private var session: PracticeSession { model.session }
    private var messageCount: Int { session.messages.count }
    private var lastMessageText: String { session.messages.last?.text ?? "" }
    private var onListen: ((String) -> Void)? { voiceMode ? nil : { text in speech.speak(text) } }
    private var practiceStep: PracticeStep { session.suggestedStep ?? session.step }
    private var isLastStep: Bool { session.stepIndex + 1 == session.scenario.steps.count }

    init(initialSession: PracticeSession, initialVoiceMode: Bool? = nil, autoStartVoice: Bool = false,
         onClose: @escaping () -> Void) {
        self.autoStartVoice = autoStartVoice
        _model = StateObject(wrappedValue: PracticeViewModel(session: initialSession))
        _draft = State(initialValue: initialSession.draft ?? "")
        let preferred = initialVoiceMode ?? (UserDefaults.standard.object(forKey: "preferVoicePractice") as? Bool ?? true)
        _voiceMode = State(initialValue: initialSession.isAI && preferred)
        _earlierLines = State(initialValue: Set(initialSession.messages.map(\.id)))
        self.onClose = onClose
    }

    var body: some View {
        ZStack {
            PageBackground()
            if showsSummary {
                PracticeSummaryView(session: session, onRestart: restart, onClose: onClose)
            } else {
                conversation
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                StorageBanner()
                if !showsSummary { header }
            }
        }
        .onChange(of: speech.transcript) { text in
            guard dictationActive, !voiceMode, !text.isEmpty else { return }
            draft = String((dictationPrefix + text).prefix(800))
        }
        .onChange(of: messageCount) { _ in glossNewLines() }
        .onChange(of: lastMessageText) { _ in glossNewLines() }
        .onChange(of: live.turnFinished) { _ in glossNewLines() }
        .onChange(of: live.state) { _ in glossNewLines() }
        .onChange(of: messageCount) { _ in
            if !voiceMode, autoReadReplies, scenePhase == .active, let last = session.messages.last, last.role == .partner {
                speech.speak(last.text)
            }
        }
        .onChange(of: scenePhase) { phase in
            if phase == .background {
                dictationActive = false; live.stop(); speech.stopAll(); model.pause()
                model.keepDraft(draft); store.save(session)
            }
        }
        .onChange(of: voiceMode) { enabled in
            dictationActive = false; speech.stopAll(); inputFocused = false
            preferVoicePractice = enabled
            if enabled { model.enterLive() }
            else { live.stop(); model.enterText(store: store) }
        }
        .onAppear {
            hasSavedOnExit = false
            glossNewLines()
            if voiceMode {
                model.enterLive()
                if autoStartVoice && !autoStarted && live.state == .disconnected {
                    autoStarted = true
                    live.start(model: model, store: store)
                }
            } else { model.requestPending(store: store) }
        }
        .navigationBack(title: "", requiresConfirmation: live.state != .disconnected, onReturn: saveAndStop, action: requestClose)
        .toolbar { toolbar }
        .alert("离开这次通话？", isPresented: $showsLeaveConfirmation) {
            Button("结束并返回", role: .destructive, action: leavePractice)
            Button("继续练习", role: .cancel) {}
        }
    }

    /// The summary replaces the conversation once it is complete and no call is open. A call
    /// that completed all tasks stays open: the learner may carry on and hangs up when done.
    private var showsSummary: Bool { session.phase == .completed && live.state == .disconnected }

    /// 轻松: each partner line shows its Chinese underneath. Text replies carry their gloss
    /// already; a call's subtitle is translated once the partner's turn is complete. Lines
    /// from before this visit stay as they were (a tap still translates them).
    private func glossNewLines() {
        guard session.practiceLevel == .easy else { return }
        let last = session.messages.last
        let inCall = live.state != .disconnected
        for message in session.messages where message.role == .partner {
            guard !message.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
            let stored = MessageBubble.translation(of: message, in: session.scenario) != nil
            if !stored && earlierLines.contains(message.id) { continue }
            // A subtitle still being spoken would be translated half-way.
            if !stored && message.id == last?.id && inCall && !live.turnFinished { continue }
            translations.showAutomatically(message, in: session.scenario, using: api) { text in
                model.applyTranslation(text, to: message.id, store: store)
            }
        }
    }

    private func requestClose() {
        if live.state != .disconnected { showsLeaveConfirmation = true }
        else { leavePractice() }
    }

    private func leavePractice() {
        saveAndStop()
        onClose()
    }

    private func saveAndStop() {
        guard !hasSavedOnExit else { return }
        hasSavedOnExit = true
        live.stop()
        dictationActive = false
        speech.stopAll()
        model.pause()
        inputFocused = false
        // Native navigation pops and the visible back button both preserve the unsent draft.
        model.keepDraft(draft)
        if session.userTurns > 0 {
            store.save(session)
            // A day with practice gets no "today" reminder.
            ReminderCenter.shared.rescheduleDaily(practicedToday: PracticeStats.spokeToday(store.archive.sessions))
        }
    }

    /// 再练一次 from the summary: same scenario, goal and level; this tap also starts the call.
    private func restart() {
        speech.stopAll()
        draft = ""
        hintLevel = 0
        hasSavedOnExit = false
        let review = UserDefaults.standard.object(forKey: ReviewPicker.enabledKey) as? Bool ?? true
        model.restart(reviewItems: review ? ReviewPicker.pick(from: store.archive, for: session.scenario) : [])
        if voiceMode { live.start(model: model, store: store) } else { model.requestPending(store: store) }
    }

    // MARK: Header — partner and mode live in the navigation bar; one thin progress row below.

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            if !showsSummary {
                HStack(spacing: 8) {
                    Avatar(scenario: session.scenario, size: 28)
                    VStack(alignment: .leading, spacing: 0) {
                        Text(session.scenario.partner).font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                        Text(session.scenario.partnerRole).font(.caption2).foregroundColor(Brand.secondary)
                    }
                }.accessibilityElement(children: .combine)
            }
        }
        ToolbarItemGroup(placement: .navigationBarTrailing) {
            if session.phase != .completed {
                if !voiceMode {
                    Button {
                        autoReadReplies.toggle()
                        if !autoReadReplies { speech.stopAll() }
                    } label: {
                        Image(systemName: autoReadReplies ? "speaker.wave.2" : "speaker.slash").foregroundColor(Brand.ink)
                    }.accessibilityLabel(autoReadReplies ? "关闭自动朗读" : "开启自动朗读")
                }
                Picker("对话模式", selection: $voiceMode) {
                    Image(systemName: "keyboard").accessibilityLabel("文字").tag(false)
                    Image(systemName: "phone").accessibilityLabel("语音通话").tag(true)
                }
                .pickerStyle(.segmented).frame(width: 88)
                .accessibilityIdentifier("conversation-mode")
            }
        }
    }

    /// 任务进度: one mark per task (done, current, to come) and what the current one asks for.
    /// Once all are done in a call, the conversation goes on until the learner hangs up.
    private var header: some View {
        let total = session.scenario.steps.count
        let done = session.completedSteps
        let allDone = session.phase == .completed
        return HStack(spacing: 6) {
            ForEach(0..<total, id: \.self) { index in
                let finished = index < done
                let current = !finished && index == session.stepIndex
                ZStack {
                    Circle().fill(finished ? Brand.ink : Color.clear)
                    Circle().stroke(finished ? Brand.ink : (current ? Brand.accent : Brand.line), lineWidth: 1.5)
                    if finished {
                        Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundColor(Brand.onInk)
                    } else {
                        Text(String(index + 1)).font(.caption2.weight(.medium)).foregroundColor(current ? Brand.accent : Brand.secondary)
                    }
                }
                .frame(width: 20, height: 20)
            }
            Text(allDone ? "任务都完成了，想聊就接着聊，挂断看总结" : session.step.goal)
                .font(.caption.weight(.medium)).foregroundColor(allDone ? Brand.ink : Brand.secondary).lineLimit(1)
                .padding(.leading, 4)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(allDone ? "任务全部完成" : "任务 \(session.stepIndex + 1)/\(total)：\(session.step.goal)")
        .accessibilityIdentifier("task-progress")
        .padding(.horizontal, 20).padding(.vertical, 8)
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
                    steps
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

    /// The goals of this conversation, shown once at its start (they used to sit on the preparation page).
    private var steps: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("这次要说到").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
            ForEach(Array(session.scenario.steps.enumerated()), id: \.element.id) { index, step in
                let done = index < session.stepIndex || session.phase == .completed
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    Text(String(index + 1)).font(.footnote.weight(.semibold).monospacedDigit())
                        .foregroundColor(Brand.secondary).frame(width: 16)
                    Text(step.goal).font(.footnote).foregroundColor(done ? Brand.secondary : Brand.ink)
                }
            }
        }
        .padding(18).frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.surface)
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(Brand.line, lineWidth: 1))
        .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("conversation-steps")
    }

    private var transcriptRows: some View {
                    ForEach(session.messages) { message in
                        MessageBubble(message: message, scenario: session.scenario,
                                      showTranslation: translations.shown.contains(message.id),
                                      translationState: translations.state(of: message.id),
                                      onTranslate: {
                                          translations.toggle(message, in: session.scenario, using: api) { text in
                                              model.applyTranslation(text, to: message.id, store: store)
                                          }
                                      },
                                      onListen: onListen)
                        if let feedback = session.feedback(for: message.id) {
                            FeedbackNote(feedback: feedback, source: session.scenario.title, onListen: onListen,
                                         meaningLoading: meanings.loading.contains(message.id)) {
                                meanings.fill(message.id, revised: feedback.revised, using: api) { meaning in
                                    model.applyFeedbackMeaning(meaning, to: message.id, store: store)
                                    store.fillMeaning(of: feedback.revised, with: meaning)
                                }
                            }
                        }
                    }
    }

    private var voiceControls: some View {
        VStack(spacing: 10) {
            if let suggestion = live.suggestion {
                LiveSuggestionCard(suggestion: suggestion, partner: session.scenario.partner) { live.dismissSuggestion() }
            }
            HStack(spacing: 12) {
                if !live.status.isEmpty {
                    Text(live.status).font(.caption.weight(.medium)).foregroundColor(Brand.secondary)
                        .accessibilityIdentifier("live-status")
                }
                if live.state == .active && live.playing {
                    // On the loudspeaker this is how to talk over the partner without echo.
                    Button { live.interruptPartner() } label: {
                        Label("打断", systemImage: "hand.raised").font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .overlay(Capsule().stroke(Brand.ink, lineWidth: 1.5))
                    }
                    .foregroundColor(Brand.ink).accessibilityIdentifier("live-interrupt")
                } else if live.state == .active && live.suggestion == nil {
                    Button(live.suggesting ? "正在想…" : "卡住了？") { live.requestSuggestion() }
                        .font(.subheadline.weight(.medium)).foregroundColor(Brand.accent)
                        .frame(minHeight: 44).disabled(live.suggesting)
                        .accessibilityIdentifier("live-suggest")
                }
            }
            if let message = live.suggestionError ?? live.errorMessage {
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
                Text("正在听写").font(.caption2).foregroundColor(Brand.accent)
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

/// Help when the learner is stuck in a call: the idea in Chinese first, the
/// English model answer only on request, so the learner still forms the sentence.
struct LiveSuggestionCard: View {
    let suggestion: LiveSuggestion
    let partner: String
    let onDismiss: () -> Void
    @State private var showsReply = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("可以这样回应 \(partner)").font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                Spacer(minLength: 8)
                Button(action: onDismiss) { Image(systemName: "xmark").frame(width: 32, height: 32) }
                    .font(.caption).foregroundColor(Brand.secondary).accessibilityLabel("收起建议")
            }
            Text(suggestion.hint).font(.subheadline).foregroundColor(Brand.ink).lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            Text(suggestion.keywords).font(.caption).foregroundColor(Brand.secondary)
            if showsReply {
                VStack(alignment: .leading, spacing: 4) {
                    Text(suggestion.reply).font(Brand.english(.body)).foregroundColor(Brand.ink).lineSpacing(3)
                        .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                    Text(suggestion.meaning).font(.caption).foregroundColor(Brand.secondary)
                }
            } else {
                Button("看参考说法") { showsReply = true }
                    .font(.caption.weight(.medium)).foregroundColor(Brand.ink).frame(minHeight: 32)
                    .accessibilityIdentifier("live-suggestion-reply")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Brand.surface)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
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

    private var autoShown: Set<UUID> = []

    /// 轻松: opens the gloss of a finished partner line without a tap, once per line,
    /// so a gloss the learner closed stays closed.
    func showAutomatically(_ message: PracticeMessage, in scenario: PracticeScenario, using api: any PracticeServing,
                           save: @escaping (String) -> Void) {
        guard !shown.contains(message.id), autoShown.insert(message.id).inserted else { return }
        toggle(message, in: scenario, using: api, save: save)
    }

    func toggle(_ message: PracticeMessage, in scenario: PracticeScenario, using api: any PracticeServing,
                save: @escaping (String) -> Void) {
        let id = message.id
        if shown.contains(id) { shown.remove(id); return }
        if MessageBubble.translation(of: message, in: scenario) != nil { shown.insert(id); return }
        guard !loading.contains(id) else { return }
        loading.insert(id)
        failed.remove(id)
        Task {
            do {
                save(try await api.translate(message.text))
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
    var meaningLoading = false
    /// Live notes arrive without Chinese; asked for once when the note appears.
    var onNeedsMeaning: (() -> Void)? = nil

    var body: some View {
        let saved = store.isSaved(feedback.revised)
        VStack(alignment: .leading, spacing: 10) {
            Text(feedback.note).font(.subheadline).foregroundColor(Brand.ink).lineSpacing(3)
            VStack(alignment: .leading, spacing: 4) {
                Text("更自然的说法").font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                Text(feedback.revised).font(Brand.english(.title3)).foregroundColor(Brand.ink).lineSpacing(3)
                    .textSelection(.enabled)
                if !feedback.meaning.isEmpty {
                    Text(feedback.meaning).font(.subheadline).foregroundColor(Brand.secondary)
                } else if meaningLoading {
                    Text("正在翻译…").font(.caption).foregroundColor(Brand.secondary)
                }
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
        .task { if feedback.meaning.isEmpty { onNeedsMeaning?() } }
    }
}

/// Chinese for Live notes, translated once per note when a text model is configured.
@MainActor
final class FeedbackMeanings: ObservableObject {
    @Published private(set) var loading: Set<UUID> = []
    private var attempted: Set<UUID> = []

    func fill(_ id: UUID, revised: String, using api: any PracticeServing, save: @escaping (String) -> Void) {
        guard (AISettingsKeychain.load() ?? AISettings()).resolvedText != nil,
              attempted.insert(id).inserted else { return }
        loading.insert(id)
        Task {
            if let meaning = try? await api.translate(revised) { save(meaning) }
            loading.remove(id)
        }
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
