import SwiftUI

struct LearningView: View {
    @EnvironmentObject private var store: PracticeStore
    @StateObject private var speech = SpeechController()
    @State private var section = 0
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationView {
            ZStack {
                PageBackground()
                // A List (not a ScrollView) so practice records get the system swipe-to-delete.
                List {
                    VStack(alignment: .leading, spacing: 20) {
                        PageTitle(title: "学习",
                                  subtitle: "练习 \(store.archive.sessions.count) 次 · 词库 \(store.archive.expressions.count) 条")
                        Picker("学习内容", selection: $section) {
                            Text("练习记录").tag(0)
                            Text("词库").tag(1)
                        }.pickerStyle(.segmented).accessibilityIdentifier("learning-sections")
                    }
                    .padding(.top, 20).padding(.bottom, 4)
                    .pageRow()
                    if section == 0 { sessions } else { expressions }
                    Color.clear.frame(height: 24).pageRow()
                }
                .listStyle(.plain)
                .clearListBackground()
            }
            .navigationTitle("学习").navigationBarHidden(true)
        }.navigationViewStyle(.stack)
            .onDisappear { speech.stopAll() }
            .onChange(of: section) { _ in speech.stopAll() }
            .onChange(of: scenePhase) { if $0 != .active { speech.stopAll() } }
    }

    @ViewBuilder private var sessions: some View {
        if store.archive.sessions.isEmpty {
            EmptyState(title: "还没有练习记录", message: "去「练习」选一位对话对象。\n说出第一句后，记录会出现在这里。").pageRow()
        } else {
            ForEach(store.archive.sessions) { session in
                HStack(spacing: 14) {
                    Avatar(scenario: session.scenario, size: 40)
                    VStack(alignment: .leading, spacing: 4) {
                        Text(session.title).font(.headline).foregroundColor(Brand.ink)
                            .multilineTextAlignment(.leading).lineLimit(2)
                        Text("\(session.scenario.partner) · \(Self.date(session.updatedAt)) · 开口 \(session.userTurns) 次")
                            .font(.caption).foregroundColor(Brand.secondary)
                    }
                    Spacer(minLength: 8)
                    Text(session.phase == .completed ? "已完成" : "未完成")
                        .font(.caption.weight(.medium))
                        .foregroundColor(session.phase == .completed ? Brand.secondary : Brand.accent)
                }
                .padding(.vertical, 14).contentShape(Rectangle())
                .overlay(alignment: .bottom) {
                    if session.id != store.archive.sessions.last?.id {
                        Brand.line.frame(height: 1).padding(.leading, 54)
                    }
                }
                // Hidden link: the whole row navigates without the system disclosure chevron.
                .background(NavigationLink { SessionDetailView(initialSession: session) } label: { EmptyView() }.opacity(0))
                .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                    Button(role: .destructive) { store.removeSession(session.id) } label: { Label("删除", systemImage: "trash") }
                }
                .pageRow()
            }
        }
    }

    @ViewBuilder private var expressions: some View {
        if store.archive.expressions.isEmpty {
            EmptyState(title: "词库还是空的", message: "对话中你没掌握的词和短语会自动收进来，\n想记住的整句可以点「收藏」。").pageRow()
        } else {
            if let error = speech.errorMessage {
                Text(error).font(.caption).foregroundColor(Brand.secondary).pageRow()
            }
            ForEach(store.archive.expressions) { expression in
                VStack(alignment: .leading, spacing: 8) {
                    Text(expression.text).font(Brand.english(.title3)).foregroundColor(Brand.ink)
                        .lineSpacing(3).textSelection(.enabled)
                    Text(expression.meaning).font(.subheadline).foregroundColor(Brand.secondary)
                    HStack(spacing: 0) {
                        Text("\(Self.kindLabel(expression.kind)) · \(expression.source)").font(.caption).foregroundColor(Brand.secondary)
                        Spacer()
                        Button { speech.speak(expression.text) } label: {
                            Image(systemName: "speaker.wave.2").frame(width: 44, height: 36)
                        }.foregroundColor(Brand.secondary).accessibilityLabel("朗读")
                        Button { store.removeExpression(expression.id) } label: {
                            Image(systemName: "bookmark.fill").frame(width: 44, height: 36)
                        }.foregroundColor(Brand.accent).accessibilityLabel("移出词库")
                    }
                    // In a List row, borderless buttons fire on their own instead of the whole row.
                    .buttonStyle(.borderless)
                }
                .surfaceCard(padding: 16)
                .padding(.vertical, 6)
                .pageRow()
            }
        }
    }

    static func kindLabel(_ kind: String?) -> String {
        switch kind {
        case "word": return "单词"
        case "phrase": return "短语"
        case "grammar": return "语法"
        case "other": return "其他"
        default: return "句子"
        }
    }

    static func date(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "zh_CN")
        formatter.dateFormat = Calendar.current.isDate(date, equalTo: Date(), toGranularity: .year) ? "M月d日" : "yyyy年M月d日"
        return formatter.string(from: date)
    }
}

struct SessionDetailView: View {
    @EnvironmentObject private var store: PracticeStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var speech = SpeechController()
    @State private var activeSession: PracticeSession?
    @StateObject private var translations = BubbleTranslations()
    @State private var showDelete = false
    @State private var showReview = false
    let initialSession: PracticeSession
    private var session: PracticeSession {
        store.archive.sessions.first { $0.id == initialSession.id } ?? initialSession
    }
    private var startsNew: Bool { !session.isAI || session.phase == .completed }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    HStack(spacing: 14) {
                        Avatar(scenario: session.scenario, size: 48)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(session.title).font(.title3.bold()).foregroundColor(Brand.ink)
                            Text("\(session.scenario.partner) · \(LearningView.date(session.createdAt)) · 开口 \(session.userTurns) 次 · 重说 \(session.retryCount) 次")
                                .font(.caption).foregroundColor(Brand.secondary)
                        }
                    }.padding(.bottom, 8)
                    ForEach(session.messages) { message in
                        MessageBubble(message: message, scenario: session.scenario,
                                      showTranslation: translations.shown.contains(message.id),
                                      translationState: translations.state(of: message.id),
                                      onTranslate: {
                                          translations.toggle(message, in: session.scenario) { text in
                                              var updated = session
                                              guard updated.applyTranslation(text, to: message.id) else { return }
                                              store.save(updated)
                                          }
                                      },
                                      onListen: speech.speak)
                        if let feedback = session.feedback(for: message.id) {
                            FeedbackNote(feedback: feedback, source: session.scenario.title, onListen: speech.speak)
                        }
                    }
                }
                .padding(.horizontal, 16).padding(.vertical, 20)
                .readableColumn()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 10) {
                Button(startsNew ? "再练一次" : "继续这次对话") {
                    speech.stopAll()
                    activeSession = startsNew
                        ? PracticeSession(scenario: session.scenario, goal: session.personalGoal, context: session.context, useAI: true)
                        : session
                }
                .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("resume-rehearsal")
                if session.phase == .completed {
                    Button("复盘") { speech.stopAll(); showReview = true }
                        .buttonStyle(SolidButtonStyle(secondary: true)).accessibilityIdentifier("review-rehearsal")
                }
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .readableColumn().background(Brand.page)
        }
        .navigationTitle(session.scenario.title).navigationBarTitleDisplayMode(.inline).navigationBarHidden(false)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Button { showDelete = true } label: { Image(systemName: "trash") }
                    .foregroundColor(Brand.secondary).accessibilityLabel("删除这次练习")
            }
        }
        .alert("删除这次练习？", isPresented: $showDelete) {
            Button("删除", role: .destructive) { store.removeSession(session.id); dismiss() }
            Button("取消", role: .cancel) {}
        } message: { Text("删除后不能恢复。收藏的句子会保留。") }
        .onDisappear { speech.stopAll() }
        .fullScreenCover(item: $activeSession) { session in
            ConversationView(initialSession: session, onClose: { activeSession = nil })
        }
        .fullScreenCover(isPresented: $showReview) {
            ZStack {
                PageBackground()
                PracticeSummaryView(session: session, onClose: { showReview = false })
            }
        }
    }
}

private extension View {
    /// A list row that looks like the rest of the app: page margins, no separator, no row background.
    func pageRow() -> some View {
        listRowInsets(EdgeInsets(top: 0, leading: 20, bottom: 0, trailing: 20))
            .listRowSeparator(.hidden)
            .listRowBackground(Color.clear)
            .readableColumn()
    }

    @ViewBuilder func clearListBackground() -> some View {
        if #available(iOS 16.0, *) { scrollContentBackground(.hidden) }
        else { onAppear { UITableView.appearance().backgroundColor = .clear } }
    }
}
