import SwiftUI

/// 「今日」: the latest daily podcast to listen to, its eight terms, and a rehearsal about one story.
struct TodayCard: View {
    let episode: TodayEpisode
    @ObservedObject var player: PodcastPlayer
    let onPractice: (PracticeScenario) -> Void
    let onVocabulary: () -> Void

    private var heading: String {
        let today = ReminderCenter.dayFormatter.string(from: Date())
        return episode.date == today ? "今日播客" : "最新播客 · \(episode.source.replacingOccurrences(of: "每日播客 ", with: ""))"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                Text(heading).font(.caption.weight(.semibold)).foregroundColor(Brand.accent)
                Spacer(minLength: 8)
                if let duration = episode.duration {
                    Text("\(max(1, Int((Double(duration) / 60).rounded()))) 分钟").font(.caption).foregroundColor(Brand.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(episode.title).font(.headline).foregroundColor(Brand.ink)
                if !episode.summary.isEmpty {
                    Text(episode.summary).font(.subheadline).foregroundColor(Brand.secondary).lineSpacing(3).lineLimit(3)
                }
            }
            HStack(spacing: 10) {
                if episode.playableURL != nil {
                    Button { player.toggle(episode) } label: {
                        let playing = player.isCurrent(episode) && player.isPlaying
                        Label(playing ? "暂停" : "收听", systemImage: playing ? "pause.fill" : "play.fill")
                            .font(.subheadline.weight(.semibold)).padding(.horizontal, 16).frame(minHeight: 44)
                            .foregroundColor(Brand.onInk).background(Brand.ink).clipShape(Capsule())
                    }.accessibilityIdentifier("today-play")
                }
                if !episode.vocabulary.isEmpty {
                    Button(action: onVocabulary) {
                        Text("\(episode.vocabulary.count) 个生词").font(.subheadline.weight(.medium))
                            .padding(.horizontal, 16).frame(minHeight: 44)
                            .foregroundColor(Brand.ink).overlay(Capsule().stroke(Brand.line, lineWidth: 1.5))
                    }.accessibilityIdentifier("today-vocabulary")
                }
            }
            .buttonStyle(.plain)
            if player.isCurrent(episode) {
                ProgressView(value: player.progress).tint(Brand.accent).accessibilityLabel("播放进度")
            }
            if let error = player.errorMessage { Text(error).font(.caption).foregroundColor(Brand.secondary) }
            if let scenario = episode.practiceScenario {
                Brand.line.frame(height: 1)
                Button { onPractice(scenario) } label: {
                    HStack(spacing: 12) {
                        Avatar(scenario: scenario, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("和 \(scenario.partner) 聊聊这条新闻").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                            Text(scenario.title).font(.caption).foregroundColor(Brand.secondary).lineLimit(1)
                        }
                        Spacer(minLength: 8)
                        Image(systemName: "arrow.right").font(.headline).foregroundColor(Brand.ink)
                    }.contentShape(Rectangle())
                }
                .buttonStyle(.plain).accessibilityIdentifier("today-practice")
            }
        }
        .surfaceCard()
        .accessibilityElement(children: .contain)
    }
}

/// The episode's eight terms, each one tap away from 词库.
struct TodayVocabularyView: View {
    let episode: TodayEpisode
    @EnvironmentObject private var store: PracticeStore
    @Environment(\.dismiss) private var dismiss
    @StateObject private var speech = SpeechController()

    private var unsaved: [TodayEpisode.Term] { episode.vocabulary.filter { !store.isSaved($0.term) } }

    var body: some View {
        ZStack {
            PageBackground()
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(episode.title).font(.subheadline).foregroundColor(Brand.secondary)
                    ForEach(episode.vocabulary) { term in row(term) }
                }
                .padding(.horizontal, 20).padding(.vertical, 20)
                .readableColumn()
            }
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            Button(unsaved.isEmpty ? "都在词库里了" : "全部加入词库") {
                store.collect(unsaved.map { AILearningItem(text: $0.term, type: $0.kind, meaning: $0.meaning) }, source: episode.source)
            }
            .buttonStyle(SolidButtonStyle()).disabled(unsaved.isEmpty)
            .padding(.horizontal, 20).padding(.vertical, 12)
            .readableColumn().background(Brand.page)
            .accessibilityIdentifier("today-save-all")
        }
        .navigationBack(title: "今日生词") { dismiss() }
        .onDisappear { speech.stopAll() }
    }

    private func row(_ term: TodayEpisode.Term) -> some View {
        let saved = store.isSaved(term.term)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text(term.term).font(Brand.english(.title3)).foregroundColor(Brand.ink)
                Spacer(minLength: 8)
                Button { speech.speak(term.term) } label: { Image(systemName: "speaker.wave.2").frame(width: 44, height: 36) }
                    .foregroundColor(Brand.secondary).accessibilityLabel("朗读")
                Button {
                    if saved { store.removeExpression(SavedExpression.key(term.term)) }
                    else { store.collect([AILearningItem(text: term.term, type: term.kind, meaning: term.meaning)], source: episode.source) }
                } label: {
                    Image(systemName: saved ? "bookmark.fill" : "bookmark").frame(width: 44, height: 36)
                }
                .foregroundColor(saved ? Brand.accent : Brand.secondary)
                .accessibilityLabel(saved ? "移出词库" : "加入词库")
            }
            Text(term.meaning).font(.subheadline).foregroundColor(Brand.ink)
            if !term.example.isEmpty {
                Text(term.example).font(Brand.english(.callout)).foregroundColor(Brand.secondary).lineSpacing(3)
                    .textSelection(.enabled)
            }
        }
        .buttonStyle(.plain)
        .surfaceCard(padding: 16)
    }
}
