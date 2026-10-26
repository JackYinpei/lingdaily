import AVFoundation
import Combine
import Foundation
import MediaPlayer

/// Streams the daily podcast. One shared player so practice audio can stop it: a call,
/// dictation or read-aloud pauses the podcast first, and only the learner resumes it.
@MainActor
final class PodcastPlayer: ObservableObject {
    static let shared = PodcastPlayer()

    @Published private(set) var episodeDate: String?
    @Published private(set) var isPlaying = false
    @Published private(set) var progress: Double = 0
    @Published private(set) var errorMessage: String?
    private var player: AVPlayer?
    private var observers = Set<AnyCancellable>()
    private var nowPlaying: [String: Any] = [:]
    private var commandsReady = false

    func isCurrent(_ episode: TodayEpisode) -> Bool { episodeDate == episode.date && player != nil }

    func toggle(_ episode: TodayEpisode) {
        if isCurrent(episode) { isPlaying ? pause() : play(); return }
        guard let url = episode.playableURL else { errorMessage = "这期播客暂时没有音频。"; return }
        stop()
        let item = AVPlayerItem(url: url)
        let player = AVPlayer(playerItem: item)
        self.player = player
        episodeDate = episode.date
        errorMessage = nil
        player.publisher(for: \.timeControlStatus).receive(on: RunLoop.main).sink { [weak self] status in
            self?.isPlaying = status == .playing
            self?.updateNowPlaying()
        }.store(in: &observers)
        item.publisher(for: \.status).receive(on: RunLoop.main).sink { [weak self] status in
            guard status == .failed else { return }
            self?.errorMessage = "播客加载失败，请检查网络后重试。"
            self?.stop()
        }.store(in: &observers)
        NotificationCenter.default.publisher(for: .AVPlayerItemDidPlayToEndTime, object: item).receive(on: RunLoop.main).sink { [weak self] _ in
            self?.player?.seek(to: .zero)
            self?.progress = 0
        }.store(in: &observers)
        Timer.publish(every: 1, on: .main, in: .common).autoconnect()
            .sink { [weak self] _ in self?.tick() }.store(in: &observers)
        nowPlaying = [MPMediaItemPropertyTitle: episode.title, MPMediaItemPropertyArtist: "LingDaily"]
        if let duration = episode.duration { nowPlaying[MPMediaItemPropertyPlaybackDuration] = Double(duration) }
        prepareRemoteCommands()
        play()
    }

    func pause() { player?.pause() }

    private func play() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio)
            try session.setActive(true)
        } catch {
            errorMessage = "暂时无法播放，请稍后再试。"
            return
        }
        player?.play()
    }

    private func stop() {
        player?.pause()
        player = nil
        observers.removeAll()
        episodeDate = nil
        isPlaying = false
        progress = 0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }

    private func tick() {
        guard isPlaying, let player else { return }
        let duration = player.currentItem?.duration.seconds ?? 0
        guard duration.isFinite, duration > 0 else { return }
        progress = min(max(player.currentTime().seconds / duration, 0), 1)
        nowPlaying[MPMediaItemPropertyPlaybackDuration] = duration
        updateNowPlaying()
    }

    private func updateNowPlaying() {
        guard player != nil else { return }
        nowPlaying[MPNowPlayingInfoPropertyElapsedPlaybackTime] = player?.currentTime().seconds ?? 0
        nowPlaying[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? 1.0 : 0.0
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nowPlaying
    }

    /// Lock screen and headphone controls while the podcast plays in the background.
    private func prepareRemoteCommands() {
        guard !commandsReady else { return }
        commandsReady = true
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.play() }
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.isPlaying ? self.pause() : self.play()
            }
            return .success
        }
    }
}
