#if canImport(AVFoundation)
import AVFoundation
import Foundation

/// Shared with Swift Package tests: the same streaming AVAudioConverter used by
/// the microphone worker. Native channel/rate conversion is never done in tap.
final class LivePCMConverter {
    private let converter: AVAudioConverter
    init(format: AVAudioFormat) throws {
        guard format.sampleRate > 0, format.channelCount > 0,
              let target = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true),
              let converter = AVAudioConverter(from: format, to: target) else { throw LiveProtocolError.invalid }
        self.converter = converter
        converter.primeMethod = .none
    }
    func reset() { converter.reset() }
    func convert(_ input: AVAudioPCMBuffer) throws -> Data {
        guard input.frameLength <= 4096 else { throw LiveProtocolError.overloaded }
        let capacity = AVAudioFrameCount(ceil(Double(input.frameLength) * 16000 / input.format.sampleRate) + 64)
        guard let output = AVAudioPCMBuffer(pcmFormat: converter.outputFormat, frameCapacity: capacity) else { throw LiveProtocolError.invalid }
        var supplied = false
        var error: NSError?
        let status = converter.convert(to: output, error: &error) { _, status in
            if supplied { status.pointee = .noDataNow; return nil }
            supplied = true; status.pointee = .haveData; return input
        }
        guard error == nil, status != .error, let samples = output.int16ChannelData else { throw LiveProtocolError.invalid }
        var bytes = Data(capacity: Int(output.frameLength) * 2)
        for i in 0..<Int(output.frameLength) {
            let value = samples[0][i].littleEndian
            bytes.append(UInt8(truncatingIfNeeded: value)); bytes.append(UInt8(truncatingIfNeeded: value >> 8))
        }
        return bytes
    }
}
#endif
