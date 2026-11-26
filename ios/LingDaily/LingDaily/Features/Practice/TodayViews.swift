import SwiftUI

/// Latest daily podcast card: listen, view eight terms, and rehearse a story from it.
struct TodayCard: View {
    let episode: TodayEpisode
    @ObservedObject var player: PodcastPlayer
    var cachedScenario: PracticeScenario? = nil
    var isGeneratingScenario = false
    var isTextAIConfigured = false
    var scenarioError: String? = nil
    let onDiscuss: () -> Void
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
            if let error = player.errorMessage, player.isCurrent(episode) || player.episodeDate == nil {
                Text(error).font(.caption).foregroundColor(Brand.secondary)
            }
            Brand.line.frame(height: 1)
            Button(action: onDiscuss) {
                HStack(spacing: 12) {
                    if let cachedScenario {
                        Avatar(scenario: cachedScenario, size: 36)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("聊聊这期内容").font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                            Text("和 \(cachedScenario.partner) · \(cachedScenario.title)")
                                .font(.caption).foregroundColor(Brand.secondary).lineLimit(1)
                        }
                    } else {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack(spacing: 8) {
                                if isGeneratingScenario {
                                    ProgressView().scaleEffect(0.8)
                                }
                                Text(isGeneratingScenario ? "正在准备话题…" : "聊聊这期内容")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundColor(Brand.ink)
                            }
                            Text(isTextAIConfigured ? "围绕本期播客生成三步英语练习" : "配置文字模型接口后可围绕本期内容练习")
                                .font(.caption)
                                .foregroundColor(Brand.secondary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 8)
                    if !isGeneratingScenario {
                        Image(systemName: "arrow.right").font(.headline).foregroundColor(Brand.ink)
                    }
                }
                .frame(minHeight: 40)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(isGeneratingScenario)
            .accessibilityIdentifier("today-practice")
            if let scenarioError {
                Text(scenarioError).font(.caption).foregroundColor(Brand.accent)
            }
        }
        .surfaceCard()
        .accessibilityElement(children: .contain)
    }
}

/// Compact card for recent daily podcast episodes under 「往期」.
struct PastEpisodeCard: View {
    let episode: TodayEpisode
    @ObservedObject var player: PodcastPlayer
    let onVocabulary: () -> Void

    private var dateLabel: String {
        episode.source.replacingOccurrences(of: "每日播客 ", with: "")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(dateLabel).font(.caption.weight(.medium)).foregroundColor(Brand.secondary)
                Spacer(minLength: 8)
                if let duration = episode.duration {
                    Text("\(max(1, Int((Double(duration) / 60).rounded()))) 分钟").font(.caption).foregroundColor(Brand.secondary)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(episode.title).font(.subheadline.weight(.semibold)).foregroundColor(Brand.ink)
                if !episode.summary.isEmpty {
                    Text(episode.summary).font(.caption).foregroundColor(Brand.secondary).lineSpacing(2).lineLimit(2)
                }
            }
            HStack(spacing: 10) {
                if episode.playableURL != nil {
                    Button { player.toggle(episode) } label: {
                        let playing = player.isCurrent(episode) && player.isPlaying
                        Label(playing ? "暂停" : "收听", systemImage: playing ? "pause.fill" : "play.fill")
                            .font(.caption.weight(.semibold)).padding(.horizontal, 14).frame(minHeight: 38)
                            .foregroundColor(Brand.onInk).background(Brand.ink).clipShape(Capsule())
                    }
                }
                if !episode.vocabulary.isEmpty {
                    Button(action: onVocabulary) {
                        Text("\(episode.vocabulary.count) 个生词").font(.caption.weight(.medium))
                            .padding(.horizontal, 14).frame(minHeight: 38)
                            .foregroundColor(Brand.ink).overlay(Capsule().stroke(Brand.line, lineWidth: 1))
                    }
                }
            }
            .buttonStyle(.plain)
            if player.isCurrent(episode) {
                ProgressView(value: player.progress).tint(Brand.accent).accessibilityLabel("播放进度")
            }
        }
        .surfaceCard(padding: 16)
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
        .navigationBack(title: "本期生词") { dismiss() }
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
