import Foundation

/// Echo guard for the built-in speaker that keeps barge-in.
///
/// Voice processing does not remove all of the partner's voice when it plays
/// through the loudspeaker; the residue reached Gemini as "learner speech",
/// cut the partner off and was transcribed as a learner bubble. While partner
/// audio is audible (plus a short room tail), quiet frames — the echo residue —
/// are replaced with silence. A learner talking into the phone is much louder
/// than that residue: once frames stay well above the measured echo level for
/// a moment, the gate opens, releases the held frames and passes speech through
/// so the learner can still interrupt. Headphones/Bluetooth have no echo path.
struct LiveEchoGate {
    static let tail: TimeInterval = 0.35
    /// Speech must be this many times louder than the measured echo residue…
    static let echoMargin: Float = 6
    /// …and never quieter than this RMS (full scale = 1).
    static let minimumSpeechLevel: Float = 0.02
    /// Consecutive loud 20 ms frames needed to treat sound as the learner (60 ms).
    static let framesToOpen = 3
    /// Frames passed after the last loud one, so word endings are not clipped (300 ms).
    static let hangoverFrames = 15

    private var quietUntil: TimeInterval = 0
    private(set) var echoLevel: Float = 0.005
    private var held: [Data] = []
    private var hangover = 0

    var speechThreshold: Float { max(Self.minimumSpeechLevel, echoLevel * Self.echoMargin) }

    /// Returns the frames to upload for one captured frame: the frame itself,
    /// a same-length silent frame, several frames (when releasing held speech),
    /// or none while deciding whether a loud burst is the learner.
    mutating func filter(_ frame: Data, partnerAudible: Bool, speakerOutput: Bool, now: TimeInterval) -> [Data] {
        guard speakerOutput else { reset(); return [frame] }
        if partnerAudible { quietUntil = now + Self.tail }
        guard partnerAudible || now < quietUntil else {
            let pending = held; held = []; hangover = 0
            return pending + [frame]
        }
        let level = Self.rms(frame)
        if hangover > 0 { // The learner is talking over the partner.
            hangover = level >= speechThreshold ? Self.hangoverFrames : hangover - 1
            return [frame]
        }
        guard level >= speechThreshold else {
            // Calibrate on echo residue only; never on candidate speech.
            echoLevel = min(0.2, echoLevel * 0.95 + level * 0.05)
            let silenced = held.map { Data(count: $0.count) } + [Data(count: frame.count)]
            held = []
            return silenced
        }
        held.append(frame)
        guard held.count >= Self.framesToOpen else { return [] }
        hangover = Self.hangoverFrames
        let speech = held; held = []
        return speech
    }

    mutating func reset() {
        quietUntil = 0; held = []; hangover = 0
    }

    /// RMS of 16-bit little-endian mono PCM, full scale = 1.
    static func rms(_ pcm: Data) -> Float {
        let count = pcm.count / 2
        guard count > 0 else { return 0 }
        var sum: Float = 0
        pcm.withUnsafeBytes { raw in
            for index in 0..<count {
                let sample = Float(Int16(littleEndian: raw.loadUnaligned(fromByteOffset: index * 2, as: Int16.self))) / 32768
                sum += sample * sample
            }
        }
        return (sum / Float(count)).squareRoot()
    }
}
