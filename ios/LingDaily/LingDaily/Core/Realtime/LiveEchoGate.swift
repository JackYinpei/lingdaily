import Foundation

/// Echo guard for the built-in speaker.
///
/// On the loudspeaker the partner's voice reaches the microphone louder than
/// the learner's own voice; voice processing only attenuates it (least at the
/// start of a call, before it adapts), so the residue kept triggering Gemini's
/// voice detection and cut the partner off mid-sentence. Loudness cannot tell
/// residue from speech reliably here, so while partner audio is queued or
/// playing (plus a short room tail) microphone frames are replaced with
/// silence. The learner takes the floor explicitly with 打断: playback stops
/// first, so the open microphone then carries only the learner's voice.
/// Headphones/Bluetooth have no echo path and keep voice barge-in.
struct LiveEchoGate {
    static let tail: TimeInterval = 0.35
    private var quietUntil: TimeInterval = 0
    /// Set by 打断; cleared when the partner starts a new reply.
    private(set) var learnerHasFloor = false

    mutating func learnerTookFloor() { learnerHasFloor = true; quietUntil = 0 }
    mutating func partnerStartedReply() { learnerHasFloor = false }

    /// - Parameters:
    ///   - partnerAudible: partner audio is queued or still playing.
    ///   - speakerOutput: output is the built-in speaker or receiver.
    mutating func suppressesMicrophone(partnerAudible: Bool, speakerOutput: Bool, now: TimeInterval) -> Bool {
        guard speakerOutput, !learnerHasFloor else { quietUntil = 0; return false }
        if partnerAudible { quietUntil = now + Self.tail; return true }
        return now < quietUntil
    }
}
