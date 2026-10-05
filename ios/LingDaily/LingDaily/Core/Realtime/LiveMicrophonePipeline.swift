#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// Shared by native iOS capture and the opt-in real Mac microphone test. The
/// realtime callback only copies into fixed slots, splitting hardware buffers.
final class LiveMicrophonePipeline {
    let format: AVAudioFormat
    private let lock = NSLock()
    private let pool: [AVAudioPCMBuffer]
    private var free: [Int] = Array(0..<8)
    private var captured: [Int] = []
    private var frames = LiveInputBuffer()
    private let converter: LivePCMConverter
    private var framer = LivePCMFramer()
    private var active = true, muted = false, needsReset = false
    private var generation: UInt64 = 0
    private var receivedNativeFrames = 0, droppedNativeFrames = 0
    private var reportedNativeDrops = 0
    private var convertedFrames = 0
    private var rejectedFormatFrames = 0
    private var observedRate: Double = 0
    private var observedChannels: UInt32 = 0
    private var peakSample = 0

    init(format: AVAudioFormat) throws {
        self.format = format
        converter = try LivePCMConverter(format: format)
        pool = (0..<8).compactMap { _ in AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(LiveCaptureChunker.capacity)) }
        guard pool.count == 8 else { throw LiveProtocolError.invalid }
        captured.reserveCapacity(8)
    }
    func capture(_ buffer: AVAudioPCMBuffer) {
        guard lock.try() else { return }
        defer { lock.unlock() }
        guard active, !muted else { return }
        observedRate = buffer.format.sampleRate; observedChannels = buffer.format.channelCount
        guard buffer.format == format else { rejectedFormatFrames += Int(buffer.frameLength); return }
        receivedNativeFrames += Int(buffer.frameLength)
        let bytesPerFrame = Int(format.streamDescription.pointee.mBytesPerFrame)
        guard bytesPerFrame > 0 else { return }
        let source = UnsafeMutableAudioBufferListPointer(buffer.mutableAudioBufferList)
        var offset = 0
        while offset < Int(buffer.frameLength) {
            let count = LiveCaptureChunker.length(remaining: Int(buffer.frameLength) - offset)
            guard let index = free.popLast() else { droppedNativeFrames += Int(buffer.frameLength) - offset; return }
            let destination = pool[index]
            destination.frameLength = AVAudioFrameCount(count)
            let target = UnsafeMutableAudioBufferListPointer(destination.mutableAudioBufferList)
            for channel in 0..<source.count {
                if let src = source[channel].mData, let dst = target[channel].mData {
                    memcpy(dst, src.advanced(by: offset * bytesPerFrame), count * bytesPerFrame)
                    target[channel].mDataByteSize = UInt32(count * bytesPerFrame)
                }
            }
            captured.append(index); offset += count
        }
    }
    /// Called from one serial worker, never from the realtime callback.
    @discardableResult
    func process() throws -> Bool {
        lock.lock()
        let indexes = captured; captured.removeAll(keepingCapacity: true)
        let epoch = generation, reset = needsReset; needsReset = false
        let before = frames.droppedFrames
        lock.unlock()
        if reset { converter.reset(); framer.reset() }
        for index in indexes {
            let pcm: Data
            do { pcm = try converter.convert(pool[index]) }
            catch { lock.lock(); free.append(index); lock.unlock(); throw error }
            lock.lock(); free.append(index); lock.unlock()
            var peak = 0
            pcm.withUnsafeBytes { bytes in
                for offset in stride(from: 0, to: bytes.count, by: 2) {
                    let value = Int16(bitPattern: UInt16(bytes[offset]) | UInt16(bytes[offset + 1]) << 8)
                    peak = max(peak, abs(Int(value)))
                }
            }
            let batch = try framer.append(pcm)
            lock.lock()
            if active, !muted, epoch == generation {
                peakSample = max(peakSample, peak); convertedFrames += batch.count; frames.append(batch)
            }
            lock.unlock()
        }
        lock.lock(); defer { lock.unlock() }
        let pressure = frames.droppedFrames > before || droppedNativeFrames > reportedNativeDrops
        reportedNativeDrops = droppedNativeFrames
        return pressure
    }
    func takeFrame() -> Data? {
        lock.lock(); defer { lock.unlock() }
        return active && !muted ? frames.take() : nil
    }
    func setMuted(_ value: Bool) {
        lock.lock(); defer { lock.unlock() }
        muted = value; generation &+= 1; needsReset = true
        frames.clear(); free.append(contentsOf: captured); captured.removeAll(keepingCapacity: true)
    }
    func stop() {
        lock.lock(); defer { lock.unlock() }
        active = false; generation &+= 1; frames.clear()
    }
    struct Statistics {
        let nativeFrames, convertedFrames, droppedNativeFrames, droppedPCMFrames, queuedFrames: Int
        let rejectedFormatFrames, peakSample: Int
        let observedRate: Double
        let observedChannels: UInt32
    }
    func statistics() -> Statistics {
        lock.lock(); defer { lock.unlock() }
        return .init(nativeFrames: receivedNativeFrames, convertedFrames: convertedFrames,
                     droppedNativeFrames: droppedNativeFrames, droppedPCMFrames: frames.droppedFrames, queuedFrames: frames.count,
                     rejectedFormatFrames: rejectedFormatFrames, peakSample: peakSample,
                     observedRate: observedRate, observedChannels: observedChannels)
    }
}
#endif
