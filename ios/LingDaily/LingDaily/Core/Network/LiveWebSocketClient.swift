import Foundation

/// One receiver, one writer, one upload pump. URL/token and provider errors never
/// escape this boundary. All late callbacks carry their connection generation.
actor LiveWebSocketClient {
    typealias Handler = @MainActor (LiveEvent, UInt64) -> Void
    typealias Failure = @MainActor (UInt64, FailureDiagnostics) -> Void
    private var socket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var generation: UInt64 = 0
    private var ready = false
    private var inputGate = LiveInputGate()
    private var outgoing = LiveOutgoingBuffer()
    private var writing = false
    private var sentAudioFrames = 0
    private var closedUploadStatistics: UploadStatistics?
    struct FailureDiagnostics {
        let stage: String
        let closeCode: Int
        let transportCode: Int?
        var message: String {
            if stage == "setupTimeout" || transportCode == NSURLErrorTimedOut {
                return "手机连接语音服务超时，请检查手机网络后重新连接。已有内容已保留。"
            }
            if let transportCode, [NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost].contains(transportCode) {
                return "手机与语音服务的网络连接已断开，请检查手机网络后重试。已有内容已保留。"
            }
            if closeCode > 0 {
                return "语音服务已关闭连接（\(closeCode)），请重新连接。已有内容已保留。"
            }
            if stage == "protocol" { return "语音服务返回了无法处理的消息，请重新连接。已有内容已保留。" }
            return "语音连接已断开，请重新连接。已有内容已保留。"
        }
    }
    private var lastFailure: FailureDiagnostics?
    private var receiver: Task<Void, Never>?
    private var uploader: Task<Void, Never>?
    private var timeout: Task<Void, Never>?
    private var seenTools = Set<String>()
    private var handler: Handler?
    private var failure: Failure?

    func connect(_ token: LiveToken, generation current: UInt64,
                 handler: @escaping Handler, failure: @escaping Failure) async throws {
        guard !Task.isCancelled, current >= generation else { throw CancellationError() }
        reset()
        closedUploadStatistics = nil; lastFailure = nil
        generation = current; self.handler = handler; self.failure = failure
        let url = try token.connectionURL()
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.timeoutIntervalForRequest = 25
        let session = URLSession(configuration: config)
        self.session = session
        let socket = session.webSocketTask(with: url)
        socket.maximumMessageSize = 512 * 1024
        self.socket = socket
        socket.resume()
        try enqueue(LiveCodec.setup(model: token.model), generation: current)
        receiver = Task { [weak self] in await self?.receive(socket, generation: current) }
        timeout = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 20_000_000_000)
            guard !Task.isCancelled else { return }
            await self?.setupTimeout(current)
        }
    }

    private func setupTimeout(_ current: UInt64) async {
        guard current == generation, !ready else { return }
        await fail(current, stage: "setupTimeout")
    }

    private func receive(_ source: URLSessionWebSocketTask, generation current: UInt64) async {
        do {
            while !Task.isCancelled, generation == current, socket === source {
                let message = try await source.receive()
                guard generation == current, socket === source, !Task.isCancelled else { return }
                let data: Data
                switch message {
                case .data(let value): data = value
                case .string(let value): data = Data(value.utf8)
                @unknown default: throw LiveProtocolError.invalid
                }
                for event in try LiveCodec.parse(data) {
                    guard generation == current, socket === source else { return }
                    switch event {
                    case .setupComplete:
                        guard !ready else { continue }
                        ready = true; inputGate.open(); timeout?.cancel()
                    case .tool(let call):
                        let action = call.validated()
                        let duplicate = seenTools.contains(call.id)
                        guard seenTools.count < 512 else { throw LiveProtocolError.overloaded }
                        // Queue acknowledgement BEFORE scheduling any UI/persistence work.
                        try enqueue(LiveCodec.toolResponse(call, accepted: action != nil), generation: current, priority: true)
                        if action == nil || duplicate { continue }
                        seenTools.insert(call.id)
                    default: break
                    }
                    await handler?(event, current)
                }
            }
        } catch {
            if generation == current, socket === source {
                await fail(current, stage: error is LiveProtocolError ? "protocol" : "receive", error: error)
            }
        }
    }

    func startUpload(generation current: UInt64, nextFrame: @escaping () -> Data?) {
        guard ready, current == generation, uploader == nil else { return }
        // setupComplete opens input once. A mute that occurs before this pump
        // starts must stay closed, rather than being undone here.
        uploader = Task { [weak self] in
            while !Task.isCancelled {
                guard let self else { return }
                guard let (epoch, batch) = await self.takeUploadBatch(generation: current, nextFrame: nextFrame) else { return }
                for frame in batch {
                    guard !Task.isCancelled else { return }
                    await self.upload(frame, generation: current, inputGeneration: epoch)
                }
                try? await Task.sleep(nanoseconds: 20_000_000)
            }
        }
    }
    private func takeUploadBatch(generation current: UInt64, nextFrame: () -> Data?) -> (UInt64, [Data])? {
        guard ready, generation == current else { return nil }
        return (inputGate.generation, inputGate.isOpen ? LiveUploadBatch.take(nextFrame: nextFrame) : [])
    }
    private func upload(_ frame: Data, generation current: UInt64, inputGeneration epoch: UInt64) async {
        guard ready, generation == current, inputGate.accepts(epoch) else { return }
        do { try enqueue(LiveCodec.audio(frame), generation: current, audio: true) }
        catch { await fail(current, stage: "uploadEncoding", error: error) }
    }
    func endInput(generation current: UInt64) {
        guard ready, current == generation else { return }
        inputGate.close()
        // Drop already queued microphone frames; output and control are retained.
        outgoing.clearAudio()
        if let end = try? LiveCodec.audioEnd() { try? enqueue(end, generation: current, priority: true) }
    }
    func resumeInput(generation current: UInt64) {
        guard ready, current == generation, !inputGate.isOpen else { return }
        inputGate.open()
    }
    func sendText(_ text: String, generation current: UInt64) throws {
        guard ready, current == generation else { throw LiveProtocolError.invalid }
        try enqueue(LiveCodec.text(text), generation: current, priority: true)
    }
    private func enqueue(_ message: String, generation current: UInt64, priority: Bool = false, audio: Bool = false) throws {
        guard generation == current, socket != nil else { return }
        try outgoing.append(message, audio: audio, priority: priority)
        if !writing {
            writing = true
            Task { [weak self] in await self?.write(generation: current) }
        }
    }
    private func write(generation current: UInt64) async {
        do {
            while generation == current, let socket, let item = outgoing.take() {
                try await socket.send(.string(item.message))
                if generation == current, item.audio { sentAudioFrames += 1 }
            }
            if generation == current { writing = false }
        } catch { if generation == current { await fail(current, stage: "send", error: error) } }
    }
    struct UploadStatistics { let sentFrames, droppedFrames, queuedFrames: Int }
    func uploadStatistics() -> UploadStatistics {
        closedUploadStatistics ?? .init(sentFrames: sentAudioFrames, droppedFrames: outgoing.droppedAudioFrames, queuedFrames: outgoing.count)
    }
    func failureDiagnostics() -> FailureDiagnostics? { lastFailure }
    private func fail(_ current: UInt64, stage: String, error: Error? = nil) async {
        guard generation == current else { return }
        let native = error as NSError?
        let diagnostics = FailureDiagnostics(stage: stage, closeCode: socket?.closeCode.rawValue ?? 0,
            transportCode: native?.domain == NSURLErrorDomain ? native?.code : nil)
        lastFailure = diagnostics
        #if DEBUG
        LiveDebugDiagnostics.record("failure stage=\(stage) close=\(diagnostics.closeCode) transport=\(diagnostics.transportCode ?? 0) sentFrames=\(sentAudioFrames)")
        #endif
        let callback = failure
        close()
        await callback?(current, diagnostics)
    }
    func close(expectedGeneration: UInt64? = nil) {
        if let expectedGeneration, expectedGeneration != generation { return }
        if closedUploadStatistics == nil { closedUploadStatistics = uploadStatistics() }
        generation &+= 1
        reset()
    }
    private func reset() {
        ready = false
        inputGate.close()
        receiver?.cancel(); uploader?.cancel(); timeout?.cancel()
        receiver = nil; uploader = nil; timeout = nil
        socket?.cancel(with: .normalClosure, reason: nil); socket = nil
        session?.invalidateAndCancel(); session = nil
        outgoing = LiveOutgoingBuffer(); seenTools.removeAll(); writing = false; sentAudioFrames = 0
    }
}
