import Foundation

/// Half-duplex guard for the loudspeaker. Voice processing does not remove all
/// of the partner's voice when it plays through the built-in speaker; the
/// residue reached Gemini as "learner speech", cut the partner off mid-sentence
/// and showed up as a learner bubble. While partner audio is queued or playing
/// (plus a short tail for the room), microphone frames are replaced with
/// silence. Headphones and Bluetooth have no echo path, so barge-in stays on.
struct LiveEchoGate {
    static let tail: TimeInterval = 0.35
    private var quietUntil: TimeInterval = 0

    /// - Parameters:
    ///   - partnerAudible: partner audio is queued or still playing.
    ///   - speakerOutput: output is the built-in speaker or receiver.
    mutating func suppressesMicrophone(partnerAudible: Bool, speakerOutput: Bool, now: TimeInterval) -> Bool {
        guard speakerOutput else { quietUntil = 0; return false }
        if partnerAudible { quietUntil = now + Self.tail; return true }
        return now < quietUntil
    }
}
