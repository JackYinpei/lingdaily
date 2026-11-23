import SwiftUI

/// First run, and 「我的 → 练习偏好」: why the learner practises and which speaking moments
/// they find hard. Two short multi-choice pages; skipping keeps the catalog order.
struct InterestOnboardingView: View {
    /// From 我的: one page with both questions and a save button, no skip.
    var editing = false
    var onFinish: () -> Void = {}
    @Environment(\.dismiss) private var dismiss
    @State private var picks = Set(LearnerInterests.picks())
    @State private var page = 0

    var body: some View {
        if editing {
            content.navigationBack(title: "练习偏好") { dismiss() }
        } else {
            content.interactiveDismissDisabled()
        }
    }

    private var content: some View {
        ZStack(alignment: .topTrailing) {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    if editing {
                        PageTitle(title: "你想练什么", subtitle: "首页会把适合你的场景排在前面，「换一批」也会按这里出题。")
                        section(title: "你练英语，主要为了什么？", options: LearnerInterest.goals)
                        section(title: "开口时，你最怕哪种场面？", options: LearnerInterest.fears)
                    } else if page == 0 {
                        PageTitle(title: "你练英语，主要为了什么？", subtitle: "可以多选。我们先把这些场合的对话放在前面。")
                        options(LearnerInterest.goals)
                    } else {
                        PageTitle(title: "开口时，你最怕哪种场面？", subtitle: "可以多选。我们会多安排这样的人陪你练。")
                        options(LearnerInterest.fears)
                    }
                }
                .padding(.horizontal, 24).padding(.top, editing ? 20 : 56).padding(.bottom, 24)
                .readableColumn()
            }
            if !editing {
                Button("跳过") { finish(saving: false) }
                    .font(.subheadline).foregroundColor(Brand.secondary)
                    .padding(.horizontal, 20).frame(minHeight: 44)
                    .accessibilityIdentifier("skip-interests")
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Button(editing ? "保存" : page == 0 ? "下一步" : "开始练习") {
                if !editing && page == 0 {
                    withAnimation(.easeOut(duration: 0.2)) { page = 1 }
                } else {
                    finish(saving: true)
                }
            }
            .buttonStyle(SolidButtonStyle())
            .accessibilityIdentifier("interests-next")
            .padding(.horizontal, 24).padding(.top, 12).padding(.bottom, 8)
            .readableColumn().background(Brand.page)
        }
    }

    private func section(title: String, options list: [LearnerInterest]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title).font(.headline).foregroundColor(Brand.ink)
            options(list)
        }
    }

    private func options(_ list: [LearnerInterest]) -> some View {
        VStack(spacing: 10) {
            ForEach(list) { option in
                let selected = picks.contains(option.id)
                Button {
                    if selected { picks.remove(option.id) } else { picks.insert(option.id) }
                    UISelectionFeedbackGenerator().selectionChanged()
                } label: {
                    HStack(spacing: 14) {
                        Image(systemName: option.symbol).font(.body)
                            .foregroundColor(selected ? Brand.accent : Brand.secondary).frame(width: 26)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(option.label).font(.body.weight(selected ? .semibold : .regular)).foregroundColor(Brand.ink)
                            if !option.detail.isEmpty {
                                Text(option.detail).font(.caption).foregroundColor(Brand.secondary)
                            }
                        }
                        Spacer(minLength: 8)
                        Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                            .foregroundColor(selected ? Brand.accent : Brand.line).font(.title3)
                    }
                    .padding(.horizontal, 16).frame(minHeight: 60)
                    .background(Brand.surface)
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(selected ? Brand.accent : Brand.line, lineWidth: selected ? 1.5 : 1))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
                .accessibilityIdentifier("interest-\(option.id)")
            }
        }
    }

    private func finish(saving: Bool) {
        // Keep the catalog order (the earlier picks, if any) when skipping.
        let ordered = (LearnerInterest.goals + LearnerInterest.fears).map(\.id).filter(picks.contains)
        LearnerInterests.save(saving ? ordered : LearnerInterests.picks())
        onFinish()
        dismiss()
    }
}
