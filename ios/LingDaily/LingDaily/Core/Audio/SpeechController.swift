import AVFoundation
import Speech
import Combine

/// Retain delegate identity across the hop; inspect the utterance only on
/// MainActor. AVSpeechUtterance itself is not declared Sendable by the SDK.
private struct FinishedSpeech: @unchecked Sendable {
    let utterance: AVSpeechUtterance
}

@MainActor
final class SpeechController: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    @Published private(set) var isRecording = false
    @Published private(set) var isSpeaking = false
    @Published private(set) var isRequestingPermission = false
    @Published private(set) var isFinalizing = false
    @Published var transcript = ""
    @Published var errorMessage: String?

    private let engine = AVAudioEngine()
    private let synthesizer = AVSpeechSynthesizer()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var hasTap = false
    private var generation = UUID()
    private var observers: [NSObjectProtocol] = []
    private var timeoutTask: Task<Void, Never>?
    private var dictation = DictationTranscript()
    private var sessionActive = false
    private var activeUtterance: AVSpeechUtterance?

    override init() {
        super.init()
        synthesizer.delegate = self
        for name in [AVAudioSession.interruptionNotification, AVAudioSession.routeChangeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                // A category change caused by this controller isn't a disconnected route.
                if notification.name == AVAudioSession.routeChangeNotification,
                   let reason = notification.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt,
                   reason != AVAudioSession.RouteChangeReason.oldDeviceUnavailable.rawValue { return }
                Task { @MainActor [weak self] in
                    guard let self, self.isRecording || self.isSpeaking else { return }
                    self.stopAll()
                    self.errorMessage = "音频已暂停，可以重新开始或继续打字。"
                }
            })
        }
    }

    deinit { observers.forEach(NotificationCenter.default.removeObserver) }

    func startRecording(maxCharacters: Int = 800) async {
        guard !isRecording, !isRequestingPermission, !isFinalizing else { return }
        stopAll()
        errorMessage = nil
        let current = UUID()
        generation = current
        isRequestingPermission = true
        defer { if generation == current { isRequestingPermission = false } }

        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")),
              recognizer.supportsOnDeviceRecognition else {
            errorMessage = "这台设备暂不支持离线英语听写。可以先打字体验完整流程。"
            return
        }
        let authorization = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { continuation.resume(returning: $0) }
        }
        guard generation == current else { return }
        guard authorization == .authorized else {
            errorMessage = "尚未允许语音识别。可以继续打字，或稍后在系统设置中开启。"
            return
        }
        let micAllowed = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { continuation.resume(returning: $0) }
        }
        guard generation == current else { return }
        guard micAllowed else {
            errorMessage = "尚未允许麦克风。可以继续打字，或在系统设置中开启。"
            return
        }
        guard recognizer.isAvailable else {
            errorMessage = "系统听写暂时不可用，请稍后再试或继续打字。"
            return
        }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.defaultToSpeaker, .allowBluetoothHFP])
            try session.setActive(true)
            sessionActive = true
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            guard format.sampleRate > 0, format.channelCount > 0 else {
                throw NSError(domain: "LingDaily.Audio", code: 1)
            }
            let audioRequest = SFSpeechAudioBufferRecognitionRequest()
            audioRequest.shouldReportPartialResults = true
            audioRequest.requiresOnDeviceRecognition = true
            request = audioRequest
            dictation = DictationTranscript(maxCharacters: maxCharacters)
            transcript = ""
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
                audioRequest.append(buffer)
            }
            hasTap = true
            recognitionTask = recognizer.recognitionTask(with: audioRequest) { [weak self] result, error in
                let text = result?.bestTranscription.formattedString
                let words = result?.bestTranscription.segments.map {
                    DictationTranscript.Word(range: $0.substringRange, timestamp: $0.timestamp, duration: $0.duration)
                } ?? []
                let finished = result?.isFinal == true
                let failed = error != nil
                Task { @MainActor [weak self] in
                    guard let self, self.generation == current else { return }
                    if let text { self.transcript = self.dictation.update(text, words: words) }
                    if self.dictation.reachedLimit {
                        self.stopRecording()
                        self.errorMessage = "这一段较长，听写已停止。请检查已保留的内容，发送后再继续。"
                        return
                    }
                    if finished || failed {
                        self.stopRecording()
                        if failed && self.transcript.isEmpty {
                            self.errorMessage = "没能听清楚，请重新尝试或打字输入。"
                        }
                    }
                }
            }
            engine.prepare()
            try engine.start()
            isRecording = true
            timeoutTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                guard !Task.isCancelled, let self, self.generation == current else { return }
                self.timeoutTask = nil
                _ = await self.finishRecording()
            }
        } catch {
            stopRecording()
            errorMessage = "麦克风暂时无法启动，可以继续打字体验。"
        }
    }

    /// End audio gracefully, allowing the recognizer's last result to arrive.
    /// Cancellation/background/mode changes still use stopAll immediately.
    func finishRecording() async -> String {
        guard isRecording else { return transcript }
        let current = generation
        timeoutTask?.cancel(); timeoutTask = nil
        engine.stop()
        if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        isRecording = false; isFinalizing = true
        request?.endAudio()
        try? await Task.sleep(nanoseconds: 1_000_000_000)
        let result = transcript
        if generation == current { stopRecording() }
        return result
    }

    func stopRecording() {
        generation = UUID()
        timeoutTask?.cancel()
        timeoutTask = nil
        engine.stop()
        if hasTap { engine.inputNode.removeTap(onBus: 0); hasTap = false }
        request?.endAudio()
        recognitionTask?.cancel()
        recognitionTask = nil
        request = nil
        isRecording = false
        isRequestingPermission = false
        isFinalizing = false
        if !isSpeaking { deactivateOwnedSession() }
    }

    func speak(_ text: String) {
        stopAll()
        errorMessage = nil
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true)
            sessionActive = true
            let utterance = AVSpeechUtterance(string: text)
            utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
            utterance.rate = AVSpeechUtteranceDefaultSpeechRate * 0.88
            isSpeaking = true
            activeUtterance = utterance
            synthesizer.speak(utterance)
        } catch {
            errorMessage = "朗读暂时不可用，文字内容仍可正常查看。"
        }
    }

    func stopAll() {
        activeUtterance = nil
        synthesizer.stopSpeaking(at: .immediate)
        isSpeaking = false
        stopRecording()
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        let finished = FinishedSpeech(utterance: utterance)
        Task { @MainActor [weak self] in
            // A finished/cancelled text utterance cannot deactivate a Live
            // session that started after stopAll handed off audio ownership.
            guard let self, self.activeUtterance === finished.utterance, !self.synthesizer.isSpeaking else { return }
            self.activeUtterance = nil
            self.isSpeaking = false
            if !self.isRecording { self.deactivateOwnedSession() }
        }
    }
    private func deactivateOwnedSession() {
        guard sessionActive else { return }
        sessionActive = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
