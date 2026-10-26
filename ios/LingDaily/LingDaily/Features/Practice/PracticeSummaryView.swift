import SwiftUI

struct PracticeSummaryView: View {
    @EnvironmentObject private var store: PracticeStore
    let session: PracticeSession
    /// 再练一次 straight from here; nil where the page only reviews a past rehearsal.
    var onRestart: (() -> Void)? = nil
    let onClose: () -> Void

    private var newWords: [AILearningItem] { session.collectedItems }
    private var reused: [ReviewTarget] { session.reusedReviewItems }

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
                if !session.summaryLines.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("带走这几句").font(.headline).foregroundColor(Brand.ink)
                        ForEach(session.summaryLines) { line in takeaway(line) }
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
    }

    private func takeaway(_ line: SummaryLine) -> some View {
        let saved = store.isSaved(line.text)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                Text(line.isOwnWords ? "\(line.goal) · 你说的" : line.goal).font(.caption).foregroundColor(Brand.secondary)
                Text(line.text).font(Brand.english(.title3)).foregroundColor(Brand.ink)
                    .lineSpacing(3).lineLimit(6).textSelection(.enabled)
                if !line.meaning.isEmpty {
                    Text(line.meaning).font(.subheadline).foregroundColor(Brand.secondary)
                }
            }.frame(maxWidth: .infinity, alignment: .leading)
            Button {
                store.toggleExpression(line.text, meaning: line.meaning, source: session.scenario.title)
            } label: {
                Image(systemName: saved ? "bookmark.fill" : "bookmark").font(.body)
                    .foregroundColor(saved ? Brand.accent : Brand.secondary)
                    .frame(width: 44, height: 44)
            }.accessibilityLabel(saved ? "取消收藏" : "收藏")
        }.surfaceCard(padding: 16)
    }
}
