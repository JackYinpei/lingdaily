import SwiftUI

struct PracticeSummaryView: View {
    @EnvironmentObject private var store: PracticeStore
    let session: PracticeSession
    let onClose: () -> Void

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                VStack(alignment: .leading, spacing: 14) {
                    Avatar(scenario: session.scenario, size: 56)
                    Text("和 \(session.scenario.partner) 的这场对话，\n你说完了。")
                        .font(.title.bold()).foregroundColor(Brand.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Text("\(session.completedSteps) 个任务 · 开口 \(session.userTurns) 次 · 重说 \(session.retryCount) 次")
                        .font(.subheadline).foregroundColor(Brand.inkOnTone)
                }
                .padding(22).frame(maxWidth: .infinity, alignment: .leading)
                .background(Brand.tone(session.scenario.id))
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                if !session.takeaways.isEmpty {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("带走这几句").font(.headline).foregroundColor(Brand.ink)
                        ForEach(session.takeaways) { step in
                            let saved = store.isSaved(step.expression)
                            HStack(alignment: .top, spacing: 12) {
                                VStack(alignment: .leading, spacing: 6) {
                                    Text(step.goal).font(.caption).foregroundColor(Brand.secondary)
                                    Text(step.expression).font(Brand.english(.title3)).foregroundColor(Brand.ink)
                                        .lineSpacing(3).textSelection(.enabled)
                                    Text(step.meaning).font(.subheadline).foregroundColor(Brand.secondary)
                                }.frame(maxWidth: .infinity, alignment: .leading)
                                Button {
                                    store.toggleExpression(step.expression, meaning: step.meaning, source: session.scenario.title)
                                } label: {
                                    Image(systemName: saved ? "bookmark.fill" : "bookmark").font(.body)
                                        .foregroundColor(saved ? Brand.accent : Brand.secondary)
                                        .frame(width: 44, height: 44)
                                }.accessibilityLabel(saved ? "取消收藏" : "收藏")
                            }.surfaceCard(padding: 16)
                        }
                    }
                }
            }
            .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 24)
            .readableColumn()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Button("完成") { onClose() }
                .buttonStyle(SolidButtonStyle()).accessibilityIdentifier("finish-rehearsal")
                .padding(.horizontal, 20).padding(.vertical, 12)
                .readableColumn().background(Brand.page)
        }
    }
}
