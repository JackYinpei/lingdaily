import SwiftUI

/// One thing to recall: the learner sees the Chinese and says (or types) the English.
struct ReviewCard: Identifiable, Equatable {
    let id: String
    let text: String
    let meaning: String
    let label: String
}

/// Active recall without a model call: device dictation plus a word match. It reports what
/// was heard and whether the expression was in it — never a pronunciation score.
struct ReviewView: View {
    let title: String
    let cards: [ReviewCard]
    /// Called once per card with whether the learner produced it (词库 keeps a local log).
    var onResult: ((ReviewCard, Bool) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var speech = SpeechController()
    @State private var index = 0
    @State private var answer = ""
    @State private var attempt: String?
    @State private var revealed = false
    @State private var recalled = 0
    @State private var dictating = false
    @FocusState private var inputFocused: Bool

    private var card: ReviewCard? { cards.indices.contains(index) ? cards[index] : nil }
    private var finished: Bool { index >= cards.count }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if let card { prompt(card) } else { done }
                }
                .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 24)
                .readableColumn()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Group {
                if finished {
                    Button("完成") { dismiss() }.buttonStyle(SolidButtonStyle()).accessibilityIdentifier("review-done")
                } else if revealed {
                    Button(index + 1 == cards.count ? "看看结果" : "下一个", action: next)
                        .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("review-next")
                } else {
                    composer
                }
            }
            .padding(.horizontal, 16).padding(.vertical, 12)
            .readableColumn().background(Brand.page)
        }
        .navigationBack(title: title) { dismiss() }
        .onChange(of: speech.transcript) { text in if dictating, !text.isEmpty { answer = String(text.prefix(300)) } }
        .onChange(of: scenePhase) { if $0 != .active { dictating = false; speech.stopAll() } }
        .onDisappear { speech.stopAll() }
    }

    private func prompt(_ card: ReviewCard) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack {
                Text(card.label).font(.caption).foregroundColor(Brand.secondary).lineLimit(1)
                Spacer(minLength: 8)
                Text("\(index + 1) / \(cards.count)").font(.caption.monospacedDigit()).foregroundColor(Brand.secondary)
            }
            StepProgress(current: index, total: cards.count)
            VStack(alignment: .leading, spacing: 8) {
                Text("用英语怎么说？").font(.subheadline).foregroundColor(Brand.secondary)
                Text(card.meaning).font(.title2.bold()).foregroundColor(Brand.ink)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if revealed {
                VStack(alignment: .leading, spacing: 14) {
                    if let attempt {
                        let ok = RecallMatcher.matches(target: card.text, heard: attempt)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(ok ? "说出来了" : "和原句有点不同").font(.caption.weight(.semibold))
                                .foregroundColor(ok ? Brand.accent : Brand.secondary)
                            Text(attempt).font(Brand.english(.body)).foregroundColor(Brand.ink).lineSpacing(3)
                        }.accessibilityIdentifier("review-attempt")
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        Text("原句").font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                        Text(card.text).font(Brand.english(.title3)).foregroundColor(Brand.ink).lineSpacing(3)
                            .textSelection(.enabled)
                        Button { speech.speak(card.text) } label: { Label("听", systemImage: "speaker.wave.2") }
                            .font(.caption.weight(.medium)).foregroundColor(Brand.secondary).frame(minHeight: 44)
                    }
                }
                .padding(16).frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.surface)
                .overlay(alignment: .leading) { Brand.accent.frame(width: 3) }
                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            if let error = speech.errorMessage {
                Text(error).font(.caption).foregroundColor(Brand.secondary)
            }
        }
    }

    private var done: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("过完了").font(.title.bold()).foregroundColor(Brand.ink)
            Text("说出来 \(recalled) / \(cards.count) 个").font(.subheadline).foregroundColor(Brand.secondary)
                .accessibilityIdentifier("review-result")
        }
    }

    /// Same pattern as the conversation composer: dictation, typing, send; or just look.
    private var composer: some View {
        VStack(spacing: 8) {
            HStack(spacing: 8) {
                Button(action: toggleDictation) {
                    Image(systemName: speech.isRecording ? "stop.fill" : "mic")
                        .font(.body.weight(.semibold)).frame(width: 44, height: 44)
                        .foregroundColor(speech.isRecording ? Brand.onInk : Brand.ink)
                        .background(speech.isRecording ? Brand.accent : Brand.surface)
                        .overlay(Circle().stroke(Brand.line, lineWidth: speech.isRecording ? 0 : 1))
                        .clipShape(Circle())
                }
                .disabled(speech.isRequestingPermission || speech.isFinalizing)
                .accessibilityLabel(speech.isRecording ? "停止听写" : "开始英语听写")
                HStack(spacing: 4) {
                    TextField("说出或写出英文…", text: $answer)
                        .font(.body).padding(.leading, 16).frame(minHeight: 44).focused($inputFocused)
                        .submitLabel(.done).onSubmit(submit).disableAutocorrection(true)
                        .accessibilityIdentifier("review-input")
                    Button(action: submit) {
                        Image(systemName: "arrow.up").font(.subheadline.weight(.bold)).foregroundColor(Brand.onInk)
                            .frame(width: 34, height: 34).background(Brand.ink).clipShape(Circle())
                            .frame(width: 44, height: 44)
                    }
                    .disabled(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                    .opacity(answer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0.25 : 1)
                    .accessibilityLabel("对一下").accessibilityIdentifier("review-submit")
                }
                .background(Brand.surface).clipShape(Capsule()).overlay(Capsule().stroke(Brand.line))
            }
            Button("想不起来，看答案") { reveal(with: nil) }
                .font(.subheadline).foregroundColor(Brand.secondary).frame(minHeight: 44)
                .accessibilityIdentifier("review-reveal")
        }
    }

    private func toggleDictation() {
        inputFocused = false
        if speech.isRecording {
            Task {
                let text = await speech.finishRecording()
                dictating = false
                if !text.isEmpty { answer = String(text.prefix(300)) }
            }
        } else {
            answer = ""
            dictating = true
            Task {
                guard dictating, scenePhase == .active else { return }
                await speech.startRecording(maxCharacters: 300)
            }
        }
    }

    private func submit() {
        let text = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        if speech.isRecording {
            Task {
                let heard = await speech.finishRecording()
                dictating = false
                reveal(with: heard.isEmpty ? text : String(heard.prefix(300)))
            }
        } else { reveal(with: text) }
    }

    private func reveal(with attempt: String?) {
        guard let card, !revealed else { return }
        dictating = false
        speech.stopAll()
        inputFocused = false
        self.attempt = attempt
        let ok = attempt.map { RecallMatcher.matches(target: card.text, heard: $0) } ?? false
        if ok { recalled += 1 }
        onResult?(card, ok)
        revealed = true
    }

    private func next() {
        speech.stopAll()
        index += 1
        answer = ""
        attempt = nil
        revealed = false
    }
}

extension ReviewLog {
    private static let key = "reviewLog"

    static func load(defaults: UserDefaults = .standard) -> ReviewLog {
        defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(ReviewLog.self, from: $0) } ?? ReviewLog()
    }

    func save(defaults: UserDefaults = .standard) {
        if let data = try? JSONEncoder().encode(self) { defaults.set(data, forKey: Self.key) }
    }

    /// Sign-out: another account's review history must not carry over.
    static func clear(defaults: UserDefaults = .standard) { defaults.removeObject(forKey: key) }
}
