import AVFoundation
import Foundation

/// The tap copies into eight preallocated buffers using try-lock only. A serial
/// worker converts them and frames PCM. No JSON, Base64, network or file I/O on
/// the realtime callback. Pressure drops bounded audio, never hangs up the call.
final class LiveAudioController {
    enum StopReason: String {
        case interruption, routeUnavailable, mediaReset, capture, routeReconfiguration, playback
        var message: String {
            switch self {
            case .interruption: return "通话被系统音频打断，已有内容已保留。请重新连接。"
            case .routeUnavailable: return "当前音频设备已断开，已有内容已保留。请重新连接。"
            case .mediaReset: return "系统音频服务已重置，已有内容已保留。请重新连接。"
            case .capture: return "麦克风音频处理失败，已有内容已保留。请重新连接。"
            case .routeReconfiguration: return "音频设备切换失败，已有内容已保留。请重新连接。"
            case .playback: return "对方声音播放失败，已有内容已保留。请重新连接。"
            }
        }
    }
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let worker = DispatchQueue(label: "lingdaily.live.audio")
    private let lock = NSLock()
    private var microphone: LiveMicrophonePipeline?
    private var muted = false
    private var timer: DispatchSourceTimer?
    private var tapInstalled = false
    private var playback = LivePlaybackBuffer()
    private var outputReady = false
    private var sessionActive = false
    private var receivedBytes = 0, scheduledBytes = 0, playedBytes = 0, droppedBytes = 0
    private var routeRestarts = 0
    private var echoGate = LiveEchoGate()
    private var speakerOutput = true
    private var observers: [NSObjectProtocol] = []
    var onStopRequired: ((StopReason) -> Void)?
    var onBufferPressure: (() -> Void)?
    var onPlaying: ((Bool, UInt64) -> Void)?
    var hasOutput: Bool { lock.lock(); defer { lock.unlock() }; return playback.reservedBytes > 0 }
    func acceptsPlayback(_ value: UInt64) -> Bool { isCurrent(value) }
    private let outputFormat = AVAudioFormat(standardFormatWithSampleRate: 24000, channels: 1)!

    init() {
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: outputFormat)
        for name in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification,
                     AVAudioSession.mediaServicesWereResetNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] note in
                if name == AVAudioSession.interruptionNotification,
                   (note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt) != AVAudioSession.InterruptionType.began.rawValue { return }
                if name == AVAudioSession.routeChangeNotification {
                    self?.updateOutputRoute()
                    let raw = note.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt ?? 0
                    switch LiveAudioRoutePolicy.action(reason: raw) {
                    case .ignore: return
                    case .reconfigure: self?.refreshRoute(); return
                    case .stop: break
                    }
                }
                let reason: StopReason = name == AVAudioSession.interruptionNotification ? .interruption
                    : (name == AVAudioSession.routeChangeNotification ? .routeUnavailable : .mediaReset)
                self?.onStopRequired?(reason)
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange,
            object: engine, queue: .main) { [weak self] _ in self?.refreshRoute() })
    }
    deinit { observers.forEach(NotificationCenter.default.removeObserver); timer?.cancel() }

    /// Invoked synchronously by the start button BEFORE requesting a token.
    func prepareOutput() throws {
        let session = AVAudioSession.sharedInstance()
        let bluetooth = AVAudioSession.CategoryOptions(rawValue: 1 << 2) // HFP, same bit on iOS 15+.
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, bluetooth])
        try session.setActive(true)
        sessionActive = true
        updateOutputRoute()
        try worker.sync {
            // Configure voice processing before any output is scheduled. Adding
            // the microphone tap after setup must not restart first-reply audio.
            if session.recordPermission == .granted, !engine.inputNode.isVoiceProcessingEnabled {
                engine.stop()
                try engine.inputNode.setVoiceProcessingEnabled(true)
            }
            if !engine.isRunning { engine.prepare(); try engine.start() }
            player.play(); outputReady = true
            flushOutput()
        }
    }

    static func permission() async -> Bool {
        let session = AVAudioSession.sharedInstance()
        if session.recordPermission == .granted { return true }
        if session.recordPermission == .denied { return false }
        return await withCheckedContinuation { continuation in
            session.requestRecordPermission { continuation.resume(returning: $0) }
        }
    }
    static var permissionDenied: Bool { AVAudioSession.sharedInstance().recordPermission == .denied }

    /// Never called before setupComplete. Hardware format is read for each call.
    func startCapture() throws {
        try worker.sync {
            muted = false
            // Output was primed with an output-only graph. Rebuild the graph
            // with the tap installed BEFORE starting voice-processing I/O.
            // Preserve every greeting buffer across this hardware transition,
            // and invalidate completions from the old player timeline.
            lock.lock(); playback.requeueScheduled(); lock.unlock()
            player.stop(); engine.stop()
            try configureCapture()
            let timer = DispatchSource.makeTimerSource(queue: worker)
            timer.schedule(deadline: .now(), repeating: .milliseconds(20))
            timer.setEventHandler { [weak self] in self?.convertCaptured() }
            self.timer = timer; timer.resume()
        }
    }
    private func configureCapture() throws {
        lock.lock(); let previous = microphone; microphone = nil; lock.unlock()
        previous?.stop()
        let input = engine.inputNode
        if tapInstalled { input.removeTap(onBus: 0); tapInstalled = false }
        let pipeline = try LiveMicrophonePipeline(format: input.outputFormat(forBus: 0))
        pipeline.setMuted(muted)
        lock.lock(); microphone = pipeline; lock.unlock()
        input.installTap(onBus: 0, bufferSize: 1024, format: pipeline.format) { buffer, _ in pipeline.capture(buffer) }
        tapInstalled = true
        if !engine.isRunning { engine.prepare(); try engine.start() }
        player.play(); outputReady = true; flushOutput()
    }
    private func refreshRoute() {
        worker.async { [weak self] in
            guard let self else { return }
            guard self.outputReady else { return } // Never restart a stopped session.
            self.lock.lock(); let pipeline = self.microphone; self.lock.unlock()
            let format = self.engine.inputNode.outputFormat(forBus: 0)
            guard !self.engine.isRunning || (pipeline != nil && format != pipeline?.format) else { return }
            self.routeRestarts += 1
            self.lock.lock(); self.playback.requeueScheduled(); self.lock.unlock()
            self.player.stop(); self.engine.stop()
            do {
                if pipeline != nil { try self.configureCapture() }
                else {
                    self.engine.prepare(); try self.engine.start()
                    self.player.play(); self.flushOutput()
                }
            }
            catch { self.requestStop(.routeReconfiguration) }
        }
    }
    private func convertCaptured() {
        lock.lock(); let pipeline = microphone; lock.unlock()
        do { if try pipeline?.process() == true { reportPressure() } }
        catch { requestStop(.capture) }
    }
    func takeFrame() -> Data? {
        lock.lock(); let pipeline = microphone; lock.unlock()
        guard let frame = pipeline?.takeFrame() else { return nil }
        lock.lock()
        let suppress = echoGate.suppressesMicrophone(partnerAudible: playback.reservedBytes > 0,
                                                     speakerOutput: speakerOutput, now: ProcessInfo.processInfo.systemUptime)
        lock.unlock()
        // Keep the stream timing so server-side voice detection sees the learner as silent.
        return suppress ? Data(count: frame.count) : frame
    }

    /// Echo suppression only applies when the partner plays through the phone's own speaker.
    private func updateOutputRoute() {
        let outputs = AVAudioSession.sharedInstance().currentRoute.outputs.map(\.portType)
        let speaker = outputs.isEmpty || outputs.contains { $0 == .builtInSpeaker || $0 == .builtInReceiver }
        lock.lock(); speakerOutput = speaker; lock.unlock()
    }
    func setMuted(_ value: Bool) {
        worker.sync {
            muted = value
            lock.lock(); let pipeline = microphone; lock.unlock()
            pipeline?.setMuted(value)
        }
    }
    func play(_ pcm: Data) {
        // Reserve queue bytes before dispatch, so the dispatch queue itself is bounded.
        guard !pcm.isEmpty else { return }
        lock.lock()
        receivedBytes += pcm.count
        guard let epoch = playback.reserve(bytes: pcm.count) else { droppedBytes += pcm.count; lock.unlock(); reportPressure(); return }
        lock.unlock()
        worker.async { [weak self] in
            guard let self, self.isCurrent(epoch) else { return }
            self.lock.lock(); self.playback.enqueue(pcm, generation: epoch); self.lock.unlock()
            self.flushOutput()
        }
    }
    private func isCurrent(_ value: UInt64) -> Bool { lock.lock(); defer { lock.unlock() }; return value == playback.generation }
    private func flushOutput() {
        guard outputReady, engine.isRunning else { return } // Retain first audio until ready.
        if !player.isPlaying { player.play() }
        while true {
            lock.lock(); let next = playback.next(outputReady: true); lock.unlock()
            guard let (pcm, epoch, schedule) = next else { break }
            guard let samples = try? LivePCMFramer.decode(pcm),
                  let buffer = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: AVAudioFrameCount(samples.count)),
                  let channel = buffer.floatChannelData else { requestStop(.playback); return }
            buffer.frameLength = AVAudioFrameCount(samples.count)
            for (index, value) in samples.enumerated() { channel[0][index] = value }
            onPlaying?(true, epoch)
            lock.lock(); scheduledBytes += pcm.count; lock.unlock()
            player.scheduleBuffer(buffer, completionCallbackType: .dataPlayedBack) { [weak self] _ in
                guard let self else { return }
                self.worker.async {
                    guard self.isCurrent(epoch) else { return }
                    self.lock.lock()
                    let accepted = self.playback.complete(bytes: pcm.count, generation: epoch, schedulingGeneration: schedule)
                    if accepted { self.playedBytes += pcm.count }
                    let finished = self.playback.reservedBytes == 0
                    self.lock.unlock()
                    guard accepted else { return }
                    if finished { self.onPlaying?(false, epoch) }
                }
            }
        }
    }
    func interruptPlayback() {
        worker.sync {
            lock.lock(); playback.invalidate(); let epoch = playback.generation; lock.unlock()
            player.stop()
            if outputReady && engine.isRunning { player.play() }
            onPlaying?(false, epoch)
        }
    }
    #if DEBUG
    func diagnosticCounters() -> String {
        worker.sync {
            lock.lock()
            let input = microphone
            let output = "received=\(receivedBytes) scheduled=\(scheduledBytes) played=\(playedBytes) dropped=\(droppedBytes) queuedBytes=\(playback.reservedBytes)"
            lock.unlock()
            guard let input else { return "mic=none " + output }
            let stats = input.statistics()
            return "native=\(stats.nativeFrames) converted=\(stats.convertedFrames) formatRejected=\(stats.rejectedFormatFrames) peak=\(stats.peakSample) actualRate=\(Int(stats.observedRate)) channels=\(stats.observedChannels) expectedRate=\(Int(input.format.sampleRate)) nativeDrops=\(stats.droppedNativeFrames) pcmDrops=\(stats.droppedPCMFrames) engine=\(engine.isRunning ? 1 : 0) player=\(player.isPlaying ? 1 : 0) routes=\(routeRestarts) " + output
        }
    }
    #endif
    func stop() {
        lock.lock(); let pipeline = microphone; microphone = nil; lock.unlock()
        pipeline?.stop()
        interruptPlayback()
        worker.sync {
            lock.lock(); let latest = microphone; microphone = nil; lock.unlock()
            latest?.stop()
            timer?.cancel(); timer = nil
            if tapInstalled { engine.inputNode.removeTap(onBus: 0); tapInstalled = false }
            engine.stop(); outputReady = false
        }
        if sessionActive {
            sessionActive = false
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        }
    }
    private func reportPressure() {
        // Callers may hold lock, so dispatch without waiting or reading state.
        let callback = onBufferPressure
        DispatchQueue.main.async { callback?() }
    }
    private func requestStop(_ reason: StopReason) {
        lock.lock(); let epoch = playback.generation; lock.unlock()
        let callback = onStopRequired
        DispatchQueue.main.async { [weak self] in
            guard let self, self.isCurrent(epoch) else { return }
            callback?(reason)
        }
    }
}
