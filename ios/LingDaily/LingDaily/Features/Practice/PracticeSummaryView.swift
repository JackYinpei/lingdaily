import SwiftUI

struct PracticeSummaryView: View {
    @EnvironmentObject private var store: PracticeStore
    @EnvironmentObject private var account: AccountStore
    @AppStorage(AIDataConsent.key) private var consentVersion = ""
    @State private var reviewing = false
    @State private var reviewError: String?
    @State private var reviewAttempt = 0
    @State private var reviewGeneration = UUID()
    let session: PracticeSession
    /// 再练一次 straight from here; nil where the page only reviews a past rehearsal.
    var onRestart: (() -> Void)? = nil
    let onClose: () -> Void

    private var newWords: [AILearningItem] { session.collectedItems }
    private var reused: [ReviewTarget] { session.reusedReviewItems }
    private var reviewedSession: PracticeSession { store.archive.sessions.first { $0.id == session.id } ?? session }
    private var reviewTaskID: String { "\(session.id)-\(account.session?.userID ?? "local")-\(consentVersion)-\(reviewAttempt)" }

    /// Facts only: tasks, turns, retries and new words; zero counts are left out.
    private var facts: String {
        var parts = ["\(session.completedSteps) 个任务", "开口 \(session.userTurns) 次"]
        if session.retryCount > 0 { parts.append("重说 \(session.retryCount) 次") }
        if !newWords.isEmpty { parts.append("新词 \(newWords.count) 个") }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 14) {
                    Avatar(scenario: session.scenario, size: 56)
                    Text("和 \(session.scenario.partner) 的这场对话，\n你说完了。")
                        .font(.title.bold()).foregroundColor(Brand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(facts).font(.subheadline).foregroundColor(Brand.inkOnTone)
                }
                .padding(22).frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.tone(session.scenario.id))
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                if !reused.isEmpty {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("这次你用上了").font(.headline).foregroundColor(Brand.ink)
                        ForEach(reused, id: \.self) { item in
                            HStack(alignment: .firstTextBaseline, spacing: 10) {
                                Image(systemName: "checkmark").font(.caption.weight(.bold)).foregroundColor(Brand.accent)
                                (Text(item.text).font(Brand.english(.body)).foregroundColor(Brand.ink)
                                    + Text("  \(item.meaning)").font(.footnote).foregroundColor(Brand.secondary))
                            }
                        }
                    }.accessibilityElement(children: .combine).accessibilityIdentifier("summary-reused")
                }
                if !reviewedSession.summaryLines.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("带走这几句").font(.headline).foregroundColor(Brand.ink)
                        Text("你说的全部 \(reviewedSession.learnerMessages.count) 句，按对话顺序保留。")
                            .font(.caption).foregroundColor(Brand.secondary)
                        if reviewing {
                            HStack(spacing: 8) {
                                ProgressView()
                                Text("正在整理更自然的说法…").font(.caption).foregroundColor(Brand.secondary)
                            }.accessibilityIdentifier("summary-review-loading")
                        }
                        if let reviewError {
                            Text(reviewError).font(.caption).foregroundColor(Brand.secondary)
                            Button("重试表达建议") { reviewAttempt += 1 }
                                .buttonStyle(SolidButtonStyle(secondary: true)).accessibilityIdentifier("retry-sentence-review")
                        } else if !AIDataConsent.isGranted(), reviewedSession.nextSentenceReview != nil {
                            Text("允许 AI 数据使用后，可为这些原话整理表达建议。")
                                .font(.caption).foregroundColor(Brand.secondary)
                        }
                        ForEach(reviewedSession.summaryLines) { line in takeaway(line) }
                    }
                }
                if !newWords.isEmpty {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("新进词库").font(.headline).foregroundColor(Brand.ink)
                        ForEach(newWords, id: \.text) { item in
                            (Text(item.text).font(Brand.english(.callout)).foregroundColor(Brand.ink)
                                + Text("  \(item.meaning)").font(.footnote).foregroundColor(Brand.secondary))
                        }
                    }.accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 24)
            .readableColumn()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            HStack(spacing: 10) {
                if let onRestart {
                    Button("再练一次", action: onRestart)
                        .buttonStyle(SolidButtonStyle(secondary: true)).accessibilityIdentifier("restart-rehearsal")
                }
                Button("完成") { onClose() }
                    .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("finish-rehearsal")
            }
            .padding(.horizontal, 20).padding(.vertical, 12)
            .readableColumn().background(Brand.page)
        }
        .task(id: reviewTaskID) { await reviewSentences() }
    }

    @MainActor
    private func reviewSentences() async {
        let generation = UUID()
        reviewGeneration = generation
        reviewing = false; reviewError = nil
        guard account.canPractice, AIDataConsent.isGranted(), reviewedSession.nextSentenceReview != nil else { return }
        let owner = account.session?.userID
        reviewing = true
        defer { if reviewGeneration == generation { reviewing = false } }
        do {
            while let request = reviewedSession.nextSentenceReview {
                try Task.checkCancellation()
                guard account.canPractice, account.session?.userID == owner, AIDataConsent.isGranted() else { return }
                let records = try await PracticeAPIClient().reviewSentences(request)
                try Task.checkCancellation()
                guard account.canPractice, account.session?.userID == owner, AIDataConsent.isGranted(),
                      var latest = store.archive.sessions.first(where: { $0.id == session.id }) else { return }
                guard latest.applySentenceReviews(records) else { throw PracticeNetworkError.invalidReply }
                store.save(latest)
            }
        } catch is CancellationError { }
        catch {
            guard !Task.isCancelled, account.session?.userID == owner else { return }
            reviewError = "表达建议暂时没有整理完，所有原话都已保留。\(error.localizedDescription)"
        }
    }

    private func takeaway(_ line: SummaryLine) -> some View {
        let saved = store.isSaved(line.text)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(line.goal) · 你说的").font(.caption).foregroundColor(Brand.secondary)
                Text(line.original).font(Brand.english(.title3)).foregroundColor(Brand.ink)
                    .lineSpacing(3).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                if !line.isOwnWords {
                    Text("更自然的说法").font(.caption.weight(.medium)).foregroundColor(Brand.accent).padding(.top, 6)
                    Text(line.text).font(Brand.english(.title3)).foregroundColor(Brand.ink)
                        .lineSpacing(3).fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                }
                if !line.meaning.isEmpty {
                    Text(line.meaning).font(.subheadline).foregroundColor(Brand.secondary)
                }
                if !line.note.isEmpty { Text(line.note).font(.caption).foregroundColor(Brand.secondary) }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button {
                store.toggleExpression(line.text, meaning: line.meaning, source: session.scenario.title)
            } label: {
                Image(systemName: saved ? "bookmark.fill" : "bookmark").font(.body)
                    .foregroundColor(saved ? Brand.accent : Brand.secondary)
                    .frame(width: 44, height: 44)
            }.buttonStyle(.plain)
                .accessibilityLabel(saved ? "取消收藏" : (line.isOwnWords ? "收藏原句" : "收藏更自然的说法"))
        }.surfaceCard(padding: 16).accessibilityIdentifier("summary-line-\(line.id)")
    }
}
