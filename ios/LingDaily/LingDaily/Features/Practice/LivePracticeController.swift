import Foundation
import Combine

@MainActor
final class LivePracticeController: ObservableObject {
    enum State { case disconnected, connecting, active }
    @Published private(set) var state: State = .disconnected
    @Published private(set) var muted = false
    @Published private(set) var playing = false
    @Published private(set) var errorMessage: String?
    @Published private(set) var hasStarted = false
    /// Reply idea shown when the learner seems stuck (or asks for help).
    @Published private(set) var suggestion: LiveSuggestion?
    @Published private(set) var suggesting = false
    @Published private(set) var suggestionError: String?
    private var stuckTask: Task<Void, Never>?
    private var suggestedLine: UUID?
    private let audio = LiveAudioController()
    private let client = LiveWebSocketClient()
    private let api = PracticeAPIClient()
    private var generations = LiveGenerations()
    private var connectTask: Task<Void, Never>?
    private var transcript = LiveTranscriptReducer()
    private var pendingTools = LivePendingTools()
    private var cancelledTools = Set<String>()
    private var turnFinished = false
    private var pendingSave: Task<Void, Never>?
    private var completionTask: Task<Void, Never>?
    #if DEBUG
    private var diagnosticTask: Task<Void, Never>?
    #endif
    private weak var model: PracticeViewModel?
    private weak var store: PracticeStore?

    var status: String {
        switch state {
        case .connecting: return "连接中"
        case .disconnected: return hasStarted ? "已断开 · 重新连接" : "点开始通话，直接开口，字幕会自动显示"
        case .active:
            if playing { return "\(model?.session.scenario.partner ?? "对方") 正在说" }
            return muted ? "麦克风已静音" : "在听"
        }
    }

    /// User gesture entry point; output is primed synchronously, before any await.
    func start(model: PracticeViewModel, store: PracticeStore) {
        guard state == .disconnected, model.session.phase != .completed else { return }
        self.model = model; self.store = store
        hasStarted = true
        generations.reconnect()
        let current = generations.connection
        transcript.reset(); pendingTools.reset(); cancelledTools.removeAll()
        completionTask?.cancel(); completionTask = nil
        turnFinished = false
        errorMessage = nil; muted = false; playing = false; state = .connecting
        model.enterLive()
        if LiveAudioController.permissionDenied {
            stop(message: "麦克风权限被拒。可在系统设置中允许麦克风，或切回文字模式。")
            return
        }
        audio.onStopRequired = { [weak self] reason in
            guard let self, self.generations.accepts(connection: current), self.state != .disconnected else { return }
            #if DEBUG
            LiveDebugDiagnostics.record("audioStop reason=\(reason.rawValue)")
            #endif
            self.stop(message: reason.message)
        }
        audio.onBufferPressure = { [weak self] in
            guard let self, self.generations.accepts(connection: current), self.state == .active else { return }
            self.errorMessage = "音频缓冲繁忙，部分声音可能略过；通话会继续。"
        }
        audio.onPlaying = { [weak self] playing, epoch in
            Task { @MainActor in
                guard let self, self.generations.accepts(connection: current), self.audio.acceptsPlayback(epoch), self.state != .disconnected else { return }
                self.playing = playing
                if !playing { self.finishIfReady(); self.watchForStuck() }
            }
        }
        do { try audio.prepareOutput() }
        catch { stop(message: "暂时无法准备音频，请重新连接或使用文字模式。"); return }
        let snapshot = model.session
        connectTask = Task { [weak self] in
            guard await LiveAudioController.permission() else {
                guard let self, self.generations.accepts(connection: current) else { return }
                self.stop(message: "麦克风权限被拒。可在系统设置中允许麦克风，或切回文字模式。")
                return
            }
            guard let self, self.generations.accepts(connection: current), !Task.isCancelled else { return }
            do {
                // Permission may just have been granted. Finish configuring
                // voice processing before fetching the token or receiving audio.
                try self.audio.prepareOutput()
                #if DEBUG
                LiveDebugDiagnostics.record("phase=tokenRequest")
                #endif
                let token = try await self.api.liveToken(for: snapshot)
                guard self.generations.accepts(connection: current), !Task.isCancelled else { return }
                #if DEBUG
                LiveDebugDiagnostics.record("phase=websocketConnect")
                #endif
                var updated = model.session; updated.beginLive(model: token.model); model.updateLive(updated)
                try await self.client.connect(token, generation: current,
                    handler: { [weak self] event, generation in self?.receive(event, generation: generation) },
                    failure: { [weak self] generation, diagnostics in
                        guard let self, self.generations.accepts(connection: generation) else { return }
                        self.stop(message: diagnostics.message)
                    })
            } catch {
                guard self.generations.accepts(connection: current), !Task.isCancelled else { return }
                self.stop(message: (error as? PracticeNetworkError)?.localizedDescription ?? "暂时无法连接语音服务，请重试或使用文字模式。")
            }
        }
    }

    private func receive(_ event: LiveEvent, generation current: UInt64) {
        guard generations.accepts(connection: current), state != .disconnected, let model, let store else { return }
        switch event {
        case .setupComplete:
            guard state == .connecting else { return }
            Task { [weak self] in
                guard let self, self.generations.accepts(connection: current), self.state == .connecting else { return }
                do {
                    // turnComplete on clientContent interrupts live generation.
                    // Queue the kickoff BEFORE starting input PCM; independent
                    // tasks can otherwise race across audio turns. When the
                    // partner's last line is unanswered, send none: the learner speaks first.
                    if let kickoff = LiveKickoff.text(for: model.session) {
                        try await self.client.sendText(kickoff, generation: current)
                    }
                    guard self.generations.accepts(connection: current), self.state == .connecting else { return }
                    try self.audio.startCapture(); self.state = .active
                    #if DEBUG
                    LiveDebugDiagnostics.record("active setupComplete=1")
                    #endif
                    let audio = self.audio
                    await self.client.startUpload(generation: current, nextFrame: { audio.takeFrame() })
                    #if DEBUG
                    if ProcessInfo.processInfo.environment["LINGDAILY_LIVE_DIAGNOSTICS"] == "1" {
                        self.diagnosticTask = Task { [weak self] in
                            while !Task.isCancelled {
                                try? await Task.sleep(nanoseconds: 2_000_000_000)
                                guard !Task.isCancelled, let self, self.generations.accepts(connection: current), self.state == .active else { return }
                                let upload = await self.client.uploadStatistics()
                                guard self.generations.accepts(connection: current) else { return }
                                LiveDebugDiagnostics.record("counters sent=\(upload.sentFrames) networkDrops=\(upload.droppedFrames) \(self.audio.diagnosticCounters())")
                            }
                        }
                    }
                    #endif
                } catch {
                    guard self.generations.accepts(connection: current) else { return }
                    self.stop(message: "无法启动麦克风，请重试或使用文字模式。")
                }
            }
        case .audio(let pcm):
            guard !pcm.isEmpty else { return }
            completionTask?.cancel(); completionTask = nil
            turnFinished = false; audio.play(pcm)
            clearSuggestion()
        case .interrupted:
            #if DEBUG
            LiveDebugDiagnostics.record("event=interrupted")
            #endif
            generations.interrupt(); audio.interruptPlayback(); playing = false
            // Keep input subtitle until final; next partner output gets a new ID.
            transcript.finishPartner()
        case .transcription(let role, let text, let finished):
            do {
                let segment = try transcript.update(role: role, text: text, finished: finished)
                var session = model.session
                guard !segment.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
                guard session.liveTranscript(id: segment.id, role: role, text: segment.text) else { throw LiveProtocolError.overloaded }
                if role == .user { clearSuggestion() }
                pendingTools.flush(to: &session)
                model.updateLive(session)
                if finished { scheduleSave() }
                finishIfReady()
            } catch { stop(message: "这次对话内容已达到上限，请结束后开始新练习。") }
        case .turnComplete:
            #if DEBUG
            LiveDebugDiagnostics.record("event=turnComplete")
            #endif
            turnFinished = true
            transcript.finishTurn()
            var session = model.session; pendingTools.flush(to: &session); model.updateLive(session); scheduleSave()
            finishIfReady()
        case .tool(let call):
            // Acknowledgement was queued by the protocol client first. Work is
            // deferred to a separate turn on MainActor, with generation guards.
            Task { [weak self] in
                await Task.yield()
                guard let self, self.generations.accepts(connection: current), !self.cancelledTools.contains(call.id),
                      self.state != .disconnected, call.validated() != nil else { return }
                var session = model.session
                let collected = self.pendingTools.apply(call, to: &session)
                self.pendingTools.flush(to: &session)
                model.updateLive(session)
                if collected.isEmpty { self.scheduleSave() }
                else {
                    self.pendingSave?.cancel(); self.pendingSave = nil
                    store.save(session, collecting: collected)
                }
                self.finishIfReady()
            }
        case .cancelledTools(let ids):
            guard cancelledTools.count + ids.count <= 512 else { stop(message: "工具调用已达到上限，请重新连接。"); return }
            cancelledTools.formUnion(ids)
            pendingTools.cancel(ids)
        case .goAway: stop(message: "本次连接即将到期，请重新连接。已有内容已保留。")
        }
    }
    private func scheduleSave() {
        guard pendingSave == nil else { return }
        let current = generations.connection
        pendingSave = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 400_000_000)
            guard !Task.isCancelled, let self, self.generations.accepts(connection: current),
                  let model = self.model, let store = self.store else { return }
            self.pendingSave = nil
            store.save(model.session)
        }
    }
    private func finishIfReady() {
        guard model?.session.phase == .completed, turnFinished, !audio.hasOutput else { return }
        // Stop uploading immediately but allow late final subtitles/tools to
        // settle before closing. A final task tool can arrive after turnComplete.
        if !muted {
            muted = true; audio.setMuted(true)
            let current = generations.connection
            Task { await client.endInput(generation: current) }
        }
        completionTask?.cancel()
        let current = generations.connection
        completionTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 600_000_000)
            guard !Task.isCancelled, let self, self.generations.accepts(connection: current),
                  self.model?.session.phase == .completed, self.turnFinished, !self.audio.hasOutput else { return }
            self.stop()
        }
    }
    /// "卡住了" button: ask for a reply idea right away.
    func requestSuggestion() {
        guard state == .active, let model, !suggesting else { return }
        stuckTask?.cancel(); stuckTask = nil
        suggestedLine = LiveStuckPolicy.awaitedLine(in: model.session)
        suggesting = true; suggestionError = nil
        let current = generations.connection
        let snapshot = model.session
        Task { [weak self] in
            defer { self?.suggesting = false }
            do {
                let idea = try await PracticeAPIClient().suggest(for: snapshot)
                guard let self, self.generations.accepts(connection: current), self.state == .active,
                      let model = self.model, LiveStuckPolicy.awaitedLine(in: model.session) == self.suggestedLine else { return }
                self.suggestion = idea
            } catch {
                guard let self, self.generations.accepts(connection: current) else { return }
                self.suggestionError = (error as? PracticeNetworkError)?.localizedDescription ?? "暂时拿不到建议，请稍后再试。"
            }
        }
    }

    func dismissSuggestion() { clearSuggestion() }

    /// After the partner finishes a line, offer help if the learner stays silent.
    private func watchForStuck() {
        stuckTask?.cancel(); stuckTask = nil
        guard state == .active, !muted, suggestion == nil, let model,
              let line = LiveStuckPolicy.awaitedLine(in: model.session), line != suggestedLine else { return }
        let current = generations.connection
        stuckTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(LiveStuckPolicy.silence * 1_000_000_000))
            guard !Task.isCancelled, let self, self.generations.accepts(connection: current), self.state == .active,
                  !self.muted, !self.playing, let model = self.model,
                  LiveStuckPolicy.awaitedLine(in: model.session) == line else { return }
            self.requestSuggestion()
        }
    }

    private func clearSuggestion() {
        stuckTask?.cancel(); stuckTask = nil
        suggestion = nil; suggestionError = nil
    }

    func toggleMute() {
        guard state == .active else { return }
        muted.toggle(); audio.setMuted(muted)
        let current = generations.connection
        let shouldMute = muted
        Task {
            if shouldMute { await client.endInput(generation: current) }
            else { await client.resumeInput(generation: current) }
        }
    }
    func stop(message: String? = nil) {
        guard state != .disconnected else { return }
        let closingGeneration = generations.connection
        #if DEBUG
        diagnosticTask?.cancel(); diagnosticTask = nil
        #endif
        completionTask?.cancel(); completionTask = nil
        pendingSave?.cancel(); pendingSave = nil
        generations.reconnect(); connectTask?.cancel(); connectTask = nil
        audio.stop(); state = .disconnected; playing = false; muted = false
        clearSuggestion(); suggestedLine = nil
        errorMessage = message
        if let model, let store {
            var session = model.session; pendingTools.flush(to: &session); session.endLive()
            model.updateLive(session); store.save(session)
        }
        // Sequential close barrier: a subsequent connect awaits this actor and
        // its own close before opening a fresh socket.
        Task { await client.close(expectedGeneration: closingGeneration) }
    }
}
